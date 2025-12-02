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

// Dynamic shipping calculation: base + (percentage × items subtotal)
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
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
    const shippingBaseFeeUsd = settings?.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings?.shipping_percent ?? 0.10;

    // Get DRAFT order with its totals
    const { data: order } = await supabase
      .from('orders')
      .select('id, item_total_usd, service_fee_usd, shipping_fee_usd, total_usd, total_cdf, exchange_rate_used')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .single();

    if (!order) {
      console.log('[mobile-get-cart] No DRAFT order found');
      return jsonResponse({
        items: [],
        summary: {
          itemCount: 0,
          totalItemsUsd: 0,
          totalMarginUsd: 0,
          itemsSubtotalUsd: 0,
          shippingFeeUsd: 0,
          grandTotalUsd: 0,
          grandTotalCdf: 0,
          exchangeRate,
        }
      });
    }

    console.log('[mobile-get-cart] Found order:', order.id);

    // Get items
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', order.id);

    if (itemsError) {
      console.error('[mobile-get-cart] Items query error:', itemsError);
    }

    console.log('[mobile-get-cart] Found items:', items?.length || 0);

    // Format items for response
    const formattedItems = (items || []).map(item => ({
      id: item.id,
      productUrl: item.product_url,
      productTitle: item.title,
      productImageUrl: item.product_image_url,
      store: item.store,
      basePriceUsd: Number(item.base_price_usd || 0),
      quantity: item.quantity || 1,
      itemBaseTotalUsd: Number(item.subtotal_usd || 0),
      itemMarginUsd: Number(item.markup_fee_usd || 0),
      itemSubtotalUsd: Number(item.total_price_usd || 0),
      itemSubtotalCdf: Number(item.total_price_cdf || 0),
    }));

    // Calculate totals from items (as backup/verification)
    let calcItemsTotal = 0;
    let calcMarginTotal = 0;
    let calcSubtotalWithMarkup = 0;
    let itemCount = 0;

    formattedItems.forEach(item => {
      itemCount += item.quantity;
      calcItemsTotal += item.itemBaseTotalUsd;
      calcMarginTotal += item.itemMarginUsd;
      calcSubtotalWithMarkup += item.itemSubtotalUsd;
    });

    // Use persisted order totals if available, otherwise use calculated with dynamic shipping
    const finalItemsTotal = order.item_total_usd > 0 ? Number(order.item_total_usd) : round2(calcItemsTotal);
    const finalMarginTotal = order.service_fee_usd > 0 ? Number(order.service_fee_usd) : round2(calcMarginTotal);
    
    // Dynamic shipping calculation
    const calculatedShipping = items && items.length > 0 
      ? calculateShipping(finalItemsTotal, shippingBaseFeeUsd, shippingPercent)
      : 0;
    const finalShippingFee = order.shipping_fee_usd > 0 ? Number(order.shipping_fee_usd) : calculatedShipping;
    
    const finalGrandTotalUsd = order.total_usd > 0 ? Number(order.total_usd) : round2(calcSubtotalWithMarkup + finalShippingFee);
    const finalGrandTotalCdf = order.total_cdf > 0 ? Number(order.total_cdf) : round2(finalGrandTotalUsd * exchangeRate);

    // Safety check: log warning if items exist but totals are zero
    if (items && items.length > 0 && finalItemsTotal === 0) {
      console.error('[mobile-get-cart] WARNING: Items exist but totals are zero!', {
        orderId: order.id,
        itemCount: items.length,
        orderItemTotal: order.item_total_usd,
        calculatedItemsTotal: calcItemsTotal,
      });
    }

    const summary = {
      itemCount,
      totalItemsUsd: round2(finalItemsTotal),
      totalMarginUsd: round2(finalMarginTotal),
      itemsSubtotalUsd: round2(finalItemsTotal + finalMarginTotal),
      shippingFeeUsd: round2(finalShippingFee),
      grandTotalUsd: round2(finalGrandTotalUsd),
      grandTotalCdf: round2(finalGrandTotalCdf),
      exchangeRate: order.exchange_rate_used || exchangeRate,
    };

    console.log('[mobile-get-cart] Response summary:', summary);

    return jsonResponse({ items: formattedItems, summary });

  } catch (error: any) {
    console.error('[mobile-get-cart] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
