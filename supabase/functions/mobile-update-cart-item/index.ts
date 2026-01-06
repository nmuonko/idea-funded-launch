import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
import { calculateItemPricing, updateOrderTotals } from "../_shared/cartHelpers.ts";

/**
 * Detect if price was edited by user (requires admin confirmation)
 * Accepts both camelCase and snake_case from payload/meta
 */
function detectPriceEdited(body: Record<string, any>, currentPrice: number): { 
  priceEdited: boolean; 
  capturedRef: number | undefined;
  editedRef: number | undefined;
  priceSource: string | undefined;
} {
  const meta = body.meta || {};
  
  // Normalize price confirmation status (case-insensitive)
  const explicitPendingStatus = 
    String(body.price_confirmation_status || body.priceConfirmationStatus || 
           meta.price_confirmation_status || meta.priceConfirmationStatus || '')
      .toUpperCase().trim() === 'PENDING';
  
  // Get price references
  const capturedRef = body.capturedPrice ?? meta.capturedPrice ?? meta.capturedPriceUsd ?? meta.captured_price;
  const editedRef = body.editedPrice ?? body.productPrice ?? meta.edited_price;
  const priceSource = body.price_source ?? meta.price_source;
  
  // Compute edited flag from multiple signals
  const priceEdited = 
    // Explicit edit flags
    body.priceEdited === true ||
    meta.priceEdited === true ||
    meta.price_was_modified === true ||
    // Explicit pending status from payload
    explicitPendingStatus ||
    // Price source indicates manual/edited
    priceSource === 'manual' || priceSource === 'edited' ||
    // originalPriceUsd or capturedPriceUsd presence indicates edit tracking
    meta.originalPriceUsd !== undefined ||
    meta.capturedPriceUsd !== undefined ||
    // editedPrice exists and differs from capturedPrice
    (editedRef !== undefined && capturedRef !== undefined && Math.abs(Number(editedRef) - Number(capturedRef)) > 0.01) ||
    // New price (productPrice) differs from captured price
    (capturedRef !== undefined && body.productPrice !== undefined && Math.abs(Number(body.productPrice) - Number(capturedRef)) > 0.01);
  
  return { priceEdited, capturedRef, editedRef, priceSource };
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
      .select('id, base_price_usd, quantity, saved_at, price_confirmation_status, orders!inner(user_id, status, id)')
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

    // Handle price update with confirmation detection
    const newPrice = body.productPrice ?? body.price ?? body.base_price_usd;
    if (typeof newPrice === 'number' && newPrice > 0) {
      const quantity = body.quantity ?? item.quantity ?? 1;
      const pricing = calculateItemPricing(newPrice, quantity, markupPercent, exchangeRate);
      updateData.base_price_usd = round2(newPrice);
      updateData.unit_price_usd = round2(newPrice);
      updateData.subtotal_usd = pricing.itemBaseTotalUsd;
      updateData.markup_fee_usd = pricing.itemMarginUsd;
      updateData.total_price_usd = pricing.itemSubtotalUsd;
      updateData.total_price_cdf = pricing.itemSubtotalCdf;
      
      // Detect if price was edited by user (requires admin confirmation)
      const { priceEdited, capturedRef, editedRef, priceSource } = detectPriceEdited(body, newPrice);
      
      console.log('[PRICE_CONFIRM] UPDATE edited=', priceEdited, 'newPrice=', newPrice, 
        'captured=', capturedRef, 'editedPrice=', editedRef, 'priceSource=', priceSource);
      
      if (priceEdited) {
        updateData.price_confirmation_status = 'PENDING';
        console.log('[mobile-update-cart-item] Price edited - setting price_confirmation_status=PENDING');
      }
    }

    // If no valid updates, return error
    if (Object.keys(updateData).length === 0) {
      return errorResponse('No valid fields to update. Provide quantity, productPrice, or isSavedForLater.', 400);
    }

    // Update item - select only needed columns
    const { data: updatedItem, error: updateError } = await supabase
      .from('order_items')
      .update(updateData)
      .eq('id', itemId)
      .select('id, title, store, product_image_url, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf, is_saved_for_later, price_confirmation_status')
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
        priceConfirmationStatus: updatedItem.price_confirmation_status,
      },
      summary,
    });

  } catch (error: any) {
    console.error('[mobile-update-cart-item] Error:', error.message);
    
    // Return structured error - NEVER delete cart on transient errors
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false, 
        code: 'AUTH_ERROR', 
        message: error.message 
      }, error.status);
    }
    
    // For other errors, return structured error but preserve cart state
    return jsonResponse({ 
      ok: false, 
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem updating cart item. Please try again.' 
    }, 500);
  }
});
