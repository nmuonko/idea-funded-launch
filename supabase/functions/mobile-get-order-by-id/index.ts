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
    console.log('[mobile-get-order-by-id] User authenticated:', user.id);

    const url = new URL(req.url);
    const orderId = url.pathname.split('/').pop();

    if (!orderId) {
      return errorResponse('Order ID required', 400);
    }

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return errorResponse('Order not found', 404);
    }

    // Get items
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    return jsonResponse({
      order: {
        id: order.id,
        status: order.status,
        shippingCity: order.shipping_city,
        itemTotalUsd: order.item_total_usd,
        serviceFeeUsd: order.service_fee_usd,
        shippingFeeUsd: order.shipping_fee_usd,
        totalUsd: order.total_usd,
        totalCdf: order.total_cdf,
        exchangeRateUsed: order.exchange_rate_used,
        maishaTransactionId: order.maisha_transaction_id,
        maishaPaymentStatus: order.maisha_payment_status,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      },
      items: items?.map(i => ({
        id: i.id,
        store: i.store,
        productUrl: i.product_url,
        title: i.title,
        unitPriceUsd: i.unit_price_usd,
        quantity: i.quantity,
        subtotalUsd: i.subtotal_usd,
        notes: i.notes,
      })) || [],
    });

  } catch (error: any) {
    console.error('[mobile-get-order-by-id] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
