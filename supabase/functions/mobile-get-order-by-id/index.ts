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
    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-get-order-by-id] User authenticated:', user.id);

    // Extract order ID from URL path or query param
    const url = new URL(req.url);
    let orderId = url.searchParams.get('id') || url.searchParams.get('orderId');
    
    // Also try extracting from path (e.g., /mobile-get-order-by-id/abc123)
    const pathParts = url.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && lastPart !== 'mobile-get-order-by-id') {
      orderId = lastPart;
    }

    if (!orderId) {
      console.error('[mobile-get-order-by-id] Missing order ID');
      return jsonResponse({ 
        success: false, 
        error: 'Order ID is required' 
      }, 400);
    }

    console.log('[mobile-get-order-by-id] Fetching order:', orderId);

    // Get order with items
    const { data: order, error } = await supabase
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
        admin_notes,
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
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[mobile-get-order-by-id] Query error:', error);
      throw error;
    }

    if (!order) {
      console.log('[mobile-get-order-by-id] Order not found:', orderId);
      return jsonResponse({ 
        success: false, 
        error: 'Order not found' 
      }, 404);
    }

    // Get payment details
    const { data: payment } = await supabase
      .from('maisha_payments')
      .select('confirmation_code, maishapay_transaction_ref_id, maishapay_operator_ref_id, paid_at, status')
      .eq('order_id', orderId)
      .maybeSingle();

    const displayRef = getDisplayRef(order.id);

    // Format response with ALL required fields - ensuring id is NEVER undefined
    const formattedOrder = {
      // Core identifiers - ALWAYS defined
      id: order.id,
      order_number: displayRef,
      displayRef: displayRef,
      orderRef: displayRef,
      
      // Amounts
      total_amount_usd: order.total_usd || 0,
      total_amount_cdf: order.total_cdf || 0,
      totalUsd: order.total_usd || 0,
      totalCdf: order.total_cdf || 0,
      itemTotalUsd: order.item_total_usd || 0,
      serviceFeeUsd: order.service_fee_usd || 0,
      shippingFeeUsd: order.shipping_fee_usd || 0,
      exchangeRate: order.exchange_rate_used || 2800,
      
      // Status - normalized
      status: normalizeStatus(order.status),
      paymentStatus: payment?.status || order.maisha_payment_status || 'PENDING',
      
      // Timestamps
      created_at: order.created_at,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      shippedAt: order.shipped_at,
      deliveredAt: order.delivered_at,
      estimatedDelivery: order.estimated_delivery,
      paidAt: payment?.paid_at || null,
      
      // Shipping details
      shippingCity: order.shipping_city,
      trackingNumber: order.tracking_number,
      carrier: order.carrier,
      
      // Payment details
      payment_provider: 'maishapay',
      payment_ref: payment?.maishapay_transaction_ref_id || payment?.maishapay_operator_ref_id || order.operator_ref_id || order.maisha_transaction_id,
      confirmationCode: payment?.confirmation_code || null,
      
      // Items array - always present with ALL required fields
      items: (order.order_items || []).map((item: any) => ({
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

    console.log('[mobile-get-order-by-id] Returning order:', orderId);

    return jsonResponse({
      success: true,
      order: formattedOrder,
    });

  } catch (error: any) {
    console.error('[mobile-get-order-by-id] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});