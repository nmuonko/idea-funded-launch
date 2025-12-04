import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const reference = url.searchParams.get('reference') || url.searchParams.get('ref');
    const orderId = url.searchParams.get('order_id') || url.searchParams.get('orderId');

    console.log('[payment-status] Query params:', { reference, orderId });

    if (!reference && !orderId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing reference or order_id parameter'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client with service role for unrestricted access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let query = supabaseClient
      .from('orders')
      .select('id, status, total_usd, total_cdf, maisha_transaction_id, maisha_payment_status, payment_verified_at, created_at');

    // Search by order ID or reference
    if (orderId) {
      query = query.eq('id', orderId);
    } else if (reference) {
      // Reference format: AFRISHOP-{orderId}
      const extractedOrderId = reference.replace('AFRISHOP-', '');
      query = query.eq('id', extractedOrderId);
    }

    const { data: order, error: orderError } = await query.maybeSingle();

    if (orderError) {
      console.error('[payment-status] Database error:', orderError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Database error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!order) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Order not found'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map order status to payment status
    let paymentStatus: 'paid' | 'pending' | 'failed' | 'cancelled' = 'pending';
    
    if (order.status === 'PAID' || order.status === 'PROCESSING' || 
        order.status === 'SHIPPED' || order.status === 'READY_FOR_PICKUP' || 
        order.status === 'COMPLETED') {
      paymentStatus = 'paid';
    } else if (order.maisha_payment_status === 'SUCCESS') {
      paymentStatus = 'paid';
    } else if (order.maisha_payment_status === 'FAILED') {
      paymentStatus = 'failed';
    } else if (order.maisha_payment_status === 'CANCELLED' || order.status === 'CANCELLED') {
      paymentStatus = 'cancelled';
    }

    console.log('[payment-status] Returning status:', paymentStatus);

    return new Response(JSON.stringify({
      success: true,
      orderId: order.id,
      orderStatus: order.status,
      paymentStatus,
      totalUsd: order.total_usd,
      totalCdf: order.total_cdf,
      transactionId: order.maisha_transaction_id,
      paidAt: order.payment_verified_at,
      createdAt: order.created_at,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[payment-status] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
