import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation: base + (percentage × items subtotal)
// SAFEGUARD: shippingPercent MUST be in decimal form (0.10) not percent (10)
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  // Normalize: if > 1, treat as percent and divide by 100
  const normalizedPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
  return round2(shippingBaseFee + (itemsSubtotal * normalizedPercent));
}

// Calculate cart summary from items - single source of truth
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
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('[mobile-create-order-from-cart] Request received');

    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-create-order-from-cart] User authenticated:', user.id);

    // Get existing DRAFT order with items
    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error('[mobile-create-order-from-cart] Error fetching draft order:', orderFetchError);
      return jsonResponse({ 
        error: 'DB_FETCH_ERROR', 
        message: 'Failed to fetch cart data.',
        details: orderFetchError.message 
      }, 500);
    }

    if (!existingOrder) {
      console.log('[mobile-create-order-from-cart] No draft order found');
      return jsonResponse({ 
        error: 'EMPTY_CART', 
        message: 'Your cart is empty. Please add items before checkout.' 
      }, 400);
    }

    if (!existingOrder.order_items || existingOrder.order_items.length === 0) {
      console.log('[mobile-create-order-from-cart] Draft order has no items');
      return jsonResponse({ 
        error: 'EMPTY_CART', 
        message: 'Your cart is empty. Please add items before checkout.' 
      }, 400);
    }

    console.log('[mobile-create-order-from-cart] Found draft order:', {
      orderId: existingOrder.id,
      itemCount: existingOrder.order_items.length
    });

    // Get pricing settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      console.error('[mobile-create-order-from-cart] Error fetching settings:', settingsError);
      return jsonResponse({ 
        error: 'SETTINGS_ERROR', 
        message: 'Failed to load pricing configuration.',
        details: settingsError?.message 
      }, 500);
    }

    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Calculate totals using shared helper with dynamic shipping
    const summary = calculateCartSummary(
      existingOrder.order_items, 
      shippingBaseFeeUsd, 
      shippingPercent, 
      exchangeRate
    );

    console.log('[mobile-create-order-from-cart] Calculated totals:', summary);

    // Update existing DRAFT order to PENDING_PAYMENT status
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
      console.error('[mobile-create-order-from-cart] Error updating order:', {
        error: updateError,
        orderId: existingOrder.id,
        userId: user.id
      });
      
      return jsonResponse({ 
        error: 'DB_ORDER_UPDATE_FAILED', 
        message: 'Failed to finalize order. Please try again.',
        details: updateError.message,
        code: updateError.code
      }, 500);
    }

    if (!updatedOrder) {
      console.error('[mobile-create-order-from-cart] Order update returned no data');
      return jsonResponse({ 
        error: 'DB_ORDER_UPDATE_FAILED', 
        message: 'Failed to finalize order. Please try again.' 
      }, 500);
    }

    console.log('[mobile-create-order-from-cart] Order updated successfully:', {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      totalUsd: updatedOrder.total_usd,
      totalCdf: updatedOrder.total_cdf
    });

    // Return success with order details
    return jsonResponse({
      success: true,
      orderId: updatedOrder.id,
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
    });

  } catch (error: any) {
    console.error('[mobile-create-order-from-cart] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ 
      error: 'INTERNAL_ERROR', 
      message: 'An unexpected error occurred. Please try again.',
      details: error.message 
    }, 500);
  }
});
