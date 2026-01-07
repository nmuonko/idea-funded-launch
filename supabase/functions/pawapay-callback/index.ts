/**
 * pawapay-callback Edge Function
 * 
 * Receives callback notifications from pawaPay for deposit status updates.
 * Configured in pawaPay dashboard as the callback URL for Deposits and Refunds.
 * 
 * IMPORTANT: Must be idempotent - same callback can arrive multiple times.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateTraceId, logAudit } from "../_shared/auditLog.ts";
import {
  getPaymentByDepositId,
  updatePaymentStatus,
  logPaymentEvent,
  normalizePaymentStatus,
} from "../_shared/paymentProviders.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pawapay-signature',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = generateTraceId();
  console.log(`[${traceId}] pawapay-callback received`);

  try {
    // Initialize admin client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse callback payload
    const rawBody = await req.text();
    let payload: any;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error(`[${traceId}] Failed to parse callback body`);
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${traceId}] Callback payload:`, JSON.stringify(payload, null, 2));

    // Extract key fields
    const depositId = payload.depositId;
    const status = payload.status; // COMPLETED | FAILED
    const amount = payload.amount;
    const currency = payload.currency;
    const failureReason = payload.failureReason;
    const correspondentIds = payload.correspondentIds;

    if (!depositId) {
      console.error(`[${traceId}] Missing depositId in callback`);
      return new Response(JSON.stringify({ status: 'error', message: 'Missing depositId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for duplicate callback (idempotency)
    const eventResult = await logPaymentEvent(supabase, {
      provider_key: 'pawapay',
      event_type: 'callback_received',
      event_id: `${depositId}_${status}`,
      payload,
    });

    if (eventResult.duplicate) {
      console.log(`[${traceId}] Duplicate callback ignored for depositId:`, depositId);
      return new Response(JSON.stringify({ status: 'ok', idempotent: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find payment record by deposit ID
    const payment = await getPaymentByDepositId(supabase, 'pawapay', depositId);

    if (!payment) {
      console.error(`[${traceId}] Payment not found for depositId:`, depositId);
      // Still return 200 to prevent pawaPay from retrying
      return new Response(JSON.stringify({ status: 'warning', message: 'Payment not found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${traceId}] Found payment:`, {
      paymentId: payment.id,
      orderId: payment.order_id,
      currentStatus: payment.status,
    });

    // Normalize status
    const normalizedStatus = normalizePaymentStatus('pawapay', status);
    console.log(`[${traceId}] Status:`, { raw: status, normalized: normalizedStatus });

    // Update payment record
    const now = new Date().toISOString();
    const rawEvents = [...(payment.raw_events || []), payload];

    await updatePaymentStatus(supabase, payment.id, normalizedStatus, {
      provider_transaction_id: correspondentIds?.operatorId || depositId,
      paid_at: normalizedStatus === 'succeeded' ? now : undefined,
      raw_events: rawEvents,
    });

    // Update order status
    if (normalizedStatus === 'succeeded') {
      console.log(`[${traceId}] Payment SUCCESS - updating order to PAID`);

      // Use atomic RPC if available
      const { data: rpcResult, error: rpcError } = await supabase.rpc('finalize_paid_order', {
        p_order_id: payment.order_id,
        p_payment_ref: depositId,
        p_operator_ref: correspondentIds?.operatorId || null,
        p_trace_id: traceId,
      });

      if (rpcError) {
        console.error(`[${traceId}] finalize_paid_order RPC error:`, rpcError);
        // Fallback to direct update
        await supabase.from('orders').update({
          status: 'PAID',
          maisha_payment_status: 'SUCCESS',
          operator_ref_id: correspondentIds?.operatorId || null,
          payment_verified_at: now,
          updated_at: now,
        }).eq('id', payment.order_id);
      } else {
        console.log(`[${traceId}] Order finalized:`, rpcResult);
      }

      // Send confirmation notifications (fire-and-forget)
      supabase.functions.invoke('send-payment-confirmation', {
        body: { orderId: payment.order_id, provider: 'pawapay' },
      }).catch(err => console.error(`[${traceId}] Notification error:`, err));

    } else if (normalizedStatus === 'failed') {
      console.log(`[${traceId}] Payment FAILED - order stays PENDING_PAYMENT`);

      await supabase.from('orders').update({
        maisha_payment_status: 'FAILED',
        maisha_description: failureReason?.failureMessage || 'Payment failed',
        updated_at: now,
      }).eq('id', payment.order_id);
    }

    // Log to audit
    await logAudit(supabase, {
      traceId,
      eventType: 'PAWAPAY_CALLBACK_PROCESSED',
      orderId: payment.order_id,
      payload: {
        depositId,
        status,
        normalizedStatus,
        amount,
        currency,
      },
    });

    console.log(`[${traceId}] Callback processed successfully`);

    return new Response(JSON.stringify({
      status: 'ok',
      success: true,
      orderId: payment.order_id,
      paymentStatus: normalizedStatus,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error(`[${traceId}] Callback error:`, error.message);

    // Return 200 even on error to prevent infinite retries
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Internal error processing callback',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
