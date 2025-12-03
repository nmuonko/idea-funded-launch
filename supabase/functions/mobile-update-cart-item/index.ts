import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  corsHeaders, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-update-cart-item] User authenticated:', user.id);

    const url = new URL(req.url);
    const itemId = url.pathname.split('/').pop();

    if (!itemId) {
      return errorResponse('Item ID is required', 400);
    }

    const body = await req.json();
    console.log('[mobile-update-cart-item] Request body:', body);

    // Verify item belongs to user and is in a DRAFT order
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .select('*, orders!inner(user_id, status, id)')
      .eq('id', itemId)
      .single();

    if (itemError || !item) {
      return errorResponse('Item not found', 404);
    }

    if (item.orders.user_id !== user.id) {
      return errorResponse('Unauthorized', 403);
    }

    if (item.orders.status !== 'DRAFT') {
      return errorResponse('Cannot update submitted order', 400);
    }

    const orderId = item.orders.id;

    // Get pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    const markupPercent = settings?.markup_percent ?? settings?.global_markup_percent ?? 15;
    const exchangeRate = settings?.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings?.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings?.shipping_percent ?? 0.10;

    // Build update object
    const updateData: Record<string, any> = {};

    // Handle is_saved_for_later toggle
    if (typeof body.isSavedForLater === 'boolean') {
      updateData.is_saved_for_later = body.isSavedForLater;
      
      if (body.isSavedForLater && !item.saved_at) {
        // Setting to saved for the first time
        updateData.saved_at = new Date().toISOString();
      }
      // Note: We keep saved_at when un-saving for historical tracking
      
      console.log('[mobile-update-cart-item] Updating saved status:', {
        itemId,
        isSavedForLater: body.isSavedForLater,
        savedAt: updateData.saved_at || item.saved_at,
      });
    }

    // Handle quantity update
    if (typeof body.quantity === 'number' && body.quantity > 0) {
      const newQuantity = Math.floor(body.quantity);
      
      // Recalculate pricing with new quantity
      const pricing = calculateItemPricing(
        item.base_price_usd,
        newQuantity,
        markupPercent,
        exchangeRate
      );

      updateData.quantity = newQuantity;
      updateData.subtotal_usd = pricing.itemBaseTotalUsd;
      updateData.markup_fee_usd = pricing.itemMarginUsd;
      updateData.total_price_usd = pricing.itemSubtotalUsd;
      updateData.total_price_cdf = pricing.itemSubtotalCdf;

      console.log('[mobile-update-cart-item] Updating quantity:', {
        itemId,
        newQuantity,
        itemSubtotalUsd: pricing.itemSubtotalUsd,
      });
    }

    // If no valid updates, return error
    if (Object.keys(updateData).length === 0) {
      return errorResponse('No valid fields to update. Provide quantity or isSavedForLater.', 400);
    }

    // Update item
    const { data: updatedItem, error: updateError } = await supabase
      .from('order_items')
      .update(updateData)
      .eq('id', itemId)
      .select()
      .single();

    if (updateError) {
      console.error('[mobile-update-cart-item] Update error:', updateError);
      return errorResponse('Failed to update item', 500);
    }

    // UPDATE ORDER TOTALS after any change
    const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

    return jsonResponse({
      success: true,
      item: {
        id: updatedItem.id,
        productUrl: updatedItem.product_url,
        productTitle: updatedItem.title,
        productImageUrl: updatedItem.product_image_url,
        basePriceUsd: updatedItem.base_price_usd,
        quantity: updatedItem.quantity,
        itemBaseTotalUsd: updatedItem.subtotal_usd,
        itemMarginUsd: updatedItem.markup_fee_usd,
        itemSubtotalUsd: updatedItem.total_price_usd,
        itemSubtotalCdf: updatedItem.total_price_cdf,
        isSavedForLater: updatedItem.is_saved_for_later,
        savedAt: updatedItem.saved_at,
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
