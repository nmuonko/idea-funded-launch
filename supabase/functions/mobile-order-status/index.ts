import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-order-status] User authenticated:', user.id);

    // Get order_id from query params
    const url = new URL(req.url);
    const orderId = url.searchParams.get('order_id');

    if (!orderId) {
      return errorResponse('order_id query parameter is required', 400);
    }

    // Get order with payment details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, total_usd, total_cdf, maisha_transaction_id, maisha_payment_status, payment_verified_at')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (orderError) {
      console.error('[mobile-order-status] DB error:', orderError);
      return errorResponse('Failed to fetch order', 500);
    }

    if (!order) {
      return jsonResponse({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }, 404);
    }

    // Map order status to payment status for mobile app
    let paymentStatus: 'paid' | 'pending' | 'failed' | 'cancelled' = 'pending';
    
    if (order.status === 'PAID' || order.status === 'PROCESSING' || 
        order.status === 'SHIPPED' || order.status === 'READY_FOR_PICKUP' || 
        order.status === 'COMPLETED') {
      paymentStatus = 'paid';
    } else if (order.maisha_payment_status === 'SUCCESS') {
      paymentStatus = 'paid';
    } else if (order.maisha_payment_status === 'FAILED') {
      paymentStatus = 'failed';
    } else if (order.status === 'CANCELLED') {
      paymentStatus = 'cancelled';
    }

    return jsonResponse({
      order_id: order.id,
      payment_status: paymentStatus,
      order_status: order.status,
      maishapay_transaction_id: order.maisha_transaction_id,
      total_usd: order.total_usd,
      total_cdf: order.total_cdf,
      paid_at: order.payment_verified_at,
    });

  } catch (error: any) {
    console.error('[mobile-order-status] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ error: 'INTERNAL_ERROR', message: error.message }, 500);
  }
});
