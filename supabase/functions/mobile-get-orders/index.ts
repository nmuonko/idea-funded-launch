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
    console.log('[mobile-get-orders] User authenticated:', user.id);

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const offset = (page - 1) * pageSize;

    // Get orders with items included
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, 
        created_at, 
        shipping_city, 
        total_usd, 
        total_cdf, 
        status,
        maisha_transaction_id,
        tracking_number,
        carrier,
        shipped_at,
        delivered_at,
        order_items(
          id,
          title,
          store,
          product_url,
          product_image_url,
          unit_price_usd,
          quantity,
          subtotal_usd,
          shipping_status
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

    // Get confirmation codes from maisha_payments
    const orderIds = orders?.map(o => o.id) || [];
    let confirmationCodes: Record<string, string> = {};
    
    if (orderIds.length > 0) {
      const { data: payments } = await supabase
        .from('maisha_payments')
        .select('order_id, confirmation_code')
        .in('order_id', orderIds)
        .not('confirmation_code', 'is', null);
      
      if (payments) {
        confirmationCodes = payments.reduce((acc, p) => {
          if (p.confirmation_code) acc[p.order_id] = p.confirmation_code;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    // Format response with items included
    const formattedOrders = orders?.map(o => ({
      id: o.id,
      orderRef: o.id.substring(0, 8).toUpperCase(),
      createdAt: o.created_at,
      shippingCity: o.shipping_city,
      totalUsd: o.total_usd,
      totalCdf: o.total_cdf,
      status: o.status,
      trackingNumber: o.tracking_number,
      carrier: o.carrier,
      shippedAt: o.shipped_at,
      deliveredAt: o.delivered_at,
      confirmationCode: confirmationCodes[o.id] || null,
      items: o.order_items?.map((item: any) => ({
        id: item.id,
        title: item.title,
        storeName: item.store,
        productUrl: item.product_url,
        imageUrl: item.product_image_url,
        priceUsd: item.unit_price_usd,
        quantity: item.quantity,
        subtotalUsd: item.subtotal_usd,
        shippingStatus: item.shipping_status,
      })) || [],
    })) || [];

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
