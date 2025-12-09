import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[Reconcile Payment Status] Starting reconciliation...');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Find all maisha_payments records with status 'pending' 
    // where the corresponding order is 'PAID'
    const { data: pendingPayments, error: fetchError } = await supabase
      .from('maisha_payments')
      .select(`
        id,
        order_id,
        status,
        maisha_reference,
        created_at
      `)
      .eq('status', 'pending');

    if (fetchError) {
      console.error('[Reconcile Payment Status] Error fetching pending payments:', fetchError);
      throw fetchError;
    }

    console.log(`[Reconcile Payment Status] Found ${pendingPayments?.length || 0} pending payment records`);

    if (!pendingPayments || pendingPayments.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending payments to reconcile',
        reconciled: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let reconciledCount = 0;
    const reconciliationResults: any[] = [];

    for (const payment of pendingPayments) {
      // Check the order status
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, status, maisha_payment_status, payment_verified_at')
        .eq('id', payment.order_id)
        .maybeSingle();

      if (orderError) {
        console.error(`[Reconcile Payment Status] Error fetching order ${payment.order_id}:`, orderError);
        continue;
      }

      if (!order) {
        console.warn(`[Reconcile Payment Status] Order ${payment.order_id} not found for payment ${payment.id}`);
        continue;
      }

      // If order is PAID but payment record is pending, sync them
      if (order.status === 'PAID' && payment.status === 'pending') {
        console.log(`[Reconcile Payment Status] Syncing payment ${payment.id} for order ${order.id}`);

        const { error: updateError } = await supabase
          .from('maisha_payments')
          .update({
            status: 'paid',
            paid_at: order.payment_verified_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id);

        if (updateError) {
          console.error(`[Reconcile Payment Status] Error updating payment ${payment.id}:`, updateError);
          reconciliationResults.push({
            paymentId: payment.id,
            orderId: order.id,
            success: false,
            error: updateError.message,
          });
        } else {
          reconciledCount++;
          reconciliationResults.push({
            paymentId: payment.id,
            orderId: order.id,
            success: true,
            previousStatus: 'pending',
            newStatus: 'paid',
          });
          console.log(`[Reconcile Payment Status] Successfully reconciled payment ${payment.id}`);
        }
      } else {
        // Check if order has maisha_payment_status that differs from payment status
        const orderPaymentStatus = order.maisha_payment_status?.toLowerCase();
        
        if (orderPaymentStatus && orderPaymentStatus !== payment.status) {
          // Normalize order payment status
          let normalizedStatus = payment.status;
          if (['success', 'paid', 'completed'].includes(orderPaymentStatus)) {
            normalizedStatus = 'paid';
          } else if (['failed', 'failure'].includes(orderPaymentStatus)) {
            normalizedStatus = 'failed';
          } else if (['cancelled', 'canceled'].includes(orderPaymentStatus)) {
            normalizedStatus = 'cancelled';
          }

          if (normalizedStatus !== payment.status) {
            console.log(`[Reconcile Payment Status] Updating payment ${payment.id} from ${payment.status} to ${normalizedStatus}`);

            const { error: updateError } = await supabase
              .from('maisha_payments')
              .update({
                status: normalizedStatus,
                paid_at: normalizedStatus === 'paid' ? (order.payment_verified_at || new Date().toISOString()) : null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', payment.id);

            if (!updateError) {
              reconciledCount++;
              reconciliationResults.push({
                paymentId: payment.id,
                orderId: order.id,
                success: true,
                previousStatus: payment.status,
                newStatus: normalizedStatus,
              });
            }
          }
        }
      }
    }

    console.log(`[Reconcile Payment Status] Reconciliation complete. Reconciled ${reconciledCount} records.`);

    return new Response(JSON.stringify({
      success: true,
      message: `Reconciled ${reconciledCount} payment records`,
      totalPending: pendingPayments.length,
      reconciled: reconciledCount,
      results: reconciliationResults,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[Reconcile Payment Status] Error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
