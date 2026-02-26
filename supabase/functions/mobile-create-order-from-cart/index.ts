import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse,
  corsHeaders 
} from "../_shared/auth.ts";

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation: base + (percentage × items subtotal)
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  const normalizedPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
  return round2(shippingBaseFee + (itemsSubtotal * normalizedPercent));
}

// Calculate cart summary from items
function calculateCartSummary(
  items: any[], 
  shippingBaseFeeUsd: number, 
  shippingPercent: number,
  exchangeRate: number
) {
  let itemCount = 0;
  let totalItemsUsd = 0;
  let totalMarginUsd = 0;
  let itemsSubtotalUsd = 0;

  (items || []).forEach(item => {
    const qty = item.quantity || 1;
    itemCount += qty;
    totalItemsUsd += Number(item.subtotal_usd || 0);
    totalMarginUsd += Number(item.markup_fee_usd || 0);
    itemsSubtotalUsd += Number(item.total_price_usd || 0);
  });

  const shippingFeeUsd = items && items.length > 0 
    ? calculateShipping(totalItemsUsd, shippingBaseFeeUsd, shippingPercent)
    : 0;

  const grandTotalUsd = round2(itemsSubtotalUsd + shippingFeeUsd);
  const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

  return {
    itemCount,
    totalItemsUsd: round2(totalItemsUsd),
    totalMarginUsd: round2(totalMarginUsd),
    itemsSubtotalUsd: round2(itemsSubtotalUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    grandTotalUsd,
    grandTotalCdf,
    exchangeRate,
  };
}

serve(async (req) => {
  // Generate correlationId for tracing
  const correlationId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  
  // Parse environment from query or header
  const url = new URL(req.url);
  const env = url.searchParams.get('env') || req.headers.get('X-Afrishop-Environment') || 'prod';
  
  console.log(`[CREATE_ORDER] start correlationId=${correlationId} env=${env} method=${req.method}`);

  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log(`[CREATE_ORDER] correlationId=${correlationId} Request received`);

    // Verify user authentication using SDK-free helper
    let user: any;
    let supabase: any;
    try {
      const authResult = await verifyAndGetUser(req);
      user = authResult.user;
      supabase = authResult.supabase;
    } catch (authError: any) {
      console.log(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=UNAUTHENTICATED message=${authError.message}`);
      // Return HTTP 200 with JSON error (never non-2xx for auth)
      return jsonResponse({
        ok: false,
        success: false,
        error: 'UNAUTHENTICATED',
        message: 'Login required',
        correlationId,
      }, 200);
    }

    console.log(`[CREATE_ORDER] correlationId=${correlationId} userId=${user.id}`);

    // Get existing DRAFT order with items
    let { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=DB_FETCH_ERROR message=${orderFetchError.message}`);
      return jsonResponse({ 
        ok: false,
        success: false,
        error: 'DB_FETCH_ERROR', 
        message: 'Failed to fetch cart data.',
        correlationId,
        details: orderFetchError.message 
      }, 200);
    }

    // FALLBACK: If no DRAFT order, check for a recent PENDING_PAYMENT order that can be reused
    if (!existingOrder) {
      console.log(`[CREATE_ORDER] correlationId=${correlationId} No draft order found, checking for recent PENDING_PAYMENT...`);
      
      const { data: pendingOrder, error: pendingFetchError } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('user_id', user.id)
        .eq('status', 'PENDING_PAYMENT')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingFetchError) {
        console.error(`[CREATE_ORDER] correlationId=${correlationId} Error fetching pending order:`, pendingFetchError.message);
      }

      if (pendingOrder && pendingOrder.order_items && pendingOrder.order_items.length > 0) {
        const updatedAt = new Date(pendingOrder.updated_at);
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        
        if (updatedAt > thirtyMinutesAgo) {
          console.log(`[CREATE_ORDER] correlationId=${correlationId} Reusing recent PENDING_PAYMENT order: orderId=${pendingOrder.id}`);
          existingOrder = pendingOrder;
        }
      }
    }

    if (!existingOrder) {
      console.log(`[CREATE_ORDER] correlationId=${correlationId} No draft order found`);
      return jsonResponse({ 
        ok: false,
        success: false,
        error: 'EMPTY_CART', 
        message: 'Your cart is empty. Please add items before checkout.',
        correlationId,
      }, 200);
    }

    if (!existingOrder.order_items || existingOrder.order_items.length === 0) {
      console.log(`[CREATE_ORDER] correlationId=${correlationId} Order has no items`);
      return jsonResponse({ 
        ok: false,
        success: false,
        error: 'EMPTY_CART', 
        message: 'Your cart is empty. Please add items before checkout.',
        correlationId,
      }, 200);
    }

    console.log(`[CREATE_ORDER] correlationId=${correlationId} Found order: orderId=${existingOrder.id} itemCount=${existingOrder.order_items.length}`);

    // Get pricing settings from cache (avoids redundant DB reads)
    const { getCachedGlobalSettings } = await import("../_shared/settingsMemoryCache.ts");
    const settings = await getCachedGlobalSettings(supabase) as Record<string, any>;
    const settingsError = !settings || Object.keys(settings).length === 0 ? { message: 'Empty settings' } : null;

    if (settingsError || !settings) {
      console.error(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=SETTINGS_ERROR message=${settingsError?.message}`);
      return jsonResponse({ 
        ok: false,
        success: false,
        error: 'SETTINGS_ERROR', 
        message: 'Failed to load pricing configuration.',
        correlationId,
        details: settingsError?.message 
      }, 200);
    }

    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Calculate totals
    const summary = calculateCartSummary(
      existingOrder.order_items, 
      shippingBaseFeeUsd, 
      shippingPercent, 
      exchangeRate
    );

    console.log(`[CREATE_ORDER] correlationId=${correlationId} Calculated totals: grandTotalUsd=${summary.grandTotalUsd}`);

    // Update existing order to PENDING_PAYMENT status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'PENDING_PAYMENT',
        item_total_usd: summary.totalItemsUsd,
        service_fee_usd: summary.totalMarginUsd,
        shipping_fee_usd: summary.shippingFeeUsd,
        total_usd: summary.grandTotalUsd,
        total_cdf: summary.grandTotalCdf,
        exchange_rate_used: exchangeRate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingOrder.id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=DB_ORDER_UPDATE_FAILED orderId=${existingOrder.id} message=${updateError.message}`);
      
      return jsonResponse({ 
        ok: false,
        success: false,
        error: 'DB_ORDER_UPDATE_FAILED', 
        message: 'Failed to finalize order. Please try again.',
        correlationId,
        details: updateError.message,
      }, 200);
    }

    if (!updatedOrder) {
      console.error(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=DB_ORDER_UPDATE_FAILED No data returned`);
      return jsonResponse({ 
        ok: false,
        success: false,
        error: 'DB_ORDER_UPDATE_FAILED', 
        message: 'Failed to finalize order. Please try again.',
        correlationId,
      }, 200);
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[CREATE_ORDER] success correlationId=${correlationId} orderId=${updatedOrder.id} totalUsd=${updatedOrder.total_usd} ms=${elapsedMs}`);

    // Extract order item IDs for the checkout step
    const orderItemIds = existingOrder.order_items.map((item: any) => item.id);

    // Return success with order details
    // Include BOTH camelCase and snake_case for mobile/web compatibility
    return jsonResponse({
      ok: true,
      success: true,
      correlationId,
      // snake_case for web compatibility
      order_id: updatedOrder.id,
      order_item_ids: orderItemIds,
      // camelCase for mobile compatibility
      orderId: updatedOrder.id,
      orderItemIds: orderItemIds,
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        itemCount: summary.itemCount,
        totalItemsUsd: summary.totalItemsUsd,
        totalMarginUsd: summary.totalMarginUsd,
        shippingFeeUsd: summary.shippingFeeUsd,
        grandTotalUsd: summary.grandTotalUsd,
        grandTotalCdf: summary.grandTotalCdf,
        exchangeRate: exchangeRate,
      }
    }, 200);

  } catch (error: any) {
    const elapsedMs = Date.now() - startTime;
    console.error(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=INTERNAL_ERROR message=${error.message} ms=${elapsedMs}`, error.stack);
    
    // Return HTTP 200 with JSON error (never non-2xx)
    return jsonResponse({ 
      ok: false,
      success: false,
      error: 'INTERNAL_ERROR', 
      message: 'An unexpected error occurred. Please try again.',
      correlationId,
      details: error.message 
    }, 200);
  }
});
