import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate cart summary from items - single source of truth
function calculateCartSummary(items: any[], shippingFeeUsd: number, exchangeRate: number) {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let itemCount = 0;
  let totalItemsUsd = 0;    // Sum of (base_price * qty) for all items
  let totalMarginUsd = 0;   // Sum of markup fees
  let itemsSubtotalUsd = 0; // Sum of (base + margin) for all items

  (items || []).forEach(item => {
    const qty = item.quantity || 1;
    itemCount += qty;
    totalItemsUsd += Number(item.subtotal_usd || 0);
    totalMarginUsd += Number(item.markup_fee_usd || 0);
    itemsSubtotalUsd += Number(item.total_price_usd || 0);
  });

  const grandTotalUsd = round2(itemsSubtotalUsd + shippingFeeUsd);
  const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

  return {
    itemCount,
    totalItemsUsd: round2(totalItemsUsd),
    totalMarginUsd: round2(totalMarginUsd),
    itemsSubtotalUsd: round2(itemsSubtotalUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    grandTotalUsd,
    grandTotalCdf,
    exchangeRate,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[mobile-get-cart] User:', user.id);

    // Get pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    const exchangeRate = settings?.exchange_rate_usd_to_cdf ?? 2800;
    const shippingFeeUsd = settings?.shipping_base_fee_usd ?? 0;

    // Get DRAFT order
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .single();

    if (!order) {
      console.log('[mobile-get-cart] No DRAFT order found');
      return new Response(JSON.stringify({
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
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      basePriceUsd: item.base_price_usd,
      quantity: item.quantity,
      itemBaseTotalUsd: item.subtotal_usd,
      itemMarginUsd: item.markup_fee_usd,
      itemSubtotalUsd: item.total_price_usd,
      itemSubtotalCdf: item.total_price_cdf,
    }));

    // Calculate summary
    const summary = calculateCartSummary(items || [], shippingFeeUsd, exchangeRate);

    console.log('[mobile-get-cart] Response summary:', summary);

    return new Response(JSON.stringify({
      items: formattedItems,
      summary,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[mobile-get-cart] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
