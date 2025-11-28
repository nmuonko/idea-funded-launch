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

    const { productUrl } = body;
    
    // Determine quantity (default to 1 if missing or invalid)
    const quantity = typeof body.quantity === 'number' && body.quantity > 0
      ? body.quantity
      : 1;

    // Validate productUrl
    if (!productUrl || typeof productUrl !== 'string' || !productUrl.trim()) {
      return new Response(JSON.stringify({ error: 'productUrl is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ALWAYS call get-product-info to auto-detect price
    console.log('[mobile-add-cart-item] Calling get-product-info for:', productUrl);
    
    const { data: productInfo, error: infoError } = await supabase.functions.invoke('get-product-info', {
      body: { productUrl }
    });

    if (infoError) {
      console.error('[mobile-add-cart-item] get-product-info error:', infoError);
    }

    // Check if price was detected
    if (!productInfo?.price || productInfo.price <= 0) {
      console.log('[mobile-add-cart-item] PRICE_DETECTION_FAILED for:', productUrl);
      return new Response(JSON.stringify({
        error: 'PRICE_DETECTION_FAILED',
        message: 'Could not detect price automatically for this URL. Please try another link or store.',
        productInfo: {
          url: productUrl,
          title: productInfo?.title || null,
          imageUrl: productInfo?.imageUrl || null
        }
      }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const basePrice = productInfo.price;
    const detectedTitle = productInfo.title;
    const detectedImageUrl = productInfo.imageUrl;
    console.log('[mobile-add-cart-item] Auto-detected price for', productUrl, '=>', basePrice);

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
    const itemTotalUsd = basePrice + markupFee + shippingFee;
    const itemTotalCdf = itemTotalUsd * exchangeRate;

    console.log('[mobile-add-cart-item] Pricing breakdown:', {
      basePrice,
      markupFee,
      shippingFee,
      itemTotalUsd,
      itemTotalCdf
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
        title: detectedTitle,
        product_image_url: detectedImageUrl,
        store,
        base_price_usd: basePrice,
        markup_fee_usd: markupFee,
        shipping_fee_usd: shippingFee,
        total_price_usd: itemTotalUsd,
        total_price_cdf: itemTotalCdf,
        quantity,
        unit_price_usd: basePrice,
        subtotal_usd: basePrice * quantity,
      })
      .select()
      .single();

    if (itemError) {
      console.error('[mobile-add-cart-item] Failed to insert item:', itemError);
      return new Response(JSON.stringify({ error: 'Failed to add item to cart' }), {
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
        totalPriceUsd: item.total_price_usd,
        totalPriceCdf: item.total_price_cdf,
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
