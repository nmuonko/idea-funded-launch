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
    console.log('[mobile-add-cart-item] Request body:', body);

    const { productUrl, productPrice, productTitle, productImageUrl } = body;
    
    // Validate productUrl
    if (!productUrl || typeof productUrl !== 'string' || !productUrl.trim()) {
      return new Response(JSON.stringify({ error: 'productUrl is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate productPrice
    if (typeof productPrice !== 'number' || productPrice <= 0) {
      return new Response(JSON.stringify({ error: 'productPrice must be a positive number' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine quantity (default to 1 if missing or invalid)
    const quantity = typeof body.quantity === 'number' && body.quantity > 0
      ? body.quantity
      : 1;

    const basePrice = productPrice;
    console.log('[mobile-add-cart-item] Using client-provided price:', basePrice);

    // Load pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    
    if (!settings) {
      return new Response(JSON.stringify({ error: 'Pricing settings not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate fees
    const markupPercent = settings.markup_percent || 15;
    const minServiceFee = settings.min_service_fee_usd || 5;
    const shippingFlatFee = settings.shipping_base_fee_usd || 10;
    const shippingPercent = settings.shipping_percent || 0.10;
    const exchangeRate = settings.exchange_rate_usd_to_cdf || 2800;

    const markupFee = Math.max(basePrice * (markupPercent / 100), minServiceFee);
    const shippingFee = shippingFlatFee + (basePrice * shippingPercent);
    const lineTotalUsd = basePrice + markupFee + shippingFee;
    const lineTotalCdf = lineTotalUsd * exchangeRate;

    console.log('[mobile-add-cart-item] Pricing breakdown:', {
      basePrice,
      markupFee,
      shippingFee,
      lineTotalUsd,
      lineTotalCdf
    });

    // Detect store from URL
    let store = 'other';
    try {
      const urlObj = new URL(productUrl);
      const hostname = urlObj.hostname.toLowerCase();
      if (hostname.includes('amazon')) store = 'amazon';
      else if (hostname.includes('ebay')) store = 'ebay';
      else if (hostname.includes('walmart')) store = 'walmart';
      else if (hostname.includes('bestbuy')) store = 'bestbuy';
      else if (hostname.includes('carvana')) store = 'carvana';
      else if (hostname.includes('cargurus')) store = 'cargurus';
    } catch (e) {
      console.error('[mobile-add-cart-item] Invalid URL format:', e);
    }

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

    // Insert cart item
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: orderId,
        product_url: productUrl,
        title: productTitle || null,
        product_image_url: productImageUrl || null,
        store,
        base_price_usd: basePrice,
        markup_fee_usd: markupFee,
        shipping_fee_usd: shippingFee,
        total_price_usd: lineTotalUsd,
        total_price_cdf: lineTotalCdf,
        quantity,
        unit_price_usd: basePrice,
        subtotal_usd: basePrice * quantity,
      })
      .select()
      .single();

    if (itemError) {
      console.error('[mobile-add-cart-item] Failed to insert item:', itemError);
      return new Response(JSON.stringify({ 
        error: 'DB_INSERT_FAILED',
        message: 'Failed to add item to cart.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      item: {
        id: item.id,
        productUrl: item.product_url,
        productTitle: item.title,
        productImageUrl: item.product_image_url,
        basePriceUsd: item.base_price_usd,
        markupFeeUsd: item.markup_fee_usd,
        shippingFeeUsd: item.shipping_fee_usd,
        lineTotalUsd: item.total_price_usd,
        lineTotalCdf: item.total_price_cdf,
        quantity: item.quantity,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[mobile-add-cart-item] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
