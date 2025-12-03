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

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-get-cart] User authenticated:', user.id);

    // Get pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    const exchangeRate = settings?.exchange_rate_usd_to_cdf ?? 2800;
    const markupPercent = settings?.markup_percent ?? settings?.global_markup_percent ?? 15;

    // Get DRAFT order with its totals
    const { data: order } = await supabase
      .from('orders')
      .select('id, item_total_usd, service_fee_usd, shipping_fee_usd, total_usd, total_cdf, exchange_rate_used, requires_manual_quote')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .single();

    if (!order) {
      console.log('[mobile-get-cart] No DRAFT order found');
      return jsonResponse({
        items: [],
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

    console.log('[mobile-get-cart] Found order:', order.id);

    // Get items with shipping type info
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*, shipping_item_types(key, label)')
      .eq('order_id', order.id);

    if (itemsError) {
      console.error('[mobile-get-cart] Items query error:', itemsError);
    }

    console.log('[mobile-get-cart] Found items:', items?.length || 0);

    // Format items for response AND recalculate totals
    let itemCount = 0;
    let calcItemsTotal = 0;
    let calcMarginTotal = 0;
    let calcSubtotalWithMarkup = 0;
    let calcShippingTotal = 0;
    let requiresManualQuote = false;

    const formattedItems = (items || []).map(item => {
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

      // Accumulate totals
      itemCount += quantity;
      calcItemsTotal += itemBaseTotalUsd;
      calcMarginTotal += itemMarginUsd;
      calcSubtotalWithMarkup += itemSubtotalUsd;

      // Check if this item requires manual quote
      if (itemRequiresQuote) {
        requiresManualQuote = true;
      } else {
        // Only add shipping for items that don't require manual quote
        calcShippingTotal += calculateItemShipping(itemBaseTotalUsd, estWeightKg);
      }

      return {
        id: item.id,
        productUrl: item.product_url,
        productTitle: item.title,
        productImageUrl: item.product_image_url,
        store: item.store,
        basePriceUsd,
        quantity,
        itemBaseTotalUsd,
        itemMarginUsd,
        itemSubtotalUsd,
        itemSubtotalCdf,
        estWeightKg,
        requiresManualQuote: itemRequiresQuote,
        shippingItemType: item.shipping_item_types ? {
          key: item.shipping_item_types.key,
          label: item.shipping_item_types.label,
        } : null,
      };
    });

    // If any item requires manual quote, set shipping to 0
    if (requiresManualQuote) {
      calcShippingTotal = 0;
    }

    // Use calculated values (they're more accurate than potentially stale order values)
    const finalItemsTotal = round2(calcItemsTotal);
    const finalMarginTotal = round2(calcMarginTotal);
    const finalShippingFee = round2(calcShippingTotal);
    const finalGrandTotalUsd = round2(calcSubtotalWithMarkup + finalShippingFee);
    const finalGrandTotalCdf = round2(finalGrandTotalUsd * exchangeRate);

    // Safety check: log warning if items exist but totals are zero
    if (items && items.length > 0 && finalItemsTotal === 0) {
      console.error('[mobile-get-cart] WARNING: Items exist but totals are zero!', {
        orderId: order.id,
        itemCount: items.length,
        orderItemTotal: order.item_total_usd,
        calculatedItemsTotal: calcItemsTotal,
      });
    }

    // Use field names that match mobile app expectations
    const summary: Record<string, any> = {
      itemCount,
      itemsTotalUsd: finalItemsTotal,
      markupFeeUsd: finalMarginTotal,
      shippingFeeUsd: finalShippingFee,
      totalUsd: finalGrandTotalUsd,
      totalCdf: finalGrandTotalCdf,
      exchangeRate: order.exchange_rate_used || exchangeRate,
      requiresManualQuote,
    };
    
    if (requiresManualQuote) {
      summary.message = "We'll contact you for a custom shipping quote. You can't pay immediately for this order.";
    }

    const response = { items: formattedItems, summary };
    console.log('[mobile-get-cart] Full response:', JSON.stringify(response, null, 2));

    return jsonResponse(response);

  } catch (error: any) {
    console.error('[mobile-get-cart] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
