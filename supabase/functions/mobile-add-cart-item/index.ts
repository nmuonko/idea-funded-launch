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

    // Parse request body
    const body = await req.json();
    console.log('[mobile-add-cart-item] Request body:', body);

    // Extract and validate fields
    let { productUrl, productTitle, productImageUrl, productPrice, quantity } = body;

    // VALIDATION: productUrl is required
    if (!productUrl || typeof productUrl !== 'string' || productUrl.trim() === '') {
      console.error('[mobile-add-cart-item] Missing or invalid productUrl');
      return new Response(JSON.stringify({ error: 'productUrl is required and must be a non-empty string' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Default quantity to 1 if not provided
    if (!quantity || typeof quantity !== 'number' || quantity < 1) {
      quantity = 1;
      console.log('[mobile-add-cart-item] Defaulting quantity to 1');
    }

    console.log('[mobile-add-cart-item] User:', user.id);
    console.log('[mobile-add-cart-item] Validated input:', { productUrl, productTitle, productImageUrl, productPrice, quantity });

    // Determine store from URL
    let store = 'UNKNOWN';
    try {
      const url = new URL(productUrl);
      const hostname = url.hostname.toLowerCase();
      if (hostname.includes('amazon')) store = 'AMAZON';
      else if (hostname.includes('ebay')) store = 'EBAY';
      else if (hostname.includes('walmart')) store = 'WALMART';
      else if (hostname.includes('bestbuy')) store = 'BESTBUY';
      else if (hostname.includes('carvana')) store = 'CARVANA';
      else if (hostname.includes('cargurus')) store = 'CARGURUS';
    } catch (e) {
      console.warn('[mobile-add-cart-item] Could not parse URL for store detection');
    }

    // If price not provided, auto-detect from URL
    if (!productPrice || productPrice === 0) {
      console.log('[mobile-add-cart-item] Price not provided, calling get-product-info');
      try {
        const productInfoResponse = await supabase.functions.invoke('get-product-info', {
          body: { productUrl },
        });

        if (productInfoResponse.data && !productInfoResponse.error) {
          const productInfo = productInfoResponse.data;
          console.log('[mobile-add-cart-item] Auto-detected product info:', productInfo);
          
          // Use detected values if not provided
          if (!productTitle && productInfo.title) {
            productTitle = productInfo.title;
            console.log('[mobile-add-cart-item] Using auto-detected title');
          }
          if (!productImageUrl && productInfo.imageUrl) {
            productImageUrl = productInfo.imageUrl;
            console.log('[mobile-add-cart-item] Using auto-detected image');
          }
          if (!productPrice && productInfo.price) {
            productPrice = productInfo.price;
            console.log('[mobile-add-cart-item] Using auto-detected price:', productPrice);
          }
        } else {
          console.warn('[mobile-add-cart-item] Price detection failed:', productInfoResponse.error);
        }
      } catch (error: any) {
        console.error('[mobile-add-cart-item] Error calling get-product-info:', error.message);
      }

      // Log final status
      if (!productPrice) {
        console.warn('[mobile-add-cart-item] No price available after get-product-info - will insert with NULL price');
      }
    } else {
      console.log('[mobile-add-cart-item] Using client-provided productPrice:', productPrice);
    }

    // Find or create DRAFT order
    let { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .single();

    if (!order) {
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({ user_id: user.id, status: 'DRAFT' })
        .select()
        .single();
      
      if (orderError) throw orderError;
      order = newOrder;
    }

    console.log('[mobile-add-cart-item] Found/created order:', order.id);

    // Calculate subtotal (handle NULL price gracefully)
    const parsedPrice = productPrice ? Number(productPrice) : null;
    const parsedQty = Number(quantity);
    const subtotal = parsedPrice !== null ? parsedPrice * parsedQty : null;

    console.log('[mobile-add-cart-item] Inserting item with:', {
      order_id: order.id,
      store,
      product_url: productUrl,
      title: productTitle || null,
      unit_price_usd: parsedPrice,
      quantity: parsedQty,
      subtotal_usd: subtotal,
    });

    // Create order item (allow NULL price for manual review)
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: order.id,
        store,
        product_url: productUrl,
        title: productTitle || null,
        unit_price_usd: parsedPrice,
        quantity: parsedQty,
        subtotal_usd: subtotal,
      })
      .select()
      .single();

    if (itemError) {
      console.error('[mobile-add-cart-item] Insert error:', itemError);
      throw itemError;
    }

    console.log('[mobile-add-cart-item] Item created successfully:', item.id);

    return new Response(JSON.stringify({ 
      success: true,
      item: {
        id: item.id,
        productUrl: item.product_url,
        productTitle: item.title,
        productImageUrl: productImageUrl || null,
        productPrice: item.unit_price_usd,
        quantity: item.quantity,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
