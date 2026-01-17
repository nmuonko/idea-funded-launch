import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Payment Status Endpoint
 * 
 * SECURITY: This endpoint now requires authentication OR a valid confirmation code.
 * - Authenticated users can only view their own orders
 * - Unauthenticated requests must provide a valid confirmation code
 */

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
    const confirmationCode = url.searchParams.get('confirmation_code') || url.searchParams.get('code');

    console.log('[payment-status] Query params:', { reference, orderId, confirmationCode: confirmationCode ? 'provided' : 'not provided' });

    if (!reference && !orderId && !confirmationCode) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing reference, order_id, or confirmation_code parameter'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    // Try to get authenticated user from JWT
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id || null;
    }
    
    // Use service role for database queries
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // If confirmation code is provided, look up via maisha_payments (public access allowed)
    if (confirmationCode) {
      console.log('[payment-status] Looking up by confirmation code');
      
      const { data: payment, error: paymentError } = await supabaseAdmin
        .from('maisha_payments')
        .select('order_id, status, paid_at, amount_usd, amount_cdf, maisha_reference')
        .eq('confirmation_code', confirmationCode.toUpperCase())
        .maybeSingle();
      
      if (paymentError || !payment) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Payment not found for this confirmation code'
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Get order status
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id, status, created_at')
        .eq('id', payment.order_id)
        .maybeSingle();
      
      // Return limited info for confirmation code lookup (public-safe)
      return new Response(JSON.stringify({
        success: true,
        orderId: payment.order_id,
        orderStatus: order?.status || 'UNKNOWN',
        paymentStatus: payment.status === 'paid' ? 'paid' : payment.status === 'failed' ? 'failed' : 'pending',
        paidAt: payment.paid_at,
        createdAt: order?.created_at,
        // Don't expose amounts or transaction IDs for unauthenticated requests
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For order_id or reference lookups, require authentication
    if (!userId) {
      console.log('[payment-status] Unauthorized access attempt without confirmation code');
      return new Response(JSON.stringify({
        success: false,
        error: 'Authentication required. Provide a valid JWT token or use confirmation_code parameter.'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build query for authenticated user
    let query = supabaseAdmin
      .from('orders')
      .select('id, status, total_usd, total_cdf, maisha_transaction_id, maisha_payment_status, payment_verified_at, created_at, user_id');

    // Search by order ID or reference
    if (orderId) {
      query = query.eq('id', orderId);
    } else if (reference) {
      // Reference format: AFRISHOP-{orderId}
      const extractedOrderId = reference.replace('AFRISHOP-', '').split('-')[0];
      // Try both the extracted ID and the full reference
      query = query.or(`id.eq.${extractedOrderId},maisha_transaction_id.eq.${reference}`);
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

    // SECURITY: Verify the authenticated user owns this order
    if (order.user_id !== userId) {
      console.warn('[payment-status] User attempted to access order they do not own:', { userId, orderUserId: order.user_id });
      return new Response(JSON.stringify({
        success: false,
        error: 'Order not found'  // Don't reveal that order exists but belongs to someone else
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

    console.log('[payment-status] Returning status for authenticated user:', { userId, paymentStatus });

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
