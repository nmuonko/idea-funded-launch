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

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-order-status] User authenticated:', user.id);

    // Extract orderId from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(p => p);
    const orderId = pathParts[pathParts.length - 1];

    if (!orderId) {
      return errorResponse('Order ID required', 400);
    }

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, maisha_payments(*)')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return errorResponse('Order not found', 404);
    }

    return jsonResponse({
      orderId: order.id,
      status: order.status.toLowerCase(),
      grandTotalUsd: order.total_usd,
      grandTotalCdf: order.total_cdf,
      maishaReference: order.maisha_transaction_id,
      paymentStatus: order.maisha_payment_status,
      paidAt: order.payment_verified_at,
    });

  } catch (error: any) {
    console.error('[mobile-order-status] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
