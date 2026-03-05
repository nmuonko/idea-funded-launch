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
  const startTime = Date.now();
  
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { user, supabase } = await verifyAndGetUser(req);
    const authTime = Date.now() - startTime;

    // Extract order ID from URL path or query param
    const url = new URL(req.url);
    let orderId = url.searchParams.get('id') || url.searchParams.get('orderId');
    const pathParts = url.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && lastPart !== 'mobile-get-order-by-id') orderId = lastPart;

    if (!orderId) {
      return jsonResponse({ ok: false, success: false, code: 'MISSING_ORDER_ID', error: 'Order ID required' }, 400);
    }

    // Single optimized query with payment data joined
    const queryStart = Date.now();
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        id, created_at, total_usd, total_cdf, item_total_usd, service_fee_usd, shipping_fee_usd,
        exchange_rate_used, status, tracking_number, carrier,
        shipped_at, delivered_at, estimated_delivery,
        order_items(id, title, store, product_url, product_image_url, base_price_usd, unit_price_usd, subtotal_usd, markup_fee_usd, quantity, total_price_usd, total_price_cdf, shipping_status),
        payment_attempts(confirmation_code, paid_at, status)
      `)
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();
    const queryTime = Date.now() - queryStart;

    if (error) {
      console.error(`[mobile-get-order-by-id] PERF duration=${Date.now() - startTime}ms - Query error:`, error.message);
      return errorResponse('Failed to fetch order', 500);
    }

    if (!order) {
      return jsonResponse({ ok: false, success: false, code: 'NOT_FOUND', error: 'Order not found' }, 404);
    }

    const displayRef = getDisplayRef(order.id);
    const payment = order.payment_attempts?.[0] || null;

    console.log(`[mobile-get-order-by-id] PERF auth=${authTime}ms query=${queryTime}ms total=${Date.now() - startTime}ms - Order ${orderId.substring(0, 8)}`);

    return jsonResponse({
      ok: true,
      success: true,
      order: {
        id: order.id,
        displayRef,
        totalUsd: Number(order.total_usd) || 0,
        totalCdf: Number(order.total_cdf) || 0,
        itemTotalUsd: Number(order.item_total_usd) || 0,
        serviceFeeUsd: Number(order.service_fee_usd) || 0,
        shippingFeeUsd: Number(order.shipping_fee_usd) || 0,
        exchangeRate: Number(order.exchange_rate_used) || 2800,
        status: normalizeStatus(order.status),
        paymentStatus: payment?.status || 'PENDING',
        createdAt: order.created_at,
        paidAt: payment?.paid_at,
        shippedAt: order.shipped_at,
        deliveredAt: order.delivered_at,
        estimatedDelivery: order.estimated_delivery,
        trackingNumber: order.tracking_number,
        carrier: order.carrier,
        confirmationCode: payment?.confirmation_code,
        items: (order.order_items || []).map((item: any) => {
          const basePrice = Number(item.base_price_usd) || Number(item.unit_price_usd) || 0;
          const qty = Number(item.quantity) || 1;
          const subtotal = Number(item.subtotal_usd) || (basePrice * qty);
          const totalWithMarkup = Number(item.total_price_usd) || subtotal;
          const imgUrl = item.product_image_url || null;
          
          return {
            id: item.id,
            title: item.title || 'Product',
            store: item.store,
            productUrl: item.product_url,
            imageUrl: imgUrl,
            image_url: imgUrl,
            priceUsd: basePrice,
            unitPriceUsd: basePrice,
            quantity: qty,
            subtotalUsd: subtotal,
            totalUsd: totalWithMarkup,
            markupFeeUsd: Number(item.markup_fee_usd) || 0,
            shippingStatus: normalizeShippingStatus(item.shipping_status),
          };
        }),
      },
    });

  } catch (error: any) {
    console.error(`[mobile-get-order-by-id] PERF duration=${Date.now() - startTime}ms - Error:`, error.message);
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error.message, 500);
  }
});