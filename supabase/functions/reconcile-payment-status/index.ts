import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { generateTraceId, logAuditEvent, createTracedLogger } from "../_shared/auditLog.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const BATCH_LIMIT = 100; // Max orders to process per run

/**
 * reconcile-payment-status Edge Function
 * Scheduled job to reconcile payment statuses
 * 
 * CONSERVATIVE APPROACH:
 * - Only finalize to PAID when provider confirms paid
 * - Never auto-mark as failed unless provider confirms
 * 
 * REQUIRES: x-cron-secret header matching CRON_SECRET env var
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  log.log('reconcile-payment-status started');

  // Verify cron authentication
  const cronAuth = verifyCronAuth(req);
  if (!cronAuth.authorized) {
    log.error('Cron auth failed', { error: cronAuth.error });
    return cronAuthErrorResponse(cronAuth.error || 'Unauthorized');
  }

  try {
    // Use service role for database operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Log start
    await logAuditEvent(supabase, traceId, 'RECONCILE_STARTED', {
      payload: { batch_limit: BATCH_LIMIT },
    });

    // Find pending payments where order might be PAID
    const { data: pendingPayments, error: fetchError } = await supabase
      .from('maisha_payments')
      .select(`
        id,
        order_id,
        status,
        maisha_reference,
        maishapay_transaction_ref_id,
        maishapay_operator_ref_id,
        created_at
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT);

    if (fetchError) {
      log.error('Error fetching pending payments', { error: fetchError.message });
      throw fetchError;
    }

    log.log(`Found ${pendingPayments?.length || 0} pending payment records`);

    if (!pendingPayments || pendingPayments.length === 0) {
      const duration = Date.now() - startTime;
      
      await logAuditEvent(supabase, traceId, 'RECONCILE_COMPLETED', {
        payload: { orders_checked: 0, orders_fixed: 0 },
        durationMs: duration,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          success: true,
          message: 'No pending payments to reconcile',
          reconciled: 0,
          trace_id: traceId,
          duration,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let reconciledCount = 0;
    let checkedCount = 0;
    const results: Array<{
      paymentId: string;
      orderId: string;
      success: boolean;
      action?: string;
      error?: string;
    }> = [];

    for (const payment of pendingPayments) {
      checkedCount++;
      
      // Check the order status
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, status, maisha_payment_status, payment_verified_at')
        .eq('id', payment.order_id)
        .maybeSingle();

      if (orderError) {
        log.warn(`Error fetching order ${payment.order_id}`, { error: orderError.message });
        results.push({
          paymentId: payment.id,
          orderId: payment.order_id,
          success: false,
          error: orderError.message,
        });
        continue;
      }

      if (!order) {
        log.warn(`Order ${payment.order_id} not found for payment ${payment.id}`);
        results.push({
          paymentId: payment.id,
          orderId: payment.order_id,
          success: false,
          error: 'Order not found',
        });
        continue;
      }

      // CONSERVATIVE: Only finalize if order is already PAID (confirmed by callback)
      if (order.status === 'PAID' && payment.status === 'pending') {
        log.log(`Syncing payment ${payment.id} for PAID order ${order.id}`);

        // Use the atomic finalize_paid_order RPC
        const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
          'finalize_paid_order',
          {
            p_order_id: order.id,
            p_payment_ref: payment.maishapay_transaction_ref_id || payment.maisha_reference,
            p_operator_ref: payment.maishapay_operator_ref_id,
            p_trace_id: traceId,
          }
        );

        if (finalizeError) {
          log.error(`Error finalizing order ${order.id}`, { error: finalizeError.message });
          results.push({
            paymentId: payment.id,
            orderId: order.id,
            success: false,
            error: finalizeError.message,
          });
        } else {
          reconciledCount++;
          results.push({
            paymentId: payment.id,
            orderId: order.id,
            success: true,
            action: 'finalized_paid',
          });

          await logAuditEvent(supabase, traceId, 'RECONCILE_ORDER_FIXED', {
            orderId: order.id,
            payload: {
              payment_id: payment.id,
              previous_payment_status: 'pending',
              new_status: 'paid',
            },
          });
        }
      } else if (order.maisha_payment_status === 'SUCCESS' && payment.status === 'pending') {
        // Order marked SUCCESS but payment record still pending - sync it
        log.log(`Syncing payment ${payment.id} - order has SUCCESS status`);

        const { error: updateError } = await supabase
          .from('maisha_payments')
          .update({
            status: 'paid',
            paid_at: order.payment_verified_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id);

        if (!updateError) {
          reconciledCount++;
          results.push({
            paymentId: payment.id,
            orderId: order.id,
            success: true,
            action: 'synced_success_status',
          });
        } else {
          results.push({
            paymentId: payment.id,
            orderId: order.id,
            success: false,
            error: updateError.message,
          });
        }
      }
      // NOTE: We do NOT auto-mark as failed - that could incorrectly cancel valid payments
    }

    const duration = Date.now() - startTime;

    await logAuditEvent(supabase, traceId, 'RECONCILE_COMPLETED', {
      payload: {
        orders_checked: checkedCount,
        orders_fixed: reconciledCount,
      },
      durationMs: duration,
    });

    log.log(`Reconciliation complete. Reconciled ${reconciledCount}/${checkedCount}`);

    return new Response(
      JSON.stringify({
        ok: true,
        success: true,
        message: `Reconciled ${reconciledCount} payment records`,
        totalPending: pendingPayments.length,
        checked: checkedCount,
        reconciled: reconciledCount,
        results,
        trace_id: traceId,
        duration,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Reconciliation exception', { error: errorMessage });

    return new Response(
      JSON.stringify({
        ok: false,
        success: false,
        code: 'INTERNAL_ERROR',
        error: errorMessage,
        trace_id: traceId,
        duration: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
