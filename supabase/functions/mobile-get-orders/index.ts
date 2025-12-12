import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Helper to generate display reference from order ID
const getDisplayRef = (orderId: string): string => 
  orderId ? orderId.substring(0, 8).toUpperCase() : 'UNKNOWN';

// Normalize status to consistent values
const STATUS_MAP: Record<string, string> = {
  'DRAFT': 'PENDING_PAYMENT',
  'PENDING_PAYMENT': 'PENDING_PAYMENT',
  'PAID': 'PAID',
  'PROCESSING': 'PAID',
  'PENDING_SHIPMENT': 'PENDING_SHIPMENT',
  'SHIPPED': 'SHIPPED',
  'READY_FOR_PICKUP': 'DELIVERED',
  'DELIVERED': 'DELIVERED',
  'COMPLETED': 'DELIVERED',
  'CANCELLED': 'CANCELLED',
};

const normalizeStatus = (status: string | null): string => 
  status ? (STATUS_MAP[status.toUpperCase()] || status.toUpperCase()) : 'PENDING_PAYMENT';

const normalizeShippingStatus = (status: string | null): string => {
  if (!status) return 'pending';
  const s = status.toLowerCase();
  return s === 'shipped' ? 'shipped' : s === 'delivered' ? 'delivered' : 'pending';
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { user, supabase } = await verifyAndGetUser(req);

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20'))); // Cap at 50
    const offset = (page - 1) * pageSize;

    // Optimized query - include price fields for order items
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, created_at, total_usd, total_cdf, item_total_usd, service_fee_usd, shipping_fee_usd,
        status, maisha_payment_status, tracking_number, carrier, shipped_at, estimated_delivery,
        order_items(id, title, store, product_url, product_image_url, base_price_usd, unit_price_usd, subtotal_usd, quantity, total_price_usd, shipping_status)
      `)
      .eq('user_id', user.id)
      .neq('status', 'DRAFT')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('[mobile-get-orders] Query error:', error.message);
      return errorResponse('Failed to fetch orders', 500);
    }

    // Batch fetch confirmation codes only if orders exist
    const orderIds = orders?.map(o => o.id) || [];
    let paymentData: Record<string, string | null> = {};
    
    if (orderIds.length > 0) {
      const { data: payments } = await supabase
        .from('maisha_payments')
        .select('order_id, confirmation_code')
        .in('order_id', orderIds);
      
      if (payments) {
        payments.forEach(p => { paymentData[p.order_id] = p.confirmation_code; });
      }
    }

    // Mobile-optimized response with complete price data
    const formattedOrders = (orders || []).map(o => {
      const displayRef = getDisplayRef(o.id);
      return {
        id: o.id,
        displayRef,
        totalUsd: Number(o.total_usd) || 0,
        totalCdf: Number(o.total_cdf) || 0,
        itemTotalUsd: Number(o.item_total_usd) || 0,
        serviceFeeUsd: Number(o.service_fee_usd) || 0,
        shippingFeeUsd: Number(o.shipping_fee_usd) || 0,
        status: normalizeStatus(o.status),
        paymentStatus: o.maisha_payment_status || 'PENDING',
        createdAt: o.created_at,
        trackingNumber: o.tracking_number,
        carrier: o.carrier,
        shippedAt: o.shipped_at,
        estimatedDelivery: o.estimated_delivery,
        confirmationCode: paymentData[o.id] || null,
        itemCount: o.order_items?.length || 0,
        // Items with complete price information
        items: (o.order_items || []).map((item: any) => {
          const basePrice = Number(item.base_price_usd) || Number(item.unit_price_usd) || 0;
          const qty = Number(item.quantity) || 1;
          const subtotal = Number(item.subtotal_usd) || (basePrice * qty);
          
          // Image URL - provide multiple aliases for mobile compatibility
          const imgUrl = item.product_image_url || null;
          
          return {
            id: item.id,
            title: item.title || 'Product',
            store: item.store,
            productUrl: item.product_url,
            // Image URL aliases - mobile app may use any of these
            imageUrl: imgUrl,
            image_url: imgUrl,
            product_image_url: imgUrl,
            productImageUrl: imgUrl,
            // Price field aliases
            priceUsd: basePrice,
            unitPriceUsd: basePrice,
            unit_price_usd: basePrice,
            quantity: qty,
            subtotalUsd: subtotal,
            subtotal_usd: subtotal,
            totalUsd: Number(item.total_price_usd) || subtotal,
            shippingStatus: normalizeShippingStatus(item.shipping_status),
          };
        }),
      };
    });

    return jsonResponse({
      ok: true,
      success: true,
      orders: formattedOrders,
      page,
      pageSize,
      hasMore: formattedOrders.length === pageSize,
    });

  } catch (error: any) {
    console.error('[mobile-get-orders] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
