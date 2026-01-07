/**
 * pawapay-verify-payment Edge Function
 * 
 * Verifies the status of a pawaPay deposit by checking our database
 * and optionally calling the pawaPay API if still pending.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  createAdminClient,
} from "../_shared/auth.ts";
import { generateTraceId, createTracedLogger } from "../_shared/auditLog.ts";
import {
  getProviderByKey,
  getPaymentByOrderId,
  updatePaymentStatus,
} from "../_shared/paymentProviders.ts";
import {
  getPawaPayConfig,
  verifyDeposit,
} from "../_shared/pawapayAdapter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  try {
    log.log('pawapay-verify-payment started');

    // Authenticate user
    const { user, supabase } = await verifyAndGetUser(req);
    log.log('User authenticated', { userId: user.id });

    // Parse request
    const body = await req.json();
    const { order_id, orderId, deposit_id } = body;
    const resolvedOrderId = order_id || orderId;

    if (!resolvedOrderId && !deposit_id) {
      return errorResponse('order_id or deposit_id is required', 400);
    }

    const adminClient = createAdminClient();

    // Get payment record
    let payment: any = null;

    if (resolvedOrderId) {
      // Get order first to verify ownership
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, status, total_usd, total_cdf, user_id')
        .eq('id', resolvedOrderId)
        .eq('user_id', user.id)
        .single();

      if (orderError || !order) {
        return errorResponse('Order not found', 404);
      }

      payment = await getPaymentByOrderId(adminClient, resolvedOrderId);
    } else {
      // Direct deposit ID lookup (less secure, but useful for debugging)
      const { data } = await adminClient
        .from('payments')
        .select('*, orders!inner(user_id)')
        .eq('provider_deposit_id', deposit_id)
        .eq('provider_key', 'pawapay')
        .single();

      if (data?.orders?.user_id !== user.id) {
        return errorResponse('Payment not found', 404);
      }
      payment = data;
    }

    if (!payment) {
      return errorResponse('Payment not found', 404);
    }

    log.log('Found payment', {
      paymentId: payment.id,
      status: payment.status,
      depositId: payment.provider_deposit_id,
    });

    // If already succeeded or failed, return current status
    if (payment.status === 'succeeded' || payment.status === 'failed') {
      return jsonResponse({
        success: true,
        id: payment.id,
        orderId: payment.order_id,
        status: payment.status,
        paymentStatus: payment.status === 'succeeded' ? 'SUCCESS' : 'FAILED',
        provider: 'pawapay',
        paid_at: payment.paid_at,
        trace_id: traceId,
      });
    }

    // If still pending, optionally verify with pawaPay API
    if (payment.provider_deposit_id) {
      const provider = await getProviderByKey(adminClient, 'pawapay');
      
      if (provider?.is_enabled) {
        try {
          const config = getPawaPayConfig(provider);
          const verifyResult = await verifyDeposit(config, payment.provider_deposit_id);

          log.log('pawaPay verify result', {
            status: verifyResult.status,
            success: verifyResult.success,
          });

          // Update if status changed
          if (verifyResult.status !== 'pending') {
            await updatePaymentStatus(adminClient, payment.id, verifyResult.status, {
              provider_transaction_id: verifyResult.provider_transaction_id,
              paid_at: verifyResult.paid_at,
            });

            // Update order if succeeded
            if (verifyResult.status === 'succeeded') {
              await adminClient.rpc('finalize_paid_order', {
                p_order_id: payment.order_id,
                p_payment_ref: payment.provider_deposit_id,
                p_operator_ref: verifyResult.provider_transaction_id,
                p_trace_id: traceId,
              });
            }

            return jsonResponse({
              success: true,
              id: payment.id,
              orderId: payment.order_id,
              status: verifyResult.status,
              paymentStatus: verifyResult.status === 'succeeded' ? 'SUCCESS' : verifyResult.status.toUpperCase(),
              provider: 'pawapay',
              paid_at: verifyResult.paid_at,
              trace_id: traceId,
            });
          }
        } catch (verifyError: any) {
          log.warn('pawaPay API verify failed', { error: verifyError.message });
          // Continue with DB status
        }
      }
    }

    // Return current pending status
    return jsonResponse({
      success: true,
      id: payment.id,
      orderId: payment.order_id,
      status: 'pending',
      paymentStatus: 'PENDING',
      provider: 'pawapay',
      message: 'Payment is being processed',
      trace_id: traceId,
    });

  } catch (error: any) {
    log.error('Error', { message: error.message });
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      trace_id: traceId,
    }, 500);
  }
});
