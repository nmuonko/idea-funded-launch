import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";

// Shipping constants
const BASE_FEE_USD = 20;
const PERCENT_FEE = 0.10;
const EXTRA_PER_KG_USD = 8;
const HEAVY_THRESHOLD_KG = 9;

// Calculate shipping for a single item based on weight
function calculateItemShipping(subtotalUsd: number, estWeightKg: number): number {
  const extraWeight = Math.max(0, estWeightKg - 1);
  const basePart = BASE_FEE_USD + (subtotalUsd * PERCENT_FEE);
  const extraPart = extraWeight * EXTRA_PER_KG_USD;
  return round2(basePart + extraPart);
}

// Format item for response
function formatItem(item: any, markupPercent: number, exchangeRate: number) {
  const basePriceUsd = Number(item.base_price_usd || 0);
  const quantity = item.quantity || 1;
  const estWeightKg = Number(item.est_weight_kg || 1);
  const itemRequiresQuote = item.requires_manual_quote || estWeightKg > HEAVY_THRESHOLD_KG;

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
  };
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);

    // Get cached pricing settings (5min TTL)
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, markupPercent } = settings;

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
        requires_manual_quote, is_saved_for_later, saved_at,
        shipping_item_types(key, label)
      `)
      .eq('order_id', order.id);

    if (itemsError) {
      console.error('[mobile-get-cart] Items error:', itemsError.message);
    }

    // Separate active and saved items
    const activeItems: any[] = [];
    const savedItems: any[] = [];

    // Summary calculations only for active items
    let itemCount = 0;
    let calcItemsTotal = 0;
    let calcMarginTotal = 0;
    let calcSubtotalWithMarkup = 0;
    let calcShippingTotal = 0;
    let requiresManualQuote = false;

    (items || []).forEach(item => {
      const formattedItem = formatItem(item, markupPercent, exchangeRate);
      
      if (item.is_saved_for_later) {
        savedItems.push(formattedItem);
      } else {
        activeItems.push(formattedItem);
        
        // Only count active items in summary
        itemCount += formattedItem.quantity;
        calcItemsTotal += formattedItem.itemBaseTotalUsd;
        calcMarginTotal += formattedItem.itemMarginUsd;
        calcSubtotalWithMarkup += formattedItem.itemSubtotalUsd;

        if (formattedItem.requiresManualQuote) {
          requiresManualQuote = true;
        } else {
          calcShippingTotal += calculateItemShipping(formattedItem.itemBaseTotalUsd, formattedItem.estWeightKg);
        }
      }
    });

    // If any item requires manual quote, set shipping to 0
    if (requiresManualQuote) {
      calcShippingTotal = 0;
    }

    // Use calculated values
    const finalItemsTotal = round2(calcItemsTotal);
    const finalMarginTotal = round2(calcMarginTotal);
    const finalShippingFee = round2(calcShippingTotal);
    const finalGrandTotalUsd = round2(calcSubtotalWithMarkup + finalShippingFee);
    const finalGrandTotalCdf = round2(finalGrandTotalUsd * exchangeRate);

    // Build summary (only for active items)
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
    };
    
    if (requiresManualQuote) {
      summary.message = "We'll contact you for a custom shipping quote.";
    }

    return jsonResponse({ 
      items: activeItems,
      activeItems,
      savedItems,
      summary 
    });

  } catch (error: any) {
    console.error('[mobile-get-cart] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
