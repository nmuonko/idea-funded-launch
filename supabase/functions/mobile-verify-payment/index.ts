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

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  try {
    log.log('mobile-verify-payment started');

    const { user, supabase } = await verifyAndGetUser(req);
    log.log('User authenticated', { userId: user.id });

    // Rate limiting: 30 requests per 10 minutes per user
    const clientIp = getClientIp(req);
    const rateLimitResult = await checkRateLimit(
      supabase,
      `user:${user.id}:verify-payment`,
      30,
      10
    );

    if (!rateLimitResult.allowed) {
      log.warn('Rate limit exceeded', { 
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

    const body = await req.json();
    const { order_id, maishapay_reference } = body;

    if (!order_id && !maishapay_reference) {
      return errorResponse('order_id or maishapay_reference is required', 400);
    }

    const config = getMaishaPayConfig();
    log.log('MaishaPay mode', { mode: config.mode });

    // Find the order with item count
    let query = supabase.from('orders').select('*, order_items(id)');
    
    if (order_id) {
      query = query.eq('id', order_id);
    } else {
      query = query.eq('maisha_transaction_id', maishapay_reference);
    }

    const { data: order, error: orderError } = await query.eq('user_id', user.id).single();

    if (orderError || !order) {
      return jsonResponse({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }, 404);
    }

    // ==================== CHECK UNIFIED PAYMENTS TABLE FIRST ====================
    
    const unifiedPayment = await getPaymentByOrderId(supabase, order.id);
    
    if (unifiedPayment && unifiedPayment.provider_key === 'pawapay') {
      log.log('Using pawaPay verification', { paymentId: unifiedPayment.id });
      
      // Check if already completed in DB
      if (unifiedPayment.status === 'succeeded') {
        return jsonResponse({
          success: true,
          id: order.id,
          orderId: order.id,
          order_number: order.id.substring(0, 8).toUpperCase(),
          orderRef: order.id.substring(0, 8).toUpperCase(),
          status: 'paid',
          paymentStatus: 'SUCCESS',
          orderStatus: 'PAID',
          totalUsd: order.total_usd || 0,
          totalCdf: order.total_cdf || 0,
          currency: unifiedPayment.currency || 'USD',
          provider: 'pawapay',
          payment_provider: 'pawapay',
          confirmationCode: unifiedPayment.provider_transaction_id,
          message: 'Paiement confirmé',
          trace_id: traceId,
        });
      }
      
      // Verify with pawaPay API if deposit ID exists
      if (unifiedPayment.provider_deposit_id) {
        try {
          const provider = await getProviderByKey(supabase, 'pawapay');
          if (provider) {
            const pawaConfig = getPawaPayConfig(provider);
            const verifyResult = await verifyDeposit(pawaConfig, unifiedPayment.provider_deposit_id);
            
            log.log('pawaPay verify result', { 
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
                id: order.id,
                orderId: order.id,
                order_number: order.id.substring(0, 8).toUpperCase(),
                orderRef: order.id.substring(0, 8).toUpperCase(),
                status: 'paid',
                paymentStatus: 'SUCCESS',
                orderStatus: 'PAID',
                totalUsd: order.total_usd || 0,
                totalCdf: order.total_cdf || 0,
                currency: unifiedPayment.currency || 'USD',
                provider: 'pawapay',
                payment_provider: 'pawapay',
                confirmationCode: verifyResult.provider_transaction_id,
                message: 'Paiement confirmé',
                trace_id: traceId,
              });
            }
            
            if (verifyResult.status === 'failed') {
              await updatePaymentStatus(supabase, unifiedPayment.id, 'failed');
              
              return jsonResponse({
                success: true,
                id: order.id,
                orderId: order.id,
                order_number: order.id.substring(0, 8).toUpperCase(),
                status: 'failed',
                paymentStatus: 'FAILED',
                orderStatus: order.status,
                totalUsd: order.total_usd || 0,
                totalCdf: order.total_cdf || 0,
                currency: unifiedPayment.currency || 'USD',
                provider: 'pawapay',
                message: verifyResult.error || 'Paiement échoué',
                trace_id: traceId,
              });
            }
            
            // Still pending
            return jsonResponse({
              success: true,
              id: order.id,
              orderId: order.id,
              order_number: order.id.substring(0, 8).toUpperCase(),
              status: 'pending',
              paymentStatus: 'PENDING',
              orderStatus: order.status,
              totalUsd: order.total_usd || 0,
              totalCdf: order.total_cdf || 0,
              currency: unifiedPayment.currency || 'USD',
              provider: 'pawapay',
              message: 'Paiement en attente de confirmation',
              trace_id: traceId,
            });
          }
        } catch (pawaError: any) {
          log.error('pawaPay verify error', { error: pawaError.message });
          // Fall through to return pending status
        }
      }
      
      // Return current status from DB
      const mappedStatus = normalizePaymentStatus('pawapay', unifiedPayment.status);
      return jsonResponse({
        success: true,
        id: order.id,
        orderId: order.id,
        order_number: order.id.substring(0, 8).toUpperCase(),
        status: mappedStatus === 'succeeded' ? 'paid' : mappedStatus,
        paymentStatus: mappedStatus === 'succeeded' ? 'SUCCESS' : 'PENDING',
        orderStatus: order.status,
        totalUsd: order.total_usd || 0,
        totalCdf: order.total_cdf || 0,
        currency: unifiedPayment.currency || 'USD',
        provider: 'pawapay',
        message: 'Paiement en attente de confirmation',
        trace_id: traceId,
      });
    }

    // ==================== MAISHAPAY VERIFICATION ====================

    // Get confirmation code and currency from maisha_payments
    const { data: payment } = await supabase
      .from('maisha_payments')
      .select('confirmation_code, currency, amount_usd, amount_cdf')
      .eq('order_id', order.id)
      .maybeSingle();

    // Generate short order reference (first 8 chars of UUID)
    const orderRef = order.id.substring(0, 8).toUpperCase();
    const itemCount = order.order_items?.length || 0;
    const confirmationCode = payment?.confirmation_code || null;
    const paymentCurrency = payment?.currency || order.normalized_currency || 'USD';

    // Build base response data - ensuring id is ALWAYS defined
    const buildResponse = (status: string, paymentStatus: string, orderStatus: string, message: string) => ({
      success: true,
      // Core identifiers - ALWAYS defined
      id: order.id,
      orderId: order.id,
      order_number: orderRef,
      orderRef,
      displayRef: orderRef,
      // Status
      status,
      paymentStatus,
      orderStatus,
      // Amounts - include both currencies
      totalUsd: order.total_usd || 0,
      totalCdf: order.total_cdf || 0,
      total_amount_usd: order.total_usd || 0,
      total_amount_cdf: order.total_cdf || 0,
      itemCount,
      // Currency information
      currency: paymentCurrency,
      currencySelected: order.normalized_currency || paymentCurrency,
      exchangeRate: order.exchange_rate_used || 2500,
      // Display amounts based on selected currency
      displayAmount: paymentCurrency === 'CDF' 
        ? `${Math.round(order.total_cdf || 0).toLocaleString('fr-FR')} CDF`
        : `$${(order.total_usd || 0).toFixed(2)} USD`,
      // Payment details
      confirmationCode,
      provider: 'maishapay',
      payment_provider: 'maishapay',
      mode: config.mode,
      message,
      trace_id: traceId,
    });

    // If already paid, return current status
    if (order.status === 'PAID' || order.maisha_payment_status === 'SUCCESS') {
      log.log('Order already paid', { orderId: order.id });
      return jsonResponse(buildResponse('paid', 'SUCCESS', 'PAID', 'Paiement confirmé'));
    }

    // Verify with MaishaPay API
    const reference = order.maisha_transaction_id || `AFRISHOP-${order.id}`;
    const verifyResult = await verifyPaymentStatus(reference);

    log.log('Verify result', { 
      orderId: order.id,
      status: verifyResult.status,
      success: verifyResult.success,
    });

    // Update order if status changed using atomic RPC
    if (verifyResult.success && verifyResult.status === 'paid') {
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
        log.error('Finalize RPC failed', { error: finalizeError.message });
      } else {
        log.log('Order finalized as paid', { result: finalizeResult });
      }

      return jsonResponse(buildResponse('paid', 'SUCCESS', 'PAID', 'Paiement confirmé'));
    }

    return jsonResponse(buildResponse(
      verifyResult.status || 'pending',
      'PENDING',
      order.status,
      'Paiement en attente de confirmation'
    ));

  } catch (error: any) {
    log.error('Error', { message: error.message });
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ 
      error: 'INTERNAL_ERROR', 
      message: error.message,
      trace_id: traceId,
    }, 500);
  }
});
