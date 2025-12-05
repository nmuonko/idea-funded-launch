import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";

// Pricing helper - single source of truth for price calculations
function calculateItemPricing(
  basePriceUsd: number,
  quantity: number,
  markupPercent: number,
  exchangeRate: number
) {
  const itemBaseTotalUsd = round2(basePriceUsd * quantity);
  const itemMarginUsd = round2(itemBaseTotalUsd * (markupPercent / 100));
  const itemSubtotalUsd = round2(itemBaseTotalUsd + itemMarginUsd);
  const itemSubtotalCdf = round2(itemSubtotalUsd * exchangeRate);

  return {
    basePriceUsd: round2(basePriceUsd),
    quantity,
    itemBaseTotalUsd,
    itemMarginUsd,
    itemSubtotalUsd,
    itemSubtotalCdf,
  };
}

// Dynamic shipping calculation: base + (percentage × items subtotal)
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

// Calculate and persist order totals from ACTIVE items only
async function updateOrderTotals(
  supabase: any,
  orderId: string,
  shippingBaseFeeUsd: number,
  shippingPercent: number,
  exchangeRate: number
) {
  // Only include active items (not saved for later) in totals
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('subtotal_usd, markup_fee_usd, total_price_usd, quantity, is_saved_for_later')
    .eq('order_id', orderId);

  if (itemsError) {
    console.error('[updateOrderTotals] Failed to fetch items:', itemsError);
    return null;
  }

  let itemTotalUsd = 0;
  let serviceFeeUsd = 0;
  let itemsWithMarkupUsd = 0;
  let activeItemCount = 0;

  (items || []).forEach((item: any) => {
    // Only count active items
    if (!item.is_saved_for_later) {
      itemTotalUsd += Number(item.subtotal_usd || 0);
      serviceFeeUsd += Number(item.markup_fee_usd || 0);
      itemsWithMarkupUsd += Number(item.total_price_usd || 0);
      activeItemCount++;
    }
  });

  const shippingFeeUsd = activeItemCount > 0 
    ? calculateShipping(itemTotalUsd, shippingBaseFeeUsd, shippingPercent)
    : 0;
  
  const totalUsd = round2(itemsWithMarkupUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);

  console.log('[updateOrderTotals] Calculated totals:', {
    orderId,
    activeItemCount,
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
  });

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      item_total_usd: round2(itemTotalUsd),
      service_fee_usd: round2(serviceFeeUsd),
      shipping_fee_usd: round2(shippingFeeUsd),
      total_usd: totalUsd,
      total_cdf: totalCdf,
      exchange_rate_used: exchangeRate,
    })
    .eq('id', orderId);

  if (updateError) {
    console.error('[updateOrderTotals] Failed to update order totals:', updateError);
    return null;
  }

  return {
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
    exchangeRate,
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { user, supabase } = await verifyAndGetUser(req);

    const url = new URL(req.url);
    const itemId = url.pathname.split('/').pop();

    if (!itemId) {
      return errorResponse('Item ID is required', 400);
    }

    const body = await req.json();

    // Verify item belongs to user and is in a DRAFT order - select only needed columns
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .select('id, base_price_usd, saved_at, orders!inner(user_id, status, id)')
      .eq('id', itemId)
      .single();

    if (itemError || !item) {
      return errorResponse('Item not found', 404);
    }

    // Access joined order data (TypeScript workaround for !inner join)
    const orderData = item.orders as unknown as { user_id: string; status: string; id: string };
    
    if (orderData.user_id !== user.id) {
      return errorResponse('Unauthorized', 403);
    }

    if (orderData.status !== 'DRAFT') {
      return errorResponse('Cannot update submitted order', 400);
    }

    const orderId = orderData.id;

    // Get cached pricing settings
    const settings = await getCachedSettings(supabase);
    const { markupPercent, exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

    // Build update object
    const updateData: Record<string, any> = {};

    // Handle is_saved_for_later toggle - accept both camelCase and snake_case
    const savedForLaterValue = body.isSavedForLater ?? body.is_saved_for_later;
    if (typeof savedForLaterValue === 'boolean') {
      updateData.is_saved_for_later = savedForLaterValue;
      if (savedForLaterValue) {
        // Set saved_at timestamp when saving for later
        updateData.saved_at = new Date().toISOString();
      } else {
        // Clear saved_at when moving back to active cart
        updateData.saved_at = null;
      }
      console.log('[mobile-update-cart-item] Setting is_saved_for_later:', savedForLaterValue);
    }

    // Handle quantity update
    if (typeof body.quantity === 'number' && body.quantity > 0) {
      const newQuantity = Math.floor(body.quantity);
      const pricing = calculateItemPricing(item.base_price_usd, newQuantity, markupPercent, exchangeRate);
      updateData.quantity = newQuantity;
      updateData.subtotal_usd = pricing.itemBaseTotalUsd;
      updateData.markup_fee_usd = pricing.itemMarginUsd;
      updateData.total_price_usd = pricing.itemSubtotalUsd;
      updateData.total_price_cdf = pricing.itemSubtotalCdf;
    }

    // If no valid updates, return error
    if (Object.keys(updateData).length === 0) {
      return errorResponse('No valid fields to update. Provide quantity or isSavedForLater.', 400);
    }

    // Update item - select only needed columns
    const { data: updatedItem, error: updateError } = await supabase
      .from('order_items')
      .update(updateData)
      .eq('id', itemId)
      .select('id, title, store, product_image_url, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf, is_saved_for_later')
      .single();

    if (updateError) {
      console.error('[mobile-update-cart-item] Update error:', updateError.message);
      return errorResponse('Failed to update item', 500);
    }

    // Update order totals
    const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

    // Slim response
    return jsonResponse({
      success: true,
      item: {
        id: updatedItem.id,
        title: updatedItem.title,
        store: updatedItem.store,
        imageUrl: updatedItem.product_image_url,
        basePriceUsd: updatedItem.base_price_usd,
        quantity: updatedItem.quantity,
        subtotalUsd: updatedItem.subtotal_usd,
        totalUsd: updatedItem.total_price_usd,
        totalCdf: updatedItem.total_price_cdf,
        isSavedForLater: updatedItem.is_saved_for_later || false,
      },
      summary,
    });

  } catch (error: any) {
    console.error('[mobile-update-cart-item] Error:', error.message);
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error.message, 500);
  }
});
