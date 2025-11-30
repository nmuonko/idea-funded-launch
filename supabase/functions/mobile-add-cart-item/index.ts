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

    const body = await req.json();

    // Read and validate body
    const productUrl = body.productUrl;
    const productPrice = Number(body.productPrice);
    const quantity = Number.isFinite(body.quantity) && body.quantity > 0 ? body.quantity : 1;

    if (!productUrl || typeof productUrl !== 'string') {
      return new Response(JSON.stringify({ error: 'productUrl is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!Number.isFinite(productPrice) || productPrice <= 0) {
      return new Response(
        JSON.stringify({ error: 'productPrice must be a positive number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[mobile-add-cart-item] request:', { productUrl, productPrice, quantity });

    // Load pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    
    if (!settings) {
      return new Response(JSON.stringify({ error: 'Pricing settings not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const markupPercent = settings.markup_percent ?? 0;
    const shippingFlat = settings.shipping_base_fee_usd ?? 0;
    const shippingPercent = settings.shipping_percent ?? 0;
    const minServiceFee = settings.min_service_fee_usd ?? 0;
    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 0;

    const basePriceUsd = productPrice;
    const markupFeeUsd = Math.max(
      basePriceUsd * (markupPercent / 100),
      minServiceFee
    );
    const shippingFeeUsd =
      shippingFlat + basePriceUsd * (shippingPercent / 100);
    const lineTotalUsd = basePriceUsd + markupFeeUsd + shippingFeeUsd;
    const lineTotalCdf =
      exchangeRate > 0 ? lineTotalUsd * exchangeRate : 0;

    console.log('[mobile-add-cart-item] computed prices:', {
      basePriceUsd,
      markupFeeUsd,
      shippingFeeUsd,
      lineTotalUsd,
      lineTotalCdf,
      quantity,
    });

    // Detect store from URL
    let store = 'OTHER';
    try {
      const urlObj = new URL(productUrl);
      const hostname = urlObj.hostname.toLowerCase();
      if (hostname.includes('amazon')) store = 'AMAZON';
      else if (hostname.includes('ebay')) store = 'EBAY';
      else if (hostname.includes('walmart')) store = 'WALMART';
      else if (hostname.includes('bestbuy')) store = 'BESTBUY';
      else if (hostname.includes('carvana')) store = 'CARVANA';
      else if (hostname.includes('cargurus')) store = 'CARGURUS';
    } catch (e) {
      console.error('[mobile-add-cart-item] Invalid URL format:', e);
    }

    const productTitle = body.productTitle ?? null;
    const productImageUrl = body.productImageUrl ?? null;

    // Get or create DRAFT order
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .single();

    let orderId = existingOrder?.id;

    if (!orderId) {
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          status: 'DRAFT',
        })
        .select('id')
        .single();

      if (orderError) {
        console.error('[mobile-add-cart-item] Failed to create order:', orderError);
        return new Response(JSON.stringify({ error: 'Failed to create cart' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      orderId = newOrder.id;
    }

    // Check for duplicate items (same product_url in this order)
    const { data: existingItem } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)
      .eq('product_url', productUrl)
      .single();

    if (existingItem) {
      // Merge by updating quantity
      const newQuantity = existingItem.quantity + quantity;
      const { data: updatedItem, error: updateError } = await supabase
        .from('order_items')
        .update({ 
          quantity: newQuantity,
          subtotal_usd: existingItem.base_price_usd * newQuantity,
        })
        .eq('id', existingItem.id)
        .select()
        .single();

      if (updateError) {
        console.error('[mobile-add-cart-item] Failed to merge item:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to merge cart item' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('[mobile-add-cart-item] Merged duplicate item, new quantity:', newQuantity);

      return new Response(
        JSON.stringify({
          success: true,
          merged: true,
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
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert new item into order_items
    const { data, error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: orderId,
        product_url: productUrl,
        title: productTitle,
        product_image_url: productImageUrl,
        store,
        base_price_usd: basePriceUsd,
        markup_fee_usd: markupFeeUsd,
        shipping_fee_usd: shippingFeeUsd,
        total_price_usd: lineTotalUsd,
        total_price_cdf: lineTotalCdf,
        quantity,
        unit_price_usd: basePriceUsd,
        subtotal_usd: basePriceUsd * quantity,
      })
      .select()
      .single();

    if (itemError) {
      console.error('[mobile-add-cart-item] cart_items insert error:', itemError);
      return new Response(
        JSON.stringify({ error: 'DB_INSERT_FAILED', message: 'Failed to add item to cart.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        item: {
          id: data.id,
          productUrl: data.product_url,
          productTitle: data.title,
          productImageUrl: data.product_image_url,
          basePriceUsd: data.base_price_usd,
          markupFeeUsd: data.markup_fee_usd,
          shippingFeeUsd: data.shipping_fee_usd,
          lineTotalUsd: data.total_price_usd,
          lineTotalCdf: data.total_price_cdf,
          quantity: data.quantity,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[mobile-add-cart-item] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
