import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";

// Heavy threshold for manual quote requirement (non-vehicles)
const HEAVY_THRESHOLD_KG = 9;
const EXTRA_PER_KG_USD = 8;

// Calculate shipping for a REGULAR (non-vehicle) item using settings
function calculateItemShipping(
  subtotalUsd: number, 
  estWeightKg: number,
  shippingBaseFeeUsd: number,
  shippingPercent: number
): number {
  const basePart = shippingBaseFeeUsd + (subtotalUsd * shippingPercent);
  const extraWeight = Math.max(0, estWeightKg - 1);
  const extraPart = extraWeight * EXTRA_PER_KG_USD;
  return round2(basePart + extraPart);
}

/**
 * Format item for response - STABLE SCHEMA for all item types
 * Every item has: id, type, title, price fields, quote_status, shipping_cost, updated_at
 */
function formatItem(item: any, markupPercent: number, vehicleMarkupPercent: number, exchangeRate: number) {
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
  
  // STABLE BASE FIELDS for all items
  const baseFields = {
    id: item.id,
    type: isVehicle ? 'vehicle' : 'product',  // STABLE TYPE FIELD
    productUrl: item.product_url,
    productTitle: item.title || null,
    title: item.title || null,  // Alias for consistency
    productImageUrl: item.product_image_url || null,
    image_url: item.product_image_url || null,
    store: item.store,
    quantity: isVehicle ? 1 : quantity,
    estWeightKg,
    isSavedForLater: item.is_saved_for_later || false,
    savedAt: item.saved_at || null,
    updatedAt: item.updated_at || null,
    // Quote fields - ALWAYS present (null if not applicable)
    quoteStatus,
    quotedShippingUsd,
    quotedTotalUsd,
    isVehicle,
    vehicleQuoteApplied,
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
      shippingCost: null,  // Pending quote - no shipping yet
      itemSubtotalUsd: estimatedSubtotal,
      itemTotalUsd: estimatedSubtotal,  // No shipping included yet
      price: estimatedSubtotal,  // Display price (without shipping)
      itemSubtotalCdf: round2(estimatedSubtotal * exchangeRate),
      requiresManualQuote: true,
      isQuoteRequired: true,
      shippingItemType: null,
      vehicleMarkupPercent,
    };
  }
  
  // REGULAR PRODUCT - calculate as normal
  const itemRequiresQuote = item.requires_manual_quote || estWeightKg > HEAVY_THRESHOLD_KG;
  const expectedBaseTotal = round2(basePriceUsd * quantity);
  const expectedMargin = round2(expectedBaseTotal * (markupPercent / 100));
  const expectedSubtotal = round2(expectedBaseTotal + expectedMargin);
  const expectedSubtotalCdf = round2(expectedSubtotal * exchangeRate);

  const itemBaseTotalUsd = Number(item.subtotal_usd) > 0 ? Number(item.subtotal_usd) : expectedBaseTotal;
  const itemMarginUsd = Number(item.markup_fee_usd) > 0 ? Number(item.markup_fee_usd) : expectedMargin;
  const itemSubtotalUsd = Number(item.total_price_usd) > 0 ? Number(item.total_price_usd) : expectedSubtotal;
  const itemSubtotalCdf = Number(item.total_price_cdf) > 0 ? Number(item.total_price_cdf) : expectedSubtotalCdf;

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
      key: item.shipping_item_types.key,
      label: item.shipping_item_types.label,
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

    // Get cached pricing settings (5min TTL) - SINGLE SOURCE OF TRUTH
    const settingsStart = Date.now();
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent } = settings;
    const settingsTime = Date.now() - settingsStart;

    // Get user's active DRAFT order (cart) - SINGLE QUERY
    const orderStart = Date.now();
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, item_total_usd, service_fee_usd, shipping_fee_usd, total_usd, total_cdf, exchange_rate_used, requires_manual_quote')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();
    const orderTime = Date.now() - orderStart;

    if (orderError) {
      console.error('[mobile-get-cart] Order query error:', orderError.message);
    }

    if (!order) {
      console.log(`[mobile-get-cart] PERF auth=${authTime}ms settings=${settingsTime}ms order=${orderTime}ms total=${Date.now() - startTime}ms - Empty cart`);
      return jsonResponse({
        ok: true,
        activeItems: [],
        savedItems: [],
        summary: {
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
        }
      });
    }

    // Get items with quote requests - SINGLE QUERY with join
    const itemsStart = Date.now();
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        id, product_url, title, product_image_url, store, base_price_usd, unit_price_usd, quantity,
        subtotal_usd, markup_fee_usd, shipping_fee_usd, total_price_usd, total_price_cdf, 
        est_weight_kg, requires_manual_quote, is_saved_for_later, saved_at, updated_at,
        is_vehicle, vehicle_quote_applied,
        shipping_item_types(key, label),
        quote_requests(status, quoted_shipping_usd, quoted_total_usd)
      `)
      .eq('order_id', order.id);
    const itemsTime = Date.now() - itemsStart;

    if (itemsError) {
      console.error('[mobile-get-cart] Items error:', itemsError.message);
    }

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

    (items || []).forEach(item => {
      const formattedItem = formatItem(item, markupPercent, vehicleMarkupPercent, exchangeRate);
      
      if (item.is_saved_for_later) {
        savedItems.push(formattedItem);
        return;
      }
      
      activeItems.push(formattedItem);
      
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
    let regularShippingTotal = 0;
    if (!regularRequiresQuote && regularItemsBaseTotal > 0) {
      regularShippingTotal = round2(shippingBaseFeeUsd + (regularItemsBaseTotal * shippingPercent));
    }

    // GRAND TOTALS
    const totalItemCount = regularItemCount + vehicleCount;
    const itemsBaseTotalUsd = round2(regularItemsBaseTotal + vehicleBasePriceTotal);
    const totalMarginUsd = round2(regularItemsMarginTotal + vehicleMarginTotal);
    const totalShippingUsd = round2(regularShippingTotal + vehicleShippingTotal);
    
    // vehicleTotalUsd already includes shipping for quoted vehicles
    const grandTotalUsd = round2(
      regularItemsSubtotal + regularShippingTotal + vehicleTotalUsd
    );
    const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

    // Determine vehicle quote status
    let vehicleQuoteStatus: 'none' | 'pending' | 'quoted' = 'none';
    if (hasVehicleItems) {
      vehicleQuoteStatus = allVehiclesQuoted ? 'quoted' : 'pending';
    }

    const canProceedToPayment = !regularRequiresQuote && (!hasVehicleItems || allVehiclesQuoted);

    // LEAN SUMMARY - only fields mobile needs
    const summary: Record<string, any> = {
      itemCount: totalItemCount,
      itemsTotalUsd: itemsBaseTotalUsd,
      markupFeeUsd: totalMarginUsd,
      shippingFeeUsd: totalShippingUsd,
      totalUsd: grandTotalUsd,
      totalCdf: grandTotalCdf,
      exchangeRate: order.exchange_rate_used || exchangeRate,
      requiresManualQuote: regularRequiresQuote,
      savedItemCount: savedItems.length,
      hasVehicleItems,
      vehicleQuoteStatus,
      allVehiclesQuoted,
      vehiclesWithPendingQuotes: vehiclesWithPendingQuotes.length,
      canProceedToPayment,
    };
    
    if (regularRequiresQuote) {
      summary.message = "We'll contact you for a custom shipping quote.";
    }
    
    if (hasVehicleItems && !allVehiclesQuoted) {
      summary.vehicleMessage = "Un devis de livraison est nécessaire pour votre véhicule.";
    }

    console.log(`[mobile-get-cart] PERF auth=${authTime}ms settings=${settingsTime}ms order=${orderTime}ms items=${itemsTime}ms total=${Date.now() - startTime}ms - ${totalItemCount} items`);
    
    return jsonResponse({ 
      ok: true,
      items: activeItems,
      activeItems,
      savedItems,
      summary 
    });

  } catch (error: any) {
    console.error(`[mobile-get-cart] PERF duration=${Date.now() - startTime}ms - Error:`, error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false, 
        code: 'AUTH_ERROR', 
        message: error.message 
      }, error.status);
    }
    
    return jsonResponse({ 
      ok: false, 
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem loading cart. Please try again.' 
    }, 500);
  }
});
