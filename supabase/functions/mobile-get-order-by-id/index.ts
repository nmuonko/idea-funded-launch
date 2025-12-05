import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Helpers
const getDisplayRef = (id: string): string => id ? id.substring(0, 8).toUpperCase() : 'UNKNOWN';

const STATUS_MAP: Record<string, string> = {
  'DRAFT': 'PENDING_PAYMENT', 'PENDING_PAYMENT': 'PENDING_PAYMENT',
  'PAID': 'PAID', 'PROCESSING': 'PAID', 'PENDING_SHIPMENT': 'PENDING_SHIPMENT',
  'SHIPPED': 'SHIPPED', 'READY_FOR_PICKUP': 'DELIVERED', 
  'DELIVERED': 'DELIVERED', 'COMPLETED': 'DELIVERED', 'CANCELLED': 'CANCELLED',
};

const normalizeStatus = (s: string | null): string => s ? (STATUS_MAP[s.toUpperCase()] || s.toUpperCase()) : 'PENDING_PAYMENT';
const normalizeShippingStatus = (s: string | null): string => {
  if (!s) return 'pending';
  const l = s.toLowerCase();
  return l === 'shipped' ? 'shipped' : l === 'delivered' ? 'delivered' : 'pending';
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { user, supabase } = await verifyAndGetUser(req);

    // Extract order ID from URL path or query param
    const url = new URL(req.url);
    let orderId = url.searchParams.get('id') || url.searchParams.get('orderId');
    const pathParts = url.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && lastPart !== 'mobile-get-order-by-id') orderId = lastPart;

    if (!orderId) {
      return jsonResponse({ success: false, error: 'Order ID required' }, 400);
    }

    // Optimized query - select only needed columns
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        id, created_at, total_usd, total_cdf, item_total_usd, service_fee_usd, shipping_fee_usd,
        exchange_rate_used, status, maisha_payment_status, tracking_number, carrier,
        shipped_at, delivered_at, estimated_delivery,
        order_items(id, title, store, product_image_url, base_price_usd, quantity, total_price_usd, shipping_status)
      `)
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[mobile-get-order-by-id] Query error:', error.message);
      return errorResponse('Failed to fetch order', 500);
    }

    if (!order) {
      return jsonResponse({ success: false, error: 'Order not found' }, 404);
    }

    // Get payment details - only needed columns
    const { data: payment } = await supabase
      .from('maisha_payments')
      .select('confirmation_code, paid_at, status')
      .eq('order_id', orderId)
      .maybeSingle();

    const displayRef = getDisplayRef(order.id);

    // Slim, mobile-optimized response
    return jsonResponse({
      success: true,
      order: {
        id: order.id,
        displayRef,
        totalUsd: order.total_usd || 0,
        totalCdf: order.total_cdf || 0,
        itemTotalUsd: order.item_total_usd || 0,
        serviceFeeUsd: order.service_fee_usd || 0,
        shippingFeeUsd: order.shipping_fee_usd || 0,
        exchangeRate: order.exchange_rate_used || 2800,
        status: normalizeStatus(order.status),
        paymentStatus: payment?.status || order.maisha_payment_status || 'PENDING',
        createdAt: order.created_at,
        paidAt: payment?.paid_at,
        shippedAt: order.shipped_at,
        deliveredAt: order.delivered_at,
        estimatedDelivery: order.estimated_delivery,
        trackingNumber: order.tracking_number,
        carrier: order.carrier,
        confirmationCode: payment?.confirmation_code,
        items: (order.order_items || []).map((item: any) => ({
          id: item.id,
          title: item.title || 'Product',
          store: item.store,
          imageUrl: item.product_image_url,
          priceUsd: item.base_price_usd || 0,
          quantity: item.quantity || 1,
          totalUsd: item.total_price_usd || 0,
          shippingStatus: normalizeShippingStatus(item.shipping_status),
        })),
      },
    });

  } catch (error: any) {
    console.error('[mobile-get-order-by-id] Error:', error.message);
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error.message, 500);
  }
});