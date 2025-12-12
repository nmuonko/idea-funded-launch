import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";

// Heavy threshold for manual quote requirement
const HEAVY_THRESHOLD_KG = 9;
const EXTRA_PER_KG_USD = 8;

// Calculate shipping for a single item using settings
function calculateItemShipping(
  subtotalUsd: number, 
  estWeightKg: number,
  shippingBaseFeeUsd: number,
  shippingPercent: number
): number {
  // Base shipping: flat fee + percentage of subtotal
  const basePart = shippingBaseFeeUsd + (subtotalUsd * shippingPercent);
  // Extra weight surcharge if over 1kg
  const extraWeight = Math.max(0, estWeightKg - 1);
  const extraPart = extraWeight * EXTRA_PER_KG_USD;
  return round2(basePart + extraPart);
}

// Format item for response
function formatItem(item: any, markupPercent: number, exchangeRate: number) {
  const basePriceUsd = Number(item.base_price_usd || 0);
  const quantity = item.quantity || 1;
  const estWeightKg = Number(item.est_weight_kg || 1);
  const itemRequiresQuote = item.requires_manual_quote || estWeightKg > HEAVY_THRESHOLD_KG;
  const isVehicle = item.is_vehicle || false;

  // Calculate expected values from base price
  const expectedBaseTotal = round2(basePriceUsd * quantity);
  const expectedMargin = round2(expectedBaseTotal * (markupPercent / 100));
  const expectedSubtotal = round2(expectedBaseTotal + expectedMargin);
  const expectedSubtotalCdf = round2(expectedSubtotal * exchangeRate);

  // Use stored values if valid, otherwise use calculated values
  const itemBaseTotalUsd = Number(item.subtotal_usd) > 0 ? Number(item.subtotal_usd) : expectedBaseTotal;
  const itemMarginUsd = Number(item.markup_fee_usd) > 0 ? Number(item.markup_fee_usd) : expectedMargin;
  const itemSubtotalUsd = Number(item.total_price_usd) > 0 ? Number(item.total_price_usd) : expectedSubtotal;
  const itemSubtotalCdf = Number(item.total_price_cdf) > 0 ? Number(item.total_price_cdf) : expectedSubtotalCdf;

  const imageUrl = item.product_image_url || null;

  // Get quote request info if available
  const quoteRequest = item.quote_requests?.[0];
  const vehicleQuoteApplied = item.vehicle_quote_applied === true;
  
  return {
    id: item.id,
    productUrl: item.product_url,
    productTitle: item.title || null,
    productImageUrl: imageUrl,
    image_url: imageUrl, // Alias for mobile app compatibility
    store: item.store,
    basePriceUsd,
    quantity,
    unitPriceUsd: basePriceUsd,
    itemBaseTotalUsd,
    itemMarginUsd,
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
    // Vehicle-specific fields
    isVehicle,
    isQuoteRequired: isVehicle && !vehicleQuoteApplied,
    vehicleQuoteApplied,
    quoteStatus: quoteRequest?.status || null,
    quotedShippingUsd: quoteRequest?.quoted_shipping_usd || null,
    quotedTotalUsd: quoteRequest?.quoted_total_usd || null,
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
    const { exchangeRate, markupPercent, shippingBaseFeeUsd, shippingPercent } = settings;

    console.log('[mobile-get-cart] Using settings:', {
      markupPercent,
      shippingBaseFeeUsd,
      shippingPercent,
      exchangeRate,
    });

    // Get user's active DRAFT order (cart) - use maybeSingle to handle no cart case gracefully
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
        }
      });
    }

    // Get items - select only needed columns for mobile
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        id, product_url, title, product_image_url, store, base_price_usd, quantity,
        subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf, est_weight_kg,
        requires_manual_quote, is_saved_for_later, saved_at, is_vehicle, vehicle_quote_applied,
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
    const vehicleItemsRequiringQuote: any[] = [];

    // Summary calculations only for active items (excluding vehicles requiring quotes)
    let itemCount = 0;
    let calcItemsTotal = 0;
    let calcMarginTotal = 0;
    let calcSubtotalWithMarkup = 0;
    let requiresManualQuote = false;
    let vehicleCount = 0;
    let hasVehicleItems = false;
    let allVehiclesQuoted = true;

    (items || []).forEach(item => {
      const formattedItem = formatItem(item, markupPercent, exchangeRate);
      
      if (item.is_saved_for_later) {
        savedItems.push(formattedItem);
      } else {
        activeItems.push(formattedItem);
        
        // Track vehicles separately - they don't contribute to automatic totals unless quoted
        if (formattedItem.isVehicle) {
          vehicleCount++;
          hasVehicleItems = true;
          
          // Check if this vehicle has had its quote applied
          const quoteApplied = item.vehicle_quote_applied === true;
          const quoteStatus = formattedItem.quoteStatus;
          
          if (!quoteApplied && quoteStatus !== 'SENT' && quoteStatus !== 'ACCEPTED') {
            // Vehicle needs a quote before payment can proceed
            allVehiclesQuoted = false;
            vehicleItemsRequiringQuote.push(formattedItem);
          } else if (quoteApplied || quoteStatus === 'SENT' || quoteStatus === 'ACCEPTED') {
            // Vehicle has been quoted - include in totals
            itemCount += formattedItem.quantity;
            calcItemsTotal += formattedItem.itemBaseTotalUsd;
            calcMarginTotal += formattedItem.itemMarginUsd;
            // Use quoted total if available
            const quotedTotal = formattedItem.quotedTotalUsd || formattedItem.itemSubtotalUsd;
            calcSubtotalWithMarkup += quotedTotal;
          }
        } else {
          // Non-vehicle: normal processing
          itemCount += formattedItem.quantity;
          calcItemsTotal += formattedItem.itemBaseTotalUsd;
          calcMarginTotal += formattedItem.itemMarginUsd;
          calcSubtotalWithMarkup += formattedItem.itemSubtotalUsd;

          if (formattedItem.requiresManualQuote) {
            requiresManualQuote = true;
          }
        }
      }
    });

    // Calculate shipping using settings values
    let calcShippingTotal = 0;
    if (!requiresManualQuote && calcItemsTotal > 0) {
      // Use formula: base_fee + (items_subtotal × shipping_percent)
      calcShippingTotal = round2(shippingBaseFeeUsd + (calcItemsTotal * shippingPercent));
    }

    // Use calculated values
    const finalItemsTotal = round2(calcItemsTotal);
    const finalMarginTotal = round2(calcMarginTotal);
    const finalShippingFee = round2(calcShippingTotal);
    const finalGrandTotalUsd = round2(calcSubtotalWithMarkup + finalShippingFee);
    const finalGrandTotalCdf = round2(finalGrandTotalUsd * exchangeRate);

    // Determine vehicle quote status
    let vehicleQuoteStatus: 'none' | 'pending' | 'quoted' = 'none';
    let vehicleQuotedShippingUsd: number | null = null;
    let vehicleQuotedTotalUsd: number | null = null;

    if (hasVehicleItems) {
      if (allVehiclesQuoted) {
        vehicleQuoteStatus = 'quoted';
        // Sum up quoted values from vehicle items
        vehicleQuotedShippingUsd = 0;
        vehicleQuotedTotalUsd = 0;
        activeItems.forEach(item => {
          if (item.isVehicle && (item.quotedShippingUsd || item.quotedTotalUsd)) {
            vehicleQuotedShippingUsd! += item.quotedShippingUsd || 0;
            vehicleQuotedTotalUsd! += item.quotedTotalUsd || 0;
          }
        });
      } else {
        vehicleQuoteStatus = vehicleItemsRequiringQuote.some(v => v.quoteStatus === 'PENDING') 
          ? 'pending' 
          : 'none';
      }
    }

    // Can proceed to payment if:
    // 1. No manual quote required for non-vehicle items AND
    // 2. Either no vehicle items OR all vehicle items have quotes applied
    const canProceedToPayment = !requiresManualQuote && (!hasVehicleItems || allVehiclesQuoted);

    // Build summary (only for active non-vehicle items)
    const summary: Record<string, any> = {
      itemCount,
      itemsTotalUsd: finalItemsTotal,
      markupFeeUsd: finalMarginTotal,
      shippingFeeUsd: finalShippingFee,
      totalUsd: finalGrandTotalUsd,
      totalCdf: finalGrandTotalCdf,
      exchangeRate: order.exchange_rate_used || exchangeRate,
      requiresManualQuote,
      savedItemCount: savedItems.length,
      // Vehicle-specific summary fields
      hasVehicleItems,
      vehicleCount,
      vehicleQuoteStatus,
      vehicleQuotedShippingUsd,
      vehicleQuotedTotalUsd,
      vehicleItemsRequiringQuoteCount: vehicleItemsRequiringQuote.length,
      canProceedToPayment,
      // Include settings for transparency
      markupPercent,
      shippingBaseFeeUsd,
      shippingPercent,
    };
    
    if (requiresManualQuote) {
      summary.message = "We'll contact you for a custom shipping quote.";
    }
    
    if (hasVehicleItems && !allVehiclesQuoted) {
      summary.vehicleMessage = "Un devis de livraison est nécessaire pour votre véhicule.";
    }

    console.log('[mobile-get-cart] Returning', activeItems.length, 'active items and', savedItems.length, 'saved items');
    
    // REGRESSION GUARD: Log warning if active items exist but summary totals are 0
    if (activeItems.length > 0 && summary.totalUsd === 0 && !requiresManualQuote && (!hasVehicleItems || allVehiclesQuoted)) {
      console.warn('[mobile-get-cart] REGRESSION WARNING: Active items exist but totalUsd = 0', {
        orderId: order.id,
        activeItemCount: activeItems.length,
        itemsTotalUsd: summary.itemsTotalUsd,
        markupFeeUsd: summary.markupFeeUsd,
        shippingFeeUsd: summary.shippingFeeUsd,
      });
    }
    
    return jsonResponse({ 
      ok: true,
      items: activeItems,       // Backwards compatible - active items only
      activeItems,              // Active cart items (isSavedForLater = false)
      savedItems,               // Saved for later items (isSavedForLater = true)
      summary 
    });

  } catch (error: any) {
    console.error('[mobile-get-cart] Error:', error.message);
    
    // Return structured error for client handling - NEVER delete cart on transient errors
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false, 
        code: 'AUTH_ERROR', 
        message: error.message 
      }, error.status);
    }
    
    // For other errors, return structured error but don't crash
    return jsonResponse({ 
      ok: false, 
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem loading cart. Please try again.' 
    }, 500);
  }
});
