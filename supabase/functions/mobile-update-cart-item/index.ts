import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Pricing helper - single source of truth for price calculations
function calculateItemPricing(
  basePriceUsd: number,
  quantity: number,
  markupPercent: number,
  exchangeRate: number
) {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const itemBaseTotalUsd = round2(basePriceUsd * quantity);
  const itemMarginUsd = round2(itemBaseTotalUsd * (markupPercent / 100));
  const itemSubtotalUsd = round2(itemBaseTotalUsd + itemMarginUsd);
  const itemSubtotalCdf = round2(itemSubtotalUsd * exchangeRate);

  return {
    basePriceUsd: round2(basePriceUsd),
    quantity,
    itemBaseTotalUsd,
    itemMarginUsd,
    itemSubtotalUsd,
    itemSubtotalCdf,
  };
}

// Calculate cart summary from items
function calculateCartSummary(items: any[], shippingFeeUsd: number, exchangeRate: number) {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let itemCount = 0;
  let totalItemsUsd = 0;
  let totalMarginUsd = 0;
  let itemsSubtotalUsd = 0;

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
        ? Math.floor(body.quantity)
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

    // Get pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    const markupPercent = settings?.markup_percent ?? settings?.global_markup_percent ?? 15;
    const exchangeRate = settings?.exchange_rate_usd_to_cdf ?? 2800;
    const shippingFeeUsd = settings?.shipping_base_fee_usd ?? 0;

    // Recalculate pricing with new quantity
    const pricing = calculateItemPricing(
      item.base_price_usd,
      newQuantity,
      markupPercent,
      exchangeRate
    );

    // Update item with recalculated values
    const { data: updatedItem, error: updateError } = await supabase
      .from('order_items')
      .update({
        quantity: newQuantity,
        subtotal_usd: pricing.itemBaseTotalUsd,
        markup_fee_usd: pricing.itemMarginUsd,
        total_price_usd: pricing.itemSubtotalUsd,
        total_price_cdf: pricing.itemSubtotalCdf,
      })
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
      itemSubtotalUsd: pricing.itemSubtotalUsd,
    });

    // Get updated cart summary
    const { data: allItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', item.order_id);

    const summary = calculateCartSummary(allItems || [], shippingFeeUsd, exchangeRate);

    return new Response(JSON.stringify({
      success: true,
      item: {
        id: updatedItem.id,
        productUrl: updatedItem.product_url,
        productTitle: updatedItem.title,
        productImageUrl: updatedItem.product_image_url,
        basePriceUsd: updatedItem.base_price_usd,
        quantity: updatedItem.quantity,
        itemBaseTotalUsd: updatedItem.subtotal_usd,
        itemMarginUsd: updatedItem.markup_fee_usd,
        itemSubtotalUsd: updatedItem.total_price_usd,
        itemSubtotalCdf: updatedItem.total_price_cdf,
      },
      summary,
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
