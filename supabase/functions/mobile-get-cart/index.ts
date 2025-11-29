import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
          baseSubtotalUsd: 0,
          markupTotalUsd: 0,
          shippingTotalUsd: 0,
          grandTotalUsd: 0,
          grandTotalCdf: 0,
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

    // Calculate totals
    let itemCount = 0;
    let baseSubtotalUsd = 0;
    let markupTotalUsd = 0;
    let shippingTotalUsd = 0;
    let grandTotalUsd = 0;

    const formattedItems = (items || []).map(item => {
      const qty = item.quantity || 1;
      const basePrice = Number(item.base_price_usd || 0);
      const markupFee = Number(item.markup_fee_usd || 0);
      const shippingFee = Number(item.shipping_fee_usd || 0);
      const totalPrice = Number(item.total_price_usd || 0);

      itemCount += qty;
      baseSubtotalUsd += basePrice * qty;
      markupTotalUsd += markupFee * qty;
      shippingTotalUsd += shippingFee * qty;
      grandTotalUsd += totalPrice * qty;

      return {
        id: item.id,
        productUrl: item.product_url,
        productTitle: item.title,
        productImageUrl: item.product_image_url,
        unitPriceUsd: basePrice,           // Mobile app uses this for "Price"
        quantity: qty,
        subtotalUsd: totalPrice * qty,     // Mobile app uses this for "Subtotal"
        basePriceUsd: basePrice,
        markupFeeUsd: markupFee,
        shippingFeeUsd: shippingFee,
        lineTotalUsd: totalPrice,
        lineTotalCdf: Number(item.total_price_cdf || 0),
      };
    });

    // Get exchange rate for CDF conversion
    const { data: settings } = await supabase.from('settings').select('exchange_rate_usd_to_cdf').single();
    const exchangeRate = settings?.exchange_rate_usd_to_cdf || 2800;
    const grandTotalCdf = grandTotalUsd * exchangeRate;

    const summary = {
      itemCount,
      baseSubtotalUsd: Math.round(baseSubtotalUsd * 100) / 100,
      markupTotalUsd: Math.round(markupTotalUsd * 100) / 100,
      shippingTotalUsd: Math.round(shippingTotalUsd * 100) / 100,
      grandTotalUsd: Math.round(grandTotalUsd * 100) / 100,
      grandTotalCdf: Math.round(grandTotalCdf * 100) / 100,
    };

    console.log('[mobile-get-cart] Cart summary:', summary);

    return new Response(JSON.stringify({
      items: formattedItems,
      summary: {
        itemCount,
        itemsTotalUsd: Math.round(baseSubtotalUsd * 100) / 100,
        serviceFeeUsd: Math.round(markupTotalUsd * 100) / 100,
        shippingFeeUsd: Math.round(shippingTotalUsd * 100) / 100,
        totalUsd: Math.round(grandTotalUsd * 100) / 100,
        totalCdf: Math.round(grandTotalCdf * 100) / 100,
        exchangeRate,
      },
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
