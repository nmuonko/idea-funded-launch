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

// Format item for response - CRITICAL: Vehicle items use STORED values, no recalculation
function formatItem(item: any, markupPercent: number, vehicleMarkupPercent: number, exchangeRate: number) {
  const basePriceUsd = Number(item.base_price_usd || 0);
  const quantity = item.quantity || 1;
  const estWeightKg = Number(item.est_weight_kg || 1);
  const isVehicle = item.is_vehicle === true;
  const vehicleQuoteApplied = item.vehicle_quote_applied === true;
  
  // Get quote request info
  const quoteRequest = item.quote_requests?.[0];
  const quoteStatus = quoteRequest?.status || null;
  
  // CRITICAL: For vehicles with applied quotes, use STORED values - NO recalculation
  if (isVehicle && vehicleQuoteApplied) {
    const storedBase = Number(item.base_price_usd || 0);
    const storedMargin = Number(item.markup_fee_usd || 0);
    const storedSubtotal = Number(item.subtotal_usd || storedBase + storedMargin);
    const storedShipping = Number(item.shipping_fee_usd || 0);
    const storedTotal = Number(item.total_price_usd || 0);
    
    console.log('[mobile-get-cart] Vehicle with quote - using STORED values:', {
      itemId: item.id,
      storedBase,
      storedMargin,
      storedShipping,
      storedTotal,
      vehicleQuoteApplied
    });
    
    return {
      id: item.id,
      productUrl: item.product_url,
      productTitle: item.title || null,
      productImageUrl: item.product_image_url || null,
      image_url: item.product_image_url || null,
      store: item.store,
      // Use STORED values - these come from admin-apply-vehicle-quote
      basePriceUsd: storedBase,
      quantity: 1,  // Vehicles are always qty 1
      unitPriceUsd: storedBase,
      itemBaseTotalUsd: storedBase,              // Vehicle price
      itemMarginUsd: storedMargin,               // Margin from quote (NOT 0!)
      itemShippingUsd: 0,                        // ZERO here - shipping is in summary.shippingFeeUsd to prevent double-counting!
      itemSubtotalUsd: storedTotal,              // Final total (includes shipping internally)
      _shippingNote: 'Shipping is in summary.shippingFeeUsd, not per-item',
      itemSubtotalCdf: round2(storedTotal * exchangeRate),
      estWeightKg,
      requiresManualQuote: false,
      isSavedForLater: item.is_saved_for_later || false,
      savedAt: item.saved_at || null,
      shippingItemType: null,
      // Vehicle-specific fields
      isVehicle: true,
      isQuoteRequired: false,  // Quote has been applied
      vehicleQuoteApplied: true,
      quoteStatus: quoteStatus || 'SENT',
      quotedShippingUsd: quoteRequest?.quoted_shipping_usd || storedShipping,
      quotedTotalUsd: quoteRequest?.quoted_total_usd || storedTotal,
    };
  }
  
  // For vehicles WITHOUT quotes yet - show as pending with estimated margin
  if (isVehicle && !vehicleQuoteApplied) {
    // Calculate estimated margin using vehicle markup
    const estimatedMargin = round2(basePriceUsd * (vehicleMarkupPercent / 100));
    const estimatedSubtotal = round2(basePriceUsd + estimatedMargin);
    
    return {
      id: item.id,
      productUrl: item.product_url,
      productTitle: item.title || null,
      productImageUrl: item.product_image_url || null,
      image_url: item.product_image_url || null,
      store: item.store,
      basePriceUsd,
      quantity: 1,
      unitPriceUsd: basePriceUsd,
      itemBaseTotalUsd: basePriceUsd,
      itemMarginUsd: estimatedMargin,  // Estimated margin using vehicle markup
      itemShippingUsd: 0,  // No shipping yet - pending quote
      itemSubtotalUsd: estimatedSubtotal,  // Base + estimated margin until quoted
      itemSubtotalCdf: round2(estimatedSubtotal * exchangeRate),
      estWeightKg,
      requiresManualQuote: true,
      isSavedForLater: item.is_saved_for_later || false,
      savedAt: item.saved_at || null,
      shippingItemType: null,
      isVehicle: true,
      isQuoteRequired: true,  // Needs quote
      vehicleQuoteApplied: false,
      quoteStatus: quoteStatus || 'PENDING',
      quotedShippingUsd: null,
      quotedTotalUsd: null,
      vehicleMarkupPercent,  // Include markup % for transparency
    };
  }
  
  // REGULAR ITEMS (non-vehicles) - calculate as normal
  const itemRequiresQuote = item.requires_manual_quote || estWeightKg > HEAVY_THRESHOLD_KG;
  
  // Calculate expected values from base price
  const expectedBaseTotal = round2(basePriceUsd * quantity);
  const expectedMargin = round2(expectedBaseTotal * (markupPercent / 100));
  const expectedSubtotal = round2(expectedBaseTotal + expectedMargin);
  const expectedSubtotalCdf = round2(expectedSubtotal * exchangeRate);

  // Use stored values if valid, otherwise use calculated
  const itemBaseTotalUsd = Number(item.subtotal_usd) > 0 ? Number(item.subtotal_usd) : expectedBaseTotal;
  const itemMarginUsd = Number(item.markup_fee_usd) > 0 ? Number(item.markup_fee_usd) : expectedMargin;
  const itemSubtotalUsd = Number(item.total_price_usd) > 0 ? Number(item.total_price_usd) : expectedSubtotal;
  const itemSubtotalCdf = Number(item.total_price_cdf) > 0 ? Number(item.total_price_cdf) : expectedSubtotalCdf;

  return {
    id: item.id,
    productUrl: item.product_url,
    productTitle: item.title || null,
    productImageUrl: item.product_image_url || null,
    image_url: item.product_image_url || null,
    store: item.store,
    basePriceUsd,
    quantity,
    unitPriceUsd: basePriceUsd,
    itemBaseTotalUsd,
    itemMarginUsd,
    itemShippingUsd: 0,  // Shipping calculated at order level for regular items
    itemSubtotalUsd,
    itemSubtotalCdf,
    estWeightKg,
    requiresManualQuote: itemRequiresQuote,
    isSavedForLater: item.is_saved_for_later || false,
    savedAt: item.saved_at || null,
    shippingItemType: item.shipping_item_types ? {
      key: item.shipping_item_types.key,
      label: item.shipping_item_types.label,
    } : null,
    isVehicle: false,
    isQuoteRequired: false,
    vehicleQuoteApplied: false,
    quoteStatus: null,
    quotedShippingUsd: null,
    quotedTotalUsd: null,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);

    // Get cached pricing settings (5min TTL) - SINGLE SOURCE OF TRUTH
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent } = settings;

    console.log('[mobile-get-cart] Using settings:', {
      markupPercent,
      vehicleMarkupPercent,
      shippingBaseFeeUsd,
      shippingPercent,
      exchangeRate,
    });

    // Get user's active DRAFT order (cart)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, item_total_usd, service_fee_usd, shipping_fee_usd, total_usd, total_cdf, exchange_rate_used, requires_manual_quote')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderError) {
      console.error('[mobile-get-cart] Order query error:', orderError.message);
    }

    if (!order) {
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

    // Get items with quote requests
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        id, product_url, title, product_image_url, store, base_price_usd, unit_price_usd, quantity,
        subtotal_usd, markup_fee_usd, shipping_fee_usd, total_price_usd, total_price_cdf, 
        est_weight_kg, requires_manual_quote, is_saved_for_later, saved_at, 
        is_vehicle, vehicle_quote_applied,
        shipping_item_types(key, label),
        quote_requests(status, quoted_shipping_usd, quoted_total_usd)
      `)
      .eq('order_id', order.id);

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
          // Vehicle has quote - add its STORED totals
          vehicleBasePriceTotal += formattedItem.itemBaseTotalUsd;
          vehicleMarginTotal += formattedItem.itemMarginUsd;
          // CRITICAL: Read shipping from RAW item, not formatted (formatted is 0 to prevent frontend double-counting)
          const rawVehicleShipping = Number(item.shipping_fee_usd || 0);
          vehicleShippingTotal += rawVehicleShipping;
          vehicleTotalUsd += formattedItem.itemSubtotalUsd;
          
          console.log('[mobile-get-cart] Vehicle with quote added to totals:', {
            id: item.id,
            base: formattedItem.itemBaseTotalUsd,
            margin: formattedItem.itemMarginUsd,
            shipping: rawVehicleShipping,  // Log the REAL shipping from DB
            total: formattedItem.itemSubtotalUsd
          });
        } else {
          // Vehicle needs quote - can't proceed to payment
          allVehiclesQuoted = false;
          vehiclesWithPendingQuotes.push(item.id);
          // Still add base price for display
          vehicleBasePriceTotal += formattedItem.itemBaseTotalUsd;
        }
      } else {
        // Regular item - calculate as normal
        regularItemCount += formattedItem.quantity;
        regularItemsBaseTotal += formattedItem.itemBaseTotalUsd;
        regularItemsMarginTotal += formattedItem.itemMarginUsd;
        regularItemsSubtotal += formattedItem.itemSubtotalUsd;
        
        if (formattedItem.requiresManualQuote) {
          regularRequiresQuote = true;
        }
      }
    });

    // Calculate shipping for regular items ONLY (vehicle shipping is stored separately)
    let regularShippingTotal = 0;
    if (!regularRequiresQuote && regularItemsBaseTotal > 0) {
      regularShippingTotal = round2(shippingBaseFeeUsd + (regularItemsBaseTotal * shippingPercent));
    }

    // GRAND TOTALS - combine regular items and vehicles
    const totalItemCount = regularItemCount + vehicleCount;
    
    // Total des articles = base prices only (before margin and shipping)
    const itemsBaseTotalUsd = round2(regularItemsBaseTotal + vehicleBasePriceTotal);
    
    // Frais de marge = all margins
    const totalMarginUsd = round2(regularItemsMarginTotal + vehicleMarginTotal);
    
    // Frais de livraison = all shipping
    const totalShippingUsd = round2(regularShippingTotal + vehicleShippingTotal);
    
    // Grand total USD
    const grandTotalUsd = round2(
      regularItemsSubtotal +      // Regular items (base + margin)
      regularShippingTotal +      // Regular item shipping
      vehicleTotalUsd             // Vehicle totals (base + margin + shipping)
    );
    
    const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

    // Determine vehicle quote status
    let vehicleQuoteStatus: 'none' | 'pending' | 'quoted' = 'none';
    if (hasVehicleItems) {
      vehicleQuoteStatus = allVehiclesQuoted ? 'quoted' : 'pending';
    }

    // Can proceed to payment?
    const canProceedToPayment = !regularRequiresQuote && (!hasVehicleItems || allVehiclesQuoted);

    // CRITICAL: Only use the main fields for cart display!
    // The _breakdown object is for debugging/admin ONLY - DO NOT add its values to display
    const summary: Record<string, any> = {
      // === MAIN DISPLAY FIELDS (use ONLY these for cart UI) ===
      itemCount: totalItemCount,
      itemsTotalUsd: itemsBaseTotalUsd,       // "Total des articles" - base prices
      markupFeeUsd: totalMarginUsd,           // "Frais de marge" - TOTAL margin
      shippingFeeUsd: totalShippingUsd,       // "Frais de livraison" - TOTAL shipping (DO NOT ADD vehicleShippingUsd!)
      totalUsd: grandTotalUsd,                // "Total (USD)"
      totalCdf: grandTotalCdf,                // "Total (CDF)"
      exchangeRate: order.exchange_rate_used || exchangeRate,
      
      // === STATUS FLAGS ===
      requiresManualQuote: regularRequiresQuote,
      savedItemCount: savedItems.length,
      hasVehicleItems,
      vehicleQuoteStatus,
      allVehiclesQuoted,
      vehiclesWithPendingQuotes: vehiclesWithPendingQuotes.length,
      canProceedToPayment,
      
      // === BREAKDOWN (for debugging/admin ONLY - NOT for display addition) ===
      _breakdown: {
        regularItemCount,
        regularItemsBaseUsd: round2(regularItemsBaseTotal),
        regularItemsMarkupUsd: round2(regularItemsMarginTotal),
        regularItemsSubtotalUsd: round2(regularItemsSubtotal),
        regularShippingUsd: round2(regularShippingTotal),
        vehicleCount,
        vehicleBasePriceUsd: round2(vehicleBasePriceTotal),
        vehicleMarginUsd: round2(vehicleMarginTotal),
        vehicleShippingUsd: round2(vehicleShippingTotal),
        vehicleTotalUsd: round2(vehicleTotalUsd),
      },
      
      // === SETTINGS (for transparency) ===
      _settings: {
        markupPercent,
        vehicleMarkupPercent,
        shippingBaseFeeUsd,
        shippingPercent,
      },
    };
    
    if (regularRequiresQuote) {
      summary.message = "We'll contact you for a custom shipping quote.";
    }
    
    if (hasVehicleItems && !allVehiclesQuoted) {
      summary.vehicleMessage = "Un devis de livraison est nécessaire pour votre véhicule.";
    }

    console.log('[mobile-get-cart] Summary:', {
      totalItems: totalItemCount,
      itemsBase: itemsBaseTotalUsd,
      margin: totalMarginUsd,
      shipping: totalShippingUsd,
      totalUsd: grandTotalUsd,
      vehicleCount,
      vehicleTotal: vehicleTotalUsd,
      canProceed: canProceedToPayment
    });

    // REGRESSION GUARD - detect if totals are unexpectedly zero
    if (activeItems.length > 0 && grandTotalUsd === 0 && canProceedToPayment) {
      console.warn('[mobile-get-cart] REGRESSION WARNING: Active items but totalUsd = 0');
      // Log more details for debugging
      console.warn('[mobile-get-cart] Items detail:', activeItems.map(i => ({
        id: i.id,
        isVehicle: i.isVehicle,
        vehicleQuoteApplied: i.vehicleQuoteApplied,
        base: i.itemBaseTotalUsd,
        margin: i.itemMarginUsd,
        shipping: i.itemShippingUsd,
        total: i.itemSubtotalUsd
      })));
    }
    
    return jsonResponse({ 
      ok: true,
      items: activeItems,
      activeItems,
      savedItems,
      summary 
    });

  } catch (error: any) {
    console.error('[mobile-get-cart] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false, 
        code: 'AUTH_ERROR', 
        message: error.message 
      }, error.status);
    }
    
    // Never delete cart on transient errors
    return jsonResponse({ 
      ok: false, 
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem loading cart. Please try again.' 
    }, 500);
  }
});
