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

    // Optimized query - select only needed columns, no redundant fields
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, created_at, total_usd, total_cdf, status, maisha_payment_status,
        tracking_number, carrier, shipped_at,
        order_items(id, title, store, product_image_url, quantity, total_price_usd, shipping_status)
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

    // Slim, mobile-optimized response
    const formattedOrders = (orders || []).map(o => {
      const displayRef = getDisplayRef(o.id);
      return {
        id: o.id,
        displayRef,
        totalUsd: o.total_usd || 0,
        totalCdf: o.total_cdf || 0,
        status: normalizeStatus(o.status),
        paymentStatus: o.maisha_payment_status || 'PENDING',
        createdAt: o.created_at,
        trackingNumber: o.tracking_number,
        carrier: o.carrier,
        shippedAt: o.shipped_at,
        confirmationCode: paymentData[o.id] || null,
        itemCount: o.order_items?.length || 0,
        // Slim items - only essential fields for list view
        items: (o.order_items || []).map((item: any) => ({
          id: item.id,
          title: item.title || 'Product',
          store: item.store,
          imageUrl: item.product_image_url,
          quantity: item.quantity || 1,
          totalUsd: item.total_price_usd || 0,
          shippingStatus: normalizeShippingStatus(item.shipping_status),
        })),
      };
    });

    return jsonResponse({
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
