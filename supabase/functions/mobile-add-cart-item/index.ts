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

    let { productUrl, store, title, imageUrl, unitPrice, quantity = 1 } = await req.json();

    console.log('[mobile-add-cart-item] User:', user.id);
    console.log('[mobile-add-cart-item] Adding item:', { productUrl, store, title, unitPrice, quantity });

    // If price not provided, auto-detect from URL
    if (!unitPrice || unitPrice === 0) {
      console.log('[mobile-add-cart-item] Price not provided, calling get-product-info');
      try {
        const productInfoResponse = await supabase.functions.invoke('get-product-info', {
          body: { productUrl },
        });

        if (productInfoResponse.data && !productInfoResponse.error) {
          const productInfo = productInfoResponse.data;
          console.log('[mobile-add-cart-item] Auto-detected product info:', productInfo);
          
          // Use detected values if not provided
          if (!title && productInfo.title) {
            title = productInfo.title;
          }
          if (!imageUrl && productInfo.imageUrl) {
            imageUrl = productInfo.imageUrl;
          }
          if (!unitPrice && productInfo.price) {
            unitPrice = productInfo.price;
            console.log('[mobile-add-cart-item] Using auto-detected price:', unitPrice);
          }
        } else {
          console.warn('[mobile-add-cart-item] Price detection failed:', productInfoResponse.error);
        }
      } catch (error: any) {
        console.error('[mobile-add-cart-item] Error calling get-product-info:', error.message);
      }
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

    // Calculate subtotal
    const parsedPrice = Number(unitPrice) || 0;
    const parsedQty = Number(quantity) || 1;
    const subtotal = parsedPrice * parsedQty;

    // Create order item
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: order.id,
        store,
        product_url: productUrl,
        title: title || null,
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

    console.log('[mobile-add-cart-item] Item created:', item.id);

    return new Response(JSON.stringify({ 
      success: true,
      cartItemId: item.id, 
      orderId: order.id,
      item: {
        id: item.id,
        productUrl: item.product_url,
        title: item.title,
        unitPrice: item.unit_price_usd,
        quantity: item.quantity,
        subtotal: item.subtotal_usd,
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
