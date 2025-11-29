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

    const url = new URL(req.url);
    const itemId = url.pathname.split('/').pop();

    if (!itemId) {
      return new Response(JSON.stringify({ error: 'Item ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    console.log('[mobile-update-cart-item] Request body:', body);

    const newQuantity =
      typeof body.quantity === 'number' && body.quantity > 0
        ? body.quantity
        : 1;

    if (!body.quantity || newQuantity < 1) {
      return new Response(JSON.stringify({ error: 'Valid quantity is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify item belongs to user and is in a DRAFT order
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .select('*, orders!inner(user_id, status)')
      .eq('id', itemId)
      .single();

    if (itemError || !item) {
      return new Response(JSON.stringify({ error: 'Item not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (item.orders.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (item.orders.status !== 'DRAFT') {
      return new Response(JSON.stringify({ error: 'Cannot update submitted order' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update quantity only (per-unit prices remain unchanged)
    const { data: updatedItem, error: updateError } = await supabase
      .from('order_items')
      .update({ quantity: newQuantity })
      .eq('id', itemId)
      .select()
      .single();

    if (updateError) {
      console.error('[mobile-update-cart-item] Update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update item' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[mobile-update-cart-item] Quantity updated:', {
      itemId,
      newQuantity,
    });

    // Get updated cart summary
    const { data: allItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', item.order_id);

    let itemCount = 0;
    let itemsTotalUsd = 0;
    let markupFeeUsd = 0;
    let shippingFeeUsd = 0;
    let totalUsd = 0;
    let totalCdf = 0;

    (allItems || []).forEach(i => {
      const qty = i.quantity || 1;
      itemCount += qty;
      itemsTotalUsd += Number(i.base_price_usd || 0) * qty;
      markupFeeUsd += Number(i.markup_fee_usd || 0) * qty;
      shippingFeeUsd += Number(i.shipping_fee_usd || 0) * qty;
      totalUsd += Number(i.total_price_usd || 0) * qty;
      totalCdf += Number(i.total_price_cdf || 0) * qty;
    });

    const { data: settings } = await supabase.from('settings').select('exchange_rate_usd_to_cdf').single();
    const exchangeRate = settings?.exchange_rate_usd_to_cdf || 2800;

    return new Response(JSON.stringify({
      success: true,
      item: {
        id: updatedItem.id,
        productUrl: updatedItem.product_url,
        productTitle: updatedItem.title,
        productImageUrl: updatedItem.product_image_url,
        basePriceUsd: updatedItem.base_price_usd,
        markupFeeUsd: updatedItem.markup_fee_usd,
        shippingFeeUsd: updatedItem.shipping_fee_usd,
        lineTotalUsd: updatedItem.total_price_usd,
        lineTotalCdf: updatedItem.total_price_cdf,
        quantity: updatedItem.quantity,
      },
      summary: {
        itemCount,
        itemsTotalUsd: Math.round(itemsTotalUsd * 100) / 100,
        markupFeeUsd: Math.round(markupFeeUsd * 100) / 100,
        shippingFeeUsd: Math.round(shippingFeeUsd * 100) / 100,
        totalUsd: Math.round(totalUsd * 100) / 100,
        totalCdf: Math.round(totalCdf * 100) / 100,
        exchangeRate,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[mobile-update-cart-item] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
