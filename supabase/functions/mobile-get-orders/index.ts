import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Helper to generate display reference from order ID
function getDisplayRef(orderId: string): string {
  if (!orderId) return 'UNKNOWN';
  return orderId.substring(0, 8).toUpperCase();
}

// Normalize status to consistent values
function normalizeStatus(status: string | null): string {
  if (!status) return 'PENDING_PAYMENT';
  
  const s = status.toUpperCase();
  
  // Map to standard values
  switch (s) {
    case 'DRAFT':
    case 'PENDING_PAYMENT':
      return 'PENDING_PAYMENT';
    case 'PAID':
    case 'PROCESSING':
      return 'PAID';
    case 'PENDING_SHIPMENT':
      return 'PENDING_SHIPMENT';
    case 'SHIPPED':
      return 'SHIPPED';
    case 'READY_FOR_PICKUP':
    case 'DELIVERED':
    case 'COMPLETED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return s;
  }
}

// Normalize item shipping status
function normalizeShippingStatus(status: string | null): string {
  if (!status) return 'pending';
  const s = status.toLowerCase();
  if (s === 'shipped') return 'shipped';
  if (s === 'delivered') return 'delivered';
  return 'pending';
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-get-orders] User authenticated:', user.id);

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const offset = (page - 1) * pageSize;

    // Get orders with items included - fetch all non-DRAFT orders
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, 
        created_at, 
        updated_at,
        shipping_city, 
        item_total_usd,
        service_fee_usd,
        shipping_fee_usd,
        total_usd, 
        total_cdf, 
        exchange_rate_used,
        status,
        maisha_transaction_id,
        maisha_payment_status,
        operator_ref_id,
        tracking_number,
        carrier,
        shipped_at,
        delivered_at,
        estimated_delivery,
        order_items(
          id,
          title,
          store,
          product_url,
          product_image_url,
          unit_price_usd,
          base_price_usd,
          quantity,
          subtotal_usd,
          total_price_usd,
          shipping_status,
          notes
        )
      `)
      .eq('user_id', user.id)
      .neq('status', 'DRAFT')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('[mobile-get-orders] Query error:', error);
      throw error;
    }

    // Get confirmation codes and payment refs from maisha_payments
    const orderIds = orders?.map(o => o.id) || [];
    let paymentData: Record<string, { confirmationCode: string | null; paymentRef: string | null }> = {};
    
    if (orderIds.length > 0) {
      const { data: payments } = await supabase
        .from('maisha_payments')
        .select('order_id, confirmation_code, maishapay_transaction_ref_id, maishapay_operator_ref_id')
        .in('order_id', orderIds);
      
      if (payments) {
        paymentData = payments.reduce((acc, p) => {
          acc[p.order_id] = {
            confirmationCode: p.confirmation_code || null,
            paymentRef: p.maishapay_transaction_ref_id || p.maishapay_operator_ref_id || null,
          };
          return acc;
        }, {} as Record<string, { confirmationCode: string | null; paymentRef: string | null }>);
      }
    }

    // Format response with ALL required fields - ensuring id is NEVER undefined
    const formattedOrders = (orders || []).map(o => {
      const orderId = o.id || '';
      const displayRef = getDisplayRef(orderId);
      const payment = paymentData[orderId] || { confirmationCode: null, paymentRef: null };
      
      return {
        // Core identifiers - ALWAYS defined
        id: orderId,
        order_number: displayRef,
        displayRef: displayRef,
        orderRef: displayRef,
        
        // Amounts
        total_amount_usd: o.total_usd || 0,
        total_amount_cdf: o.total_cdf || 0,
        totalUsd: o.total_usd || 0,
        totalCdf: o.total_cdf || 0,
        itemTotalUsd: o.item_total_usd || 0,
        serviceFeeUsd: o.service_fee_usd || 0,
        shippingFeeUsd: o.shipping_fee_usd || 0,
        exchangeRate: o.exchange_rate_used || 2800,
        
        // Status - normalized
        status: normalizeStatus(o.status),
        paymentStatus: o.maisha_payment_status || 'PENDING',
        
        // Timestamps
        created_at: o.created_at,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
        shippedAt: o.shipped_at,
        deliveredAt: o.delivered_at,
        estimatedDelivery: o.estimated_delivery,
        
        // Shipping details
        shippingCity: o.shipping_city,
        trackingNumber: o.tracking_number,
        carrier: o.carrier,
        
        // Payment details
        payment_provider: 'maishapay',
        payment_ref: payment.paymentRef || o.operator_ref_id || o.maisha_transaction_id,
        confirmationCode: payment.confirmationCode,
        
        // Items array - always present
        items: (o.order_items || []).map((item: any) => ({
          id: item.id || '',
          title: item.title || 'Untitled Product',
          store_name: item.store || 'Unknown',
          storeName: item.store || 'Unknown',
          product_url: item.product_url || '',
          productUrl: item.product_url || '',
          imageUrl: item.product_image_url || null,
          price_usd: item.unit_price_usd || item.base_price_usd || 0,
          priceUsd: item.unit_price_usd || item.base_price_usd || 0,
          quantity: item.quantity || 1,
          subtotal_usd: item.subtotal_usd || item.total_price_usd || 0,
          subtotalUsd: item.subtotal_usd || item.total_price_usd || 0,
          shipping_status: normalizeShippingStatus(item.shipping_status),
          shippingStatus: normalizeShippingStatus(item.shipping_status),
          notes: item.notes || null,
        })),
      };
    });

    console.log('[mobile-get-orders] Returning', formattedOrders.length, 'orders');

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
