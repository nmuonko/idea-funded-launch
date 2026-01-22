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
 * CRITICAL: Detect if price was USER edited using explicit signals
 * Supports BOTH mobile app (snake_case) AND web (camelCase) naming conventions
 */
function isUserEditedPrice(body: any): boolean {
  // Check explicit boolean flags (handle string "true" too)
  const priceEditedFlag = 
    body?.priceEdited === true ||
    String(body?.priceEdited ?? "").toLowerCase() === "true" ||
    body?.manual_price === true ||
    String(body?.manual_price ?? "").toLowerCase() === "true";
  
  // Check price_source (case-insensitive) - accept both "manual" and "manual_user"
  const priceSource = String(body?.price_source ?? body?.priceSource ?? "").toLowerCase();
  const isManualSource = priceSource === "manual_user" || priceSource === "manual";
  
  // Check if frontend explicitly set price_confirmation_status to 'pending'
  const confirmStatus = String(
    body?.price_confirmation_status ?? body?.priceConfirmationStatus ?? ""
  ).toLowerCase();
  const isPendingFromFrontend = confirmStatus === "pending";
  
  // Check for price difference between proposed and captured
  const capturedPrice = body?.capturedPrice ?? body?.captured_price ?? 
                        body?.capturedPriceUsd ?? body?.captured_price_usd ?? null;
  const productPrice = body?.productPrice ?? body?.price ?? body?.base_price_usd ?? null;
  const hasPriceDifference = capturedPrice !== null && productPrice !== null &&
    Math.abs(Number(productPrice) - Number(capturedPrice)) > 0.01;
  
  return priceEditedFlag || isManualSource || isPendingFromFrontend || hasPriceDifference;
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

    // COMPATIBILITY LAYER: Coalesce multiple possible image field keys
    // Priority: productImageUrl > image_url > imageUrl > product_image_url > thumbnail > photo > picture > productImage > image
    const rawImageUrl = 
      body.productImageUrl ?? 
      body.image_url ?? 
      body.imageUrl ?? 
      body.product_image_url ?? 
      body.thumbnail ??
      body.photo ??
      body.picture ??
      body.productImage ??
      body.image ??
      null;
    
    // Normalize: treat null/"" as missing, validate URL format
    let coalescedImageUrl: string | undefined = undefined;
    if (rawImageUrl && typeof rawImageUrl === 'string' && rawImageUrl.trim() !== '') {
      try {
        new URL(rawImageUrl.trim());
        coalescedImageUrl = rawImageUrl.trim();
      } catch {
        // Invalid URL - ignore
      }
    }
    
    console.log('[mobile-update-cart-item] Image coalesce:', {
      productImageUrl: !!body.productImageUrl,
      image_url: !!body.image_url,
      imageUrl: !!body.imageUrl,
      product_image_url: !!body.product_image_url,
      thumbnail: !!body.thumbnail,
      photo: !!body.photo,
      picture: !!body.picture,
      resolved: !!coalescedImageUrl,
    });

    // Store coalesced image for potential use in update
    body.productImageUrl = coalescedImageUrl;

    // Verify item belongs to user and is in a DRAFT order - select only needed columns
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .select('id, base_price_usd, quantity, saved_at, price_confirmation_status, captured_price, orders!inner(user_id, status, id)')
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
      
      // CRITICAL: Detect if price was USER edited using ONLY explicit signals
      const userEdited = isUserEditedPrice(body);
      const capturedPrice = body.capturedPrice ?? body.captured_price ?? item.captured_price ?? null;
      const currency = body.currency ?? 'USD';
      
      console.log('[PRICE_CONFIRM] UPDATE userEdited=', userEdited, 
        'priceEdited=', body.priceEdited,
        'manual_price=', body.manual_price,
        'price_source=', body.price_source,
        'newPrice=', newPrice,
        'capturedPrice=', capturedPrice);
      
      if (userEdited) {
        updateData.price_confirmation_status = 'PENDING';
        updateData.price_source = 'manual_user';
        if (capturedPrice !== null) {
          updateData.captured_price = capturedPrice;
        }
        
        // Get item details for the price_confirmations record
        const { data: itemDetails } = await supabase
          .from('order_items')
          .select('product_url, store, title, device_id')
          .eq('id', itemId)
          .single();
        
        // Extract device_id from request body (accept both naming conventions)
        const deviceId = body.deviceId ?? body.device_id ?? itemDetails?.device_id ?? null;
        
        const priceConfirmPayload = {
          user_id: user.id,
          user_email: user.email || null, // Store email for admin convenience
          device_id: deviceId, // Include device_id for linkage
          cart_item_id: itemId,
          product_url: itemDetails?.product_url || '',
          store: (itemDetails?.store || 'OTHER').toUpperCase(),
          proposed_price: newPrice,
          proposed_currency: currency.toUpperCase(),
          extracted_price: capturedPrice,
          extracted_currency: capturedPrice ? currency.toUpperCase() : null,
          extraction_source: capturedPrice ? 'structured' : 'manual',
          extraction_confidence: capturedPrice ? 0.8 : null,
          status: 'PENDING',
          updated_at: new Date().toISOString(),
        };
        
        // UPSERT using cart_item_id as unique key - NO SILENT FAILURES
        const { data: priceConfirmation, error: pcError } = await supabase
          .from('price_confirmations')
          .upsert(priceConfirmPayload, { 
            onConflict: 'cart_item_id',
            ignoreDuplicates: false 
          })
          .select('id')
          .single();
        
        // Structured log for debugging
        console.log('[PRICE_CONFIRM]', JSON.stringify({
          fn: 'mobile-update-cart-item',
          orderItemId: itemId,
          isManualPrice: true,
          price_source: 'manual_user',
          capturedPrice,
          proposedPrice: newPrice,
          upsertOk: !pcError,
          errorMsg: pcError?.message || null,
        }));
        
        if (pcError) {
          console.error('[mobile-update-cart-item] CRITICAL: price_confirmations upsert failed:', pcError);
          
          // FAIL the request - don't leave item in PENDING state without a tracking record
          return jsonResponse({
            ok: false,
            code: 'PRICE_CONFIRMATION_INSERT_FAILED',
            error: pcError.message,
            message: 'Price confirmation record could not be created. Update was not applied.',
          }, 500);
        }
        
        console.log('[mobile-update-cart-item] price_confirmations upserted:', priceConfirmation.id);
        updateData.price_confirmation_id = priceConfirmation.id;
        
        // Create admin notification for price review (non-blocking)
        const { error: notifError } = await supabase
          .from('admin_notifications')
          .insert({
            type: 'PRICE_REVIEW',
            title: 'Price confirmation needed',
            body: `User updated price for cart item. Review required.`,
            payload: {
              cart_item_id: itemId,
              user_id: user.id,
              captured_price: capturedPrice,
              user_price: newPrice,
              currency,
              price_confirmation_id: priceConfirmation.id,
            },
          });
        
        if (notifError) {
          console.error('[mobile-update-cart-item] Failed to create admin notification:', notifError);
          // Don't fail - notification is non-critical
        }
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
      .select('id, title, store, product_image_url, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf, is_saved_for_later, price_confirmation_status, price_source')
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
        priceSource: updatedItem.price_source,
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
