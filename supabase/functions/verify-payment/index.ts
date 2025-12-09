import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { normalizePaymentStatus } from "../_shared/maishapay.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const verifyPaymentSchema = z.object({
  orderId: z.string().uuid(),
  status: z.union([z.string(), z.number()]),
  description: z.string().max(500).optional().default(''),
  transactionRefId: z.string().max(255).optional().default(''),
  operatorRefId: z.string().max(255).optional().default(''),
});

/**
 * verify-payment Edge Function
 * 
 * Called by mobile app after WebView detects MaishaPay redirect to callback URL.
 * Updates order status based on MaishaPay response parameters.
 * 
 * Uses service_role key to bypass RLS for order updates.
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('[verify-payment] Request received');

    // Parse and validate request body
    const body = await req.json();
    console.log('[verify-payment] Request body:', JSON.stringify(body, null, 2));

    const parseResult = verifyPaymentSchema.safeParse(body);
    if (!parseResult.success) {
      console.error('[verify-payment] Validation error:', parseResult.error.errors);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid request data',
          details: parseResult.error.errors,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId, status, description, transactionRefId, operatorRefId } = parseResult.data;
    console.log('[verify-payment] Parsed data:', { orderId, status, description, transactionRefId, operatorRefId });

    // Create Supabase client with service_role key to bypass RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the order to verify it exists
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, user_id, total_usd, total_cdf, maisha_transaction_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('[verify-payment] Order not found:', orderId, orderError);
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[verify-payment] Found order:', { id: order.id, currentStatus: order.status });

    // Prevent re-processing of already completed orders
    if (order.status === 'PAID' || order.status === 'COMPLETED') {
      console.log('[verify-payment] Order already paid/completed, returning current state');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Order already processed',
          order: {
            id: order.id,
            status: order.status,
            totalUsd: order.total_usd,
            totalCdf: order.total_cdf,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize MaishaPay status code
    const normalizedStatus = normalizePaymentStatus(status);
    console.log('[verify-payment] Status mapping:', { raw: status, normalized: normalizedStatus });

    // Map to order status
    let newOrderStatus: string;
    let maishapayStatus: string;

    switch (normalizedStatus) {
      case 'paid':
        newOrderStatus = 'PAID';
        maishapayStatus = 'SUCCESS';
        break;
      case 'cancelled':
        newOrderStatus = 'PENDING_PAYMENT'; // Keep as pending so user can retry
        maishapayStatus = 'CANCELLED';
        break;
      case 'failed':
        newOrderStatus = 'CANCELLED';
        maishapayStatus = 'FAILED';
        break;
      default:
        newOrderStatus = 'PENDING_PAYMENT';
        maishapayStatus = 'PENDING';
    }

    console.log('[verify-payment] Updating order to:', { newOrderStatus, maishapayStatus });

    // Update the order
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: newOrderStatus,
        maisha_payment_status: maishapayStatus,
        maisha_status_code: String(status),
        maisha_description: description || null,
        operator_ref_id: operatorRefId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select('id, status, total_usd, total_cdf, maisha_transaction_id, maisha_payment_status, maisha_status_code, maisha_description, operator_ref_id')
      .single();

    if (updateError) {
      console.error('[verify-payment] Failed to update order:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[verify-payment] Order updated successfully');

    // Update maisha_payments table
    const { error: paymentUpdateError } = await supabase
      .from('maisha_payments')
      .update({
        status: normalizedStatus,
        maishapay_status: maishapayStatus,
        maishapay_transaction_ref_id: transactionRefId || null,
        maishapay_operator_ref_id: operatorRefId || null,
        maishapay_description: description || null,
        paid_at: normalizedStatus === 'paid' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('order_id', orderId);

    if (paymentUpdateError) {
      console.warn('[verify-payment] Failed to update maisha_payments:', paymentUpdateError);
      // Don't fail the request, order is already updated
    }

    // Generate order reference for display
    const orderRef = orderId.substring(0, 8).toUpperCase();

    return new Response(
      JSON.stringify({
        success: true,
        order: {
          id: updatedOrder.id,
          orderRef,
          status: updatedOrder.status,
          paymentStatus: updatedOrder.maisha_payment_status,
          totalUsd: updatedOrder.total_usd,
          totalCdf: updatedOrder.total_cdf,
          transactionRef: updatedOrder.maisha_transaction_id,
          operatorRef: updatedOrder.operator_ref_id,
          statusCode: updatedOrder.maisha_status_code,
          description: updatedOrder.maisha_description,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[verify-payment] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
