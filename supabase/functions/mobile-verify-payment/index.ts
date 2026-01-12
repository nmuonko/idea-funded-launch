import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
} from "../_shared/auth.ts";
import { verifyPaymentStatus, getMaishaPayConfig } from "../_shared/maishapay.ts";
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from "../_shared/rateLimiter.ts";
import { generateTraceId, createTracedLogger } from "../_shared/auditLog.ts";
import { 
  getPaymentByOrderId, 
  getProviderByKey,
  normalizePaymentStatus,
  updatePaymentStatus,
} from "../_shared/paymentProviders.ts";
import { verifyDeposit, getPawaPayConfig } from "../_shared/pawapayAdapter.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Support both GET and POST for flexibility
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  try {
    log.log('[verify-payment] Started');

    const { user, supabase } = await verifyAndGetUser(req);
    log.log('[verify-payment] User authenticated', { userId: user.id });

    // Rate limiting: 30 requests per 10 minutes per user
    const clientIp = getClientIp(req);
    const rateLimitResult = await checkRateLimit(
      supabase,
      `user:${user.id}:verify-payment`,
      30,
      10
    );

    if (!rateLimitResult.allowed) {
      log.warn('[verify-payment] Rate limit exceeded', { 
        userId: user.id, 
        count: rateLimitResult.count,
        limit: rateLimitResult.limit,
      });
      return rateLimitExceededResponse(
        { 
          allowed: false, 
          user_result: rateLimitResult,
          blocked_by: 'user',
        },
        'verify-payment'
      );
    }

    // Parse order_id from query params (GET) or body (POST)
    let order_id: string | null = null;
    let maishapay_reference: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      order_id = url.searchParams.get('orderId') || url.searchParams.get('order_id');
      maishapay_reference = url.searchParams.get('maishapay_reference') || url.searchParams.get('reference');
    } else {
      const body = await req.json();
      order_id = body.order_id || body.orderId;
      maishapay_reference = body.maishapay_reference || body.reference;
    }

    log.log('[verify-payment] Params', { order_id, maishapay_reference });

    if (!order_id && !maishapay_reference) {
      return jsonResponse({ 
        success: false, 
        code: 'MISSING_PARAM',
        message: 'order_id or maishapay_reference is required',
        error: 'order_id or maishapay_reference is required',
      }, 400);
    }

    const config = getMaishaPayConfig();
    log.log('[verify-payment] MaishaPay mode', { mode: config.mode });

    // Find the order with item count
    let query = supabase.from('orders').select('*, order_items(id)');
    
    if (order_id) {
      query = query.eq('id', order_id);
    } else {
      query = query.eq('maisha_transaction_id', maishapay_reference);
    }

    const { data: order, error: orderError } = await query.eq('user_id', user.id).single();

    if (orderError || !order) {
      log.warn('[verify-payment] Order not found', { order_id, maishapay_reference });
      return jsonResponse({ 
        success: false, 
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
        error: 'Order not found',
      }, 404);
    }

    // ==================== CHECK UNIFIED PAYMENTS TABLE FIRST ====================
    
    const unifiedPayment = await getPaymentByOrderId(supabase, order.id);
    
    if (unifiedPayment && unifiedPayment.provider_key === 'pawapay') {
      log.log('[verify-payment] Using pawaPay verification', { paymentId: unifiedPayment.id });
      
      // Check if already completed in DB
      if (unifiedPayment.status === 'succeeded') {
        return jsonResponse({
          success: true,
          order_id: order.id,
          status: 'succeeded',
          paid_at: unifiedPayment.paid_at || order.payment_verified_at,
        });
      }
      
      // Verify with pawaPay API if deposit ID exists
      if (unifiedPayment.provider_deposit_id) {
        try {
          const provider = await getProviderByKey(supabase, 'pawapay');
          if (provider) {
            const pawaConfig = getPawaPayConfig(provider);
            const verifyResult = await verifyDeposit(pawaConfig, unifiedPayment.provider_deposit_id);
            
            log.log('[verify-payment] pawaPay verify result', { 
              status: verifyResult.status,
              success: verifyResult.success,
            });
            
            if (verifyResult.status === 'succeeded') {
              // Update payment and order status
              await updatePaymentStatus(supabase, unifiedPayment.id, 'succeeded', {
                provider_transaction_id: verifyResult.provider_transaction_id,
                paid_at: verifyResult.paid_at,
              });
              
              // Update order status
              await supabase.from('orders').update({
                status: 'PAID',
                maisha_payment_status: 'SUCCESS',
              }).eq('id', order.id);
              
              return jsonResponse({
                success: true,
                order_id: order.id,
                status: 'succeeded',
                paid_at: verifyResult.paid_at || new Date().toISOString(),
              });
            }
            
            if (verifyResult.status === 'failed') {
              await updatePaymentStatus(supabase, unifiedPayment.id, 'failed');
              
              return jsonResponse({
                success: true,
                order_id: order.id,
                status: 'failed',
                error: verifyResult.error || 'Payment failed',
              });
            }
            
            // Still pending
            return jsonResponse({
              success: true,
              order_id: order.id,
              status: 'pending',
            });
          }
        } catch (pawaError: any) {
          log.error('[verify-payment] pawaPay verify error', { error: pawaError.message });
          // Fall through to return pending status
        }
      }
      
      // Return current status from DB
      const mappedStatus = normalizePaymentStatus('pawapay', unifiedPayment.status);
      return jsonResponse({
        success: true,
        order_id: order.id,
        status: mappedStatus === 'succeeded' ? 'succeeded' : 'pending',
        paid_at: unifiedPayment.paid_at || undefined,
      });
    }

    // ==================== MAISHAPAY VERIFICATION ====================

    // Get confirmation code and currency from maisha_payments
    const { data: payment } = await supabase
      .from('maisha_payments')
      .select('confirmation_code, currency, amount_usd, amount_cdf, paid_at')
      .eq('order_id', order.id)
      .maybeSingle();

    log.log('[verify-payment] Checking MaishaPay', { orderId: order.id, hasPaymentRecord: !!payment });

    // If already paid, return current status
    if (order.status === 'PAID' || order.maisha_payment_status === 'SUCCESS') {
      log.log('[verify-payment] Order already paid', { orderId: order.id });
      return jsonResponse({
        success: true,
        order_id: order.id,
        status: 'succeeded',
        paid_at: payment?.paid_at || order.payment_verified_at || order.approved_at,
      });
    }

    // Verify with MaishaPay API
    const reference = order.maisha_transaction_id || `AFRISHOP-${order.id}`;
    const verifyResult = await verifyPaymentStatus(reference);

    log.log('[verify-payment] MaishaPay verify result', { 
      orderId: order.id,
      status: verifyResult.status,
      success: verifyResult.success,
    });

    // Update order if status changed using atomic RPC
    if (verifyResult.success && verifyResult.status === 'succeeded') {
      // Use the atomic finalize_paid_order RPC
      const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
        'finalize_paid_order',
        {
          p_order_id: order.id,
          p_payment_ref: verifyResult.transactionId || reference,
          p_operator_ref: verifyResult.operatorRefId || null,
          p_trace_id: traceId,
        }
      );

      if (finalizeError) {
        log.error('[verify-payment] Finalize RPC failed', { error: finalizeError.message });
      } else {
        log.log('[verify-payment] Order finalized as paid', { result: finalizeResult });
      }

      return jsonResponse({
        success: true,
        order_id: order.id,
        status: 'succeeded',
        paid_at: new Date().toISOString(),
      });
    }

    // Return pending or failed status
    return jsonResponse({
      success: true,
      order_id: order.id,
      status: verifyResult.status === 'failed' ? 'failed' : 'pending',
      error: verifyResult.status === 'failed' ? (verifyResult.error || 'Payment failed') : undefined,
    });

  } catch (error: any) {
    log.error('[verify-payment] Error', { message: error.message });
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        success: false,
        code: 'AUTH_ERROR',
        message: error.message,
        error: error.message,
      }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      code: 'INTERNAL_ERROR', 
      message: 'An unexpected error occurred',
      error: error.message,
    }, 500);
  }
});
