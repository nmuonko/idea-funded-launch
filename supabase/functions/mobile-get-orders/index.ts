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
  const startTime = Date.now();
  
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { user, supabase } = await verifyAndGetUser(req);
    const authTime = Date.now() - startTime;

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
    const offset = (page - 1) * pageSize;

    // Get total count using efficient method (estimated for large tables)
    const countStart = Date.now();
    
    // For accurate count on smaller result sets, use count query
    const { count: totalCount, error: countError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .neq('status', 'DRAFT');
    
    const countTime = Date.now() - countStart;

    // Optimized query with payment data joined
    const queryStart = Date.now();
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, created_at, total_usd, total_cdf, item_total_usd, service_fee_usd, shipping_fee_usd,
        status, maisha_payment_status, tracking_number, carrier, shipped_at, estimated_delivery,
        order_items(id, title, store, product_url, product_image_url, base_price_usd, unit_price_usd, subtotal_usd, quantity, total_price_usd, shipping_status),
        maisha_payments(confirmation_code)
      `)
      .eq('user_id', user.id)
      .neq('status', 'DRAFT')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    const queryTime = Date.now() - queryStart;

    if (error) {
      console.error(`[mobile-get-orders] PERF duration=${Date.now() - startTime}ms - Query error:`, error.message);
      return errorResponse('Failed to fetch orders', 500);
    }

    // Mobile-optimized response - extract confirmation_code from joined data
    const formattedOrders = (orders || []).map(o => {
      const displayRef = getDisplayRef(o.id);
      const confirmationCode = o.maisha_payments?.[0]?.confirmation_code || null;
      
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
        confirmationCode,
        itemCount: o.order_items?.length || 0,
        items: (o.order_items || []).map((item: any) => {
          const basePrice = Number(item.base_price_usd) || Number(item.unit_price_usd) || 0;
          const qty = Number(item.quantity) || 1;
          const subtotal = Number(item.subtotal_usd) || (basePrice * qty);
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
            totalUsd: Number(item.total_price_usd) || subtotal,
            shippingStatus: normalizeShippingStatus(item.shipping_status),
          };
        }),
      };
    });

    // Calculate has_more reliably
    const fetchedCount = formattedOrders.length;
    const hasMore = totalCount !== null 
      ? (offset + fetchedCount) < totalCount
      : fetchedCount === pageSize;

    console.log(`[mobile-get-orders] PERF auth=${authTime}ms count=${countTime}ms query=${queryTime}ms total=${Date.now() - startTime}ms - ${formattedOrders.length} orders`);

    return jsonResponse({
      ok: true,
      success: true,
      orders: formattedOrders,
      page,
      pageSize,
      total_count: totalCount || 0,
      hasMore,
      has_more: hasMore,
    });

  } catch (error: any) {
    console.error(`[mobile-get-orders] PERF duration=${Date.now() - startTime}ms - Error:`, error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
