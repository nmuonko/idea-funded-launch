import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
import { isMobileClient } from "../_shared/mobileCatalogHandler.ts";
import { normalizeCategorySlug, getCategoryLabel } from "../_shared/shippingCategory.ts";
import { isBlockedImageUrl } from "../_shared/imageValidation.ts";
import { lookupCartItemMediaCounts } from "../_shared/mediaCache.ts";

// Heavy threshold for manual quote requirement (non-vehicles)
const HEAVY_THRESHOLD_KG = 9;
const EXTRA_PER_KG_USD = 8;

// Calculate shipping for a REGULAR (non-vehicle) item using settings
// SAFEGUARD: shippingPercent MUST be in decimal form (0.10) not percent (10)
function calculateItemShipping(
  subtotalUsd: number, 
  estWeightKg: number,
  shippingBaseFeeUsd: number,
  shippingPercent: number
): number {
  // Normalize: if > 1, treat as percent and divide by 100
  const normalizedPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
  const basePart = shippingBaseFeeUsd + (subtotalUsd * normalizedPercent);
  const extraWeight = Math.max(0, estWeightKg - 1);
  const extraPart = extraWeight * EXTRA_PER_KG_USD;
  return round2(basePart + extraPart);
}

/**
 * CRITICAL: Normalize an image URL to be a valid absolute https URL for React Native.
 * Also checks against blocklist to filter out generic logos.
 * Handles:
 * - Protocol-relative URLs: //cdn.example.com/image.jpg -> https://cdn.example.com/image.jpg
 * - Relative URLs: /images/product.jpg -> https://origin.com/images/product.jpg
 * - Blocklist filtering for generic logos (Amazon logo, placeholders, etc.)
 * - Whitespace trimming
 * - Validation via URL constructor
 */
function normalizeImageUrl(raw: unknown, productUrl?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // Ignore non-web URIs
  if (s.startsWith("data:") || s.startsWith("blob:")) return null;

  // Protocol-relative → https
  if (s.startsWith("//")) {
    s = "https:" + s;
  }

  // Relative path → resolve against product URL origin (if available)
  if (s.startsWith("/") || (!s.startsWith("http://") && !s.startsWith("https://"))) {
    if (productUrl) {
      try {
        const base = new URL(productUrl);
        s = new URL(s, base.origin).toString();
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  // Final validation
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    
    const validatedUrl = u.toString();
    
    // CRITICAL: Check against blocklist to filter out generic logos
    if (isBlockedImageUrl(validatedUrl)) {
      console.log('[mobile-get-cart] Blocked generic image:', validatedUrl.substring(0, 60));
      return null;
    }
    
    return validatedUrl;
  } catch {
    return null;
  }
}

/**
 * Format item for response - STABLE SCHEMA for all item types
 * Every item has: id, type, title, price fields, quote_status, shipping_cost, updated_at
 * Includes image_count from media cache when available
 */
function formatItem(
  item: any, 
  markupPercent: number, 
  vehicleMarkupPercent: number, 
  exchangeRate: number,
  mediaInfo?: { image_count: number; image_count_status: "cached" | "pending" }
) {
  const basePriceUsd = Number(item.base_price_usd || 0);
  const quantity = item.quantity || 1;
  const estWeightKg = Number(item.est_weight_kg || 1);
  const isVehicle = item.is_vehicle === true;
  const vehicleQuoteApplied = item.vehicle_quote_applied === true;
  
  // Get quote request info - ALWAYS include regardless of status
  const quoteRequest = item.quote_requests?.[0];
  const quoteStatus = quoteRequest?.status || (isVehicle && !vehicleQuoteApplied ? 'PENDING' : null);
  const quotedShippingUsd = quoteRequest?.quoted_shipping_usd ?? null;
  const quotedTotalUsd = quoteRequest?.quoted_total_usd ?? null;
  
  // CRITICAL: Price confirmation - check ONLY the DB column, not meta fields
  const priceConfirmationStatus = item.price_confirmation_status ?? null;
  const adminAdjustedPrice = item.admin_adjusted_price ?? null;
  const priceConfirmationId = item.price_confirmation_id ?? null;
  const priceSource = item.price_source ?? null;
  const capturedPrice = item.captured_price ?? null;
  
  // SIMPLE check: is the item PENDING based on DB column only
  const hasPendingPriceConfirmation = String(priceConfirmationStatus || '').toUpperCase().trim() === 'PENDING';
  
  // CRITICAL: Normalize image URL to handle protocol-relative (//...) and relative (/...) URLs
  // This is essential for React Native which requires absolute https URLs
  const safeImageUrl = normalizeImageUrl(item.product_image_url, item.product_url);
  
  // Image count from media cache or default to 1
  const imageCount = mediaInfo?.image_count ?? 1;
  const imageCountStatus = mediaInfo?.image_count_status ?? "pending";
  
  // STABLE BASE FIELDS for all items
  const baseFields = {
    id: item.id,
    type: isVehicle ? 'vehicle' : 'product',  // STABLE TYPE FIELD
    productUrl: item.product_url,
    productTitle: item.title || null,
    title: item.title || null,  // Alias for consistency
    productImageUrl: safeImageUrl,
    mainImageUrl: safeImageUrl,  // Alias for consistency
    image_url: safeImageUrl,
    store: item.store,
    quantity: isVehicle ? 1 : quantity,
    estWeightKg,
    isSavedForLater: item.is_saved_for_later || false,
    savedAt: item.saved_at || null,
    updatedAt: item.updated_at || null,
    // Image count from media cache
    image_count: imageCount,
    imageCount: imageCount,
    image_count_status: imageCountStatus,
    // Quote fields - ALWAYS present (null if not applicable)
    quoteStatus,
    quotedShippingUsd,
    quotedTotalUsd,
    isVehicle,
    vehicleQuoteApplied,
    // Price confirmation fields - CRITICAL for mobile app checkout blocking
    priceConfirmationStatus,
    adminAdjustedPrice,
    priceConfirmationId,
    priceSource,
    capturedPrice,
    hasPendingPriceConfirmation,
    // Device ID for guest tracking
    deviceId: item.device_id || null,
  };
  
  // VEHICLE WITH APPLIED QUOTE - use STORED values
  if (isVehicle && vehicleQuoteApplied) {
    const storedBase = Number(item.base_price_usd || 0);
    const storedMargin = Number(item.markup_fee_usd || 0);
    const storedShipping = Number(item.shipping_fee_usd || 0);
    const storedTotal = Number(item.total_price_usd || 0);
    const subtotalBeforeShipping = round2(storedBase + storedMargin);
    
    console.log('[mobile-get-cart] Vehicle WITH quote:', {
      itemId: item.id,
      storedBase, storedMargin, storedShipping, storedTotal
    });
    
    return {
      ...baseFields,
      basePriceUsd: storedBase,
      unitPriceUsd: storedBase,
      itemBaseTotalUsd: storedBase,
      itemMarginUsd: storedMargin,
      itemShippingUsd: storedShipping,
      shippingCost: storedShipping,  // STABLE FIELD NAME
      shippingStatus: 'QUOTED',      // Shipping has been quoted by admin
      itemSubtotalUsd: subtotalBeforeShipping,
      itemTotalUsd: storedTotal,
      price: storedTotal,  // STABLE FIELD NAME for total
      itemSubtotalCdf: round2(storedTotal * exchangeRate),
      requiresManualQuote: false,
      isQuoteRequired: false,
      shippingItemType: null,
    };
  }
  
  // VEHICLE WITHOUT QUOTE - pending, show estimated values
  if (isVehicle && !vehicleQuoteApplied) {
    const estimatedMargin = round2(basePriceUsd * (vehicleMarkupPercent / 100));
    const estimatedSubtotal = round2(basePriceUsd + estimatedMargin);
    
    console.log('[mobile-get-cart] Vehicle PENDING quote:', {
      itemId: item.id,
      basePriceUsd, estimatedMargin, estimatedSubtotal
    });
    
    return {
      ...baseFields,
      basePriceUsd,
      unitPriceUsd: basePriceUsd,
      itemBaseTotalUsd: basePriceUsd,
      itemMarginUsd: estimatedMargin,
      itemShippingUsd: 0,
      shippingCost: null,           // Pending quote - no shipping yet
      shippingStatus: 'PENDING',    // Shipping quote pending from admin
      itemSubtotalUsd: estimatedSubtotal,
      itemTotalUsd: estimatedSubtotal,  // No shipping included yet
      price: estimatedSubtotal,     // Display price (without shipping)
      itemSubtotalCdf: round2(estimatedSubtotal * exchangeRate),
      requiresManualQuote: true,
      isQuoteRequired: true,
      shippingItemType: null,
      vehicleMarkupPercent,
    };
  }
  
  // REGULAR PRODUCT - calculate as normal
  // Respect the database value for requires_manual_quote
  // This ensures vehicles detected at add-time are properly flagged
  const itemRequiresQuote = item.requires_manual_quote === true;
  
  // ALWAYS calculate from fresh settings - never use stored markup_fee_usd
  // This ensures admin markup changes reflect instantly in cart
  const itemBaseTotalUsd = round2(basePriceUsd * quantity);
  const itemMarginUsd = round2(itemBaseTotalUsd * (markupPercent / 100));
  const itemSubtotalUsd = round2(itemBaseTotalUsd + itemMarginUsd);
  const itemSubtotalCdf = round2(itemSubtotalUsd * exchangeRate);

  return {
    ...baseFields,
    basePriceUsd,
    unitPriceUsd: basePriceUsd,
    itemBaseTotalUsd,
    itemMarginUsd,
    itemShippingUsd: 0,
    shippingCost: 0,
    itemSubtotalUsd,
    itemTotalUsd: itemSubtotalUsd,
    price: itemSubtotalUsd,
    itemSubtotalCdf,
    requiresManualQuote: itemRequiresQuote,
    isQuoteRequired: false,
    shippingItemType: item.shipping_item_types ? {
      key: normalizeCategorySlug(item.shipping_item_types.key) || item.shipping_item_types.key,
      label: getCategoryLabel(normalizeCategorySlug(item.shipping_item_types.key)) || item.shipping_item_types.label,
    } : null,
  };
}

serve(async (req) => {
  const startTime = Date.now();
  
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    const authTime = Date.now() - startTime;

    console.log('[GET_CART_DEBUG] User authenticated:', user.id);

    // DYNAMIC PLATFORM DETECTION: fire-and-forget update
    // Detects mobile vs web on every cart load and updates profile
    try {
      const detectedPlatform = isMobileClient(req) ? 'mobile' : 'web';
      supabase
        .from('profiles')
        .update({ last_active_platform: detectedPlatform })
        .eq('user_id', user.id)
        .then(({ error }) => {
          if (error) console.warn('[PLATFORM_DETECT] Update failed:', error.message);
          else console.log('[PLATFORM_DETECT]', user.id, '→', detectedPlatform);
        });
    } catch (e) {
      console.warn('[PLATFORM_DETECT] Detection error:', e);
    }

    // Get cached pricing settings (5min TTL) - SINGLE SOURCE OF TRUTH
    const settingsStart = Date.now();
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent } = settings;
    const settingsTime = Date.now() - settingsStart;

    // SHARED CART RESOLUTION: Same logic as mobile-add-cart-item
    // Returns the single DRAFT order for this user, creating if needed
    const orderStart = Date.now();
    const { data: drafts, error: orderError } = await supabase
      .from('orders')
      .select('id, item_total_usd, service_fee_usd, shipping_fee_usd, total_usd, total_cdf, exchange_rate_used, requires_manual_quote, created_at, cart_version')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .order('created_at', { ascending: false });
    const orderTime = Date.now() - orderStart;

    if (orderError) {
      console.error('[GET_CART_DEBUG] Order query error:', orderError.message);
    }

    console.log('[GET_CART_DEBUG] { userId:', user.id, ', draftsFound:', drafts?.length || 0, '}');

    // Handle no drafts - return empty cart
    if (!drafts || drafts.length === 0) {
      console.log(`[GET_CART_DEBUG] Empty cart. PERF auth=${authTime}ms settings=${settingsTime}ms order=${orderTime}ms total=${Date.now() - startTime}ms`);
      return jsonResponse({
        ok: true,
        activeItems: [],
        savedItems: [],
        summary: {
          cartId: null,
          itemCount: 0,
          itemsTotalUsd: 0,
          markupFeeUsd: 0,
          shippingFeeUsd: 0,
          totalUsd: 0,
          totalCdf: 0,
          exchangeRate,
          requiresManualQuote: false,
          hasVehicleItems: false,
          vehicleQuoteStatus: 'none',
          canProceedToPayment: true,
          hasPendingPriceConfirmation: false,
          pendingPriceConfirmationCount: 0,
        }
      });
    }

    // If multiple drafts exist, merge them into the most recent using batch RPC
    let order = drafts[0];
    if (drafts.length > 1) {
      console.log('[GET_CART_DEBUG] Multiple DRAFT orders found, merging with RPC...');
      const primaryId = order.id;
      const secondaryIds = drafts.slice(1).map(d => d.id);
      
      // Use batched RPC for atomic merge operation
      const { data: mergeResult, error: mergeError } = await supabase.rpc('merge_draft_orders', {
        p_primary_id: primaryId,
        p_secondary_ids: secondaryIds
      });
      
      if (mergeError) {
        console.error('[GET_CART_DEBUG] Merge RPC failed, falling back to sequential:', mergeError.message);
        for (const oldDraft of drafts.slice(1)) {
          await supabase.from('order_items').update({ order_id: primaryId }).eq('order_id', oldDraft.id);
          await supabase.from('orders').delete().eq('id', oldDraft.id);
        }
      } else {
        console.log('[GET_CART_DEBUG] Merged via RPC:', mergeResult);
      }
    }

    console.log('[GET_CART_DEBUG] Using cartId:', order.id);

    // Get items with quote requests and price confirmations - SINGLE QUERY with join
    const itemsStart = Date.now();
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        id, product_url, title, product_image_url, store, base_price_usd, unit_price_usd, quantity,
        subtotal_usd, markup_fee_usd, shipping_fee_usd, total_price_usd, total_price_cdf, 
        est_weight_kg, requires_manual_quote, is_saved_for_later, saved_at, updated_at,
        is_vehicle, vehicle_quote_applied, device_id,
        price_confirmation_status, admin_adjusted_price, price_confirmation_id, price_source, captured_price,
        shipping_item_types(key, label),
        quote_requests(status, quoted_shipping_usd, quoted_total_usd)
      `)
      .eq('order_id', order.id);
    const itemsTime = Date.now() - itemsStart;

    if (itemsError) {
      console.error('[GET_CART_DEBUG] Items error:', itemsError.message);
    }

    console.log('[CART_DEBUG]', JSON.stringify({ fn: 'get-cart', userId: user.id, cartId: order.id, action: 'items_loaded', itemCount: items?.length || 0 }));

    // MEDIA CACHE LOOKUP: Get exact image counts for cart items (no prefetch to keep cart fast)
    const productUrls = (items || []).map(item => item.product_url).filter(Boolean);
    const mediaCacheStart = Date.now();
    const mediaLookup = await lookupCartItemMediaCounts(supabase, productUrls);
    const mediaCacheTime = Date.now() - mediaCacheStart;
    console.log(`[GET_CART_DEBUG] Media cache lookup: ${mediaLookup.size} results in ${mediaCacheTime}ms`);

    // Separate active and saved items
    const activeItems: any[] = [];
    const savedItems: any[] = [];
    
    // Track vehicles and regular items separately for summary
    let regularItemCount = 0;
    let regularItemsBaseTotal = 0;
    let regularItemsMarginTotal = 0;
    let regularItemsSubtotal = 0;
    let regularRequiresQuote = false;
    
    // Vehicle tracking
    let vehicleCount = 0;
    let vehicleBasePriceTotal = 0;
    let vehicleMarginTotal = 0;
    let vehicleShippingTotal = 0;
    let vehicleTotalUsd = 0;
    let hasVehicleItems = false;
    let allVehiclesQuoted = true;
    let vehiclesWithPendingQuotes: string[] = [];

    // CRITICAL: Price confirmation tracking for checkout blocking
    // Check ONLY the DB column price_confirmation_status, NOT meta fields
    let pendingPriceConfirmations: string[] = [];
    let hasPendingPriceConfirmation = false;

    (items || []).forEach(item => {
      // Get media info for this item from cache lookup
      const mediaInfo = mediaLookup.get(item.product_url);
      const formattedItem = formatItem(item, markupPercent, vehicleMarkupPercent, exchangeRate, mediaInfo);
      
      if (item.is_saved_for_later) {
        savedItems.push(formattedItem);
        return;
      }
      
      activeItems.push(formattedItem);
      
      // Track pending price confirmations - ONLY check DB column
      if (formattedItem.hasPendingPriceConfirmation) {
        hasPendingPriceConfirmation = true;
        pendingPriceConfirmations.push(item.id);
      }
      
      if (formattedItem.isVehicle) {
        vehicleCount++;
        hasVehicleItems = true;
        
        if (formattedItem.vehicleQuoteApplied) {
          vehicleBasePriceTotal += formattedItem.itemBaseTotalUsd;
          vehicleMarginTotal += formattedItem.itemMarginUsd;
          vehicleShippingTotal += formattedItem.itemShippingUsd;
          vehicleTotalUsd += formattedItem.itemTotalUsd;  // Use itemTotalUsd (base+margin+shipping)
        } else {
          allVehiclesQuoted = false;
          vehiclesWithPendingQuotes.push(item.id);
          vehicleBasePriceTotal += formattedItem.itemBaseTotalUsd;
          vehicleMarginTotal += formattedItem.itemMarginUsd;  // Include estimated margin
        }
      } else {
        regularItemCount += formattedItem.quantity;
        regularItemsBaseTotal += formattedItem.itemBaseTotalUsd;
        regularItemsMarginTotal += formattedItem.itemMarginUsd;
        regularItemsSubtotal += formattedItem.itemSubtotalUsd;
        
        if (formattedItem.requiresManualQuote) {
          regularRequiresQuote = true;
        }
      }
    });

    // Calculate shipping for regular items ONLY
    // SAFEGUARD: Normalize shippingPercent (if > 1, treat as percent and divide by 100)
    const normalizedShippingPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
    let regularShippingTotal = 0;
    const activeRegularCount = activeItems.filter(i => !i.isVehicle).length;
    if (!regularRequiresQuote && regularItemsBaseTotal > 0) {
      regularShippingTotal = round2(shippingBaseFeeUsd + (regularItemsBaseTotal * normalizedShippingPercent));
      
      // Calculate per-item shipping contribution so mobile can recalculate for selected items
      // Each item gets: (baseFee / itemCount) + (itemBaseTotal * shippingPercent)
      const perItemBaseFee = activeRegularCount > 0 ? round2(shippingBaseFeeUsd / activeRegularCount) : 0;
      activeItems.forEach(item => {
        if (!item.isVehicle) {
          item.itemShippingUsd = round2(perItemBaseFee + (item.itemBaseTotalUsd * normalizedShippingPercent));
          item.shippingCost = item.itemShippingUsd;
        }
      });
    }

    // GRAND TOTALS - consistent with updateOrderTotals in cartHelpers.ts
    const totalItemCount = regularItemCount + vehicleCount;
    
    // Item totals = base prices from regular items + vehicle base prices
    const itemsBaseTotalUsd = round2(regularItemsBaseTotal + vehicleBasePriceTotal);
    
    // Margin = regular margins + vehicle margins
    const totalMarginUsd = round2(regularItemsMarginTotal + vehicleMarginTotal);
    
    // Shipping = regular shipping + vehicle shipping (only for quoted vehicles)
    const totalShippingUsd = round2(regularShippingTotal + vehicleShippingTotal);
    
    // Grand total = items + margin + shipping
    const grandTotalUsd = round2(itemsBaseTotalUsd + totalMarginUsd + totalShippingUsd);
    const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

    // Determine vehicle quote status
    let vehicleQuoteStatus: 'none' | 'pending' | 'quoted' = 'none';
    if (hasVehicleItems) {
      vehicleQuoteStatus = allVehiclesQuoted ? 'quoted' : 'pending';
    }

    // CRITICAL: Checkout is blocked if there are pending price confirmations
    const canProceedToPayment = !regularRequiresQuote && 
                                 (!hasVehicleItems || allVehiclesQuoted) && 
                                 !hasPendingPriceConfirmation;

    // LEAN SUMMARY - only fields mobile needs
    // CRITICAL: Always use settings exchangeRate as source of truth (not order.exchange_rate_used)
    const summary: Record<string, any> = {
      cartId: order.id,
      cartVersion: order.cart_version || 1, // Include for version mismatch detection
      itemCount: totalItemCount,
      itemsTotalUsd: itemsBaseTotalUsd,
      markupFeeUsd: totalMarginUsd,
      shippingFeeUsd: totalShippingUsd,
      // Shipping status for mobile UI
      shippingStatus: hasVehicleItems 
        ? (allVehiclesQuoted ? 'QUOTED' : 'PENDING_QUOTE')
        : (regularRequiresQuote ? 'PENDING_QUOTE' : 'CALCULATED'),
      totalUsd: grandTotalUsd,
      totalCdf: grandTotalCdf,
      // ALWAYS use settings exchange rate for consistency with admin panel
      exchangeRate: exchangeRate,
      requiresManualQuote: regularRequiresQuote,
      savedItemCount: savedItems.length,
      hasVehicleItems,
      vehicleQuoteStatus,
      allVehiclesQuoted,
      vehiclesWithPendingQuotes: vehiclesWithPendingQuotes.length,
      canProceedToPayment,
      // CRITICAL: Price confirmation status for checkout blocking
      hasPendingPriceConfirmation,
      pendingPriceConfirmationCount: pendingPriceConfirmations.length,
      pendingPriceConfirmationItemIds: pendingPriceConfirmations,
      // Vehicle-specific totals for transparency
      vehicleTotals: hasVehicleItems ? {
        basePriceUsd: vehicleBasePriceTotal,
        marginUsd: vehicleMarginTotal,
        shippingUsd: vehicleShippingTotal,
        totalUsd: vehicleTotalUsd,
      } : null,
    };
    
    // Show appropriate blocking messages
    if (hasPendingPriceConfirmation) {
      summary.message = "Le prix d'un ou plusieurs articles est en attente de confirmation.";
      summary.priceConfirmationMessage = "Le prix d'un ou plusieurs articles est en attente de confirmation par un administrateur.";
    } else if (hasVehicleItems && !allVehiclesQuoted) {
      summary.message = "Un devis de livraison est nécessaire pour votre véhicule.";
    }
    
    // Add debug info for shipping calculations - ENHANCED for mobile team
    summary.shipping_debug = {
      raw_shippingPercent: shippingPercent,
      normalized_shippingPercent: normalizedShippingPercent,
      shippingBaseFeeUsd,
      regularItemsBaseTotal,
      regularShippingTotal,
      vehicleShippingTotal,
      mode: shippingPercent > 1 ? 'normalized_from_percent' : 'used_as_decimal',
      // CRITICAL: Formula explanation for mobile team debugging
      formula_explanation: `$${shippingBaseFeeUsd.toFixed(2)} + ($${regularItemsBaseTotal.toFixed(2)} × ${(normalizedShippingPercent * 100).toFixed(0)}%) = $${regularShippingTotal.toFixed(2)}`,
      // IMPORTANT: Clarification for mobile app implementation
      important_note: 'RECOMMENDED: Use summary.shippingFeeUsd directly. If calculating locally, use itemsTotalUsd (base prices BEFORE margin), NOT the displayed subtotal which includes margin.',
    };

    const totalTime = Date.now() - startTime;
    
    console.log('[CART_DEBUG]', JSON.stringify({ 
      fn: 'get-cart', 
      userId: user.id, 
      cartId: order.id, 
      action: 'response', 
      itemCount: activeItems.length, 
      savedCount: savedItems.length, 
      pendingCount: pendingPriceConfirmations.length, 
      hasPending: hasPendingPriceConfirmation, 
      canCheckout: canProceedToPayment,
      // Include summary values for debugging
      markupFeeUsd: totalMarginUsd,
      shippingFeeUsd: totalShippingUsd,
      totalUsd: grandTotalUsd,
      totalMs: totalTime
    }));

    return jsonResponse({
      ok: true,
      activeItems,
      savedItems,
      summary,
    });

  } catch (error: any) {
    console.error('[mobile-get-cart] Error:', error.message);
    
    // Return structured error that mobile can handle gracefully
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false, 
        code: 'SESSION_EXPIRED', 
        message: error.message,
        // Include empty cart data so UI can still render
        activeItems: [],
        savedItems: [],
      }, error.status);
    }
    
    // For other errors, return empty cart with error flag
    return jsonResponse({ 
      ok: false, 
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem loading cart. Please try again.',
      activeItems: [],
      savedItems: [],
    }, 500);
  }
});
