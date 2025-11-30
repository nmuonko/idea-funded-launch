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

    // Verify user is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[admin-get-carts] Fetching active carts for admin:', user.id);

    // Get all DRAFT and PENDING_PAYMENT orders (active carts/non-finalized orders)
    const { data: carts, error: cartsError } = await supabase
      .from('orders')
      .select(`
        id,
        user_id,
        status,
        item_total_usd,
        shipping_fee_usd,
        service_fee_usd,
        total_usd,
        total_cdf,
        created_at,
        updated_at,
        profiles!orders_user_id_fkey (
          name,
          full_name,
          phone
        )
      `)
      .in('status', ['DRAFT', 'PENDING_PAYMENT'])
      .order('updated_at', { ascending: false });

    if (cartsError) {
      console.error('[admin-get-carts] Error fetching carts:', cartsError);
      throw cartsError;
    }

    console.log('[admin-get-carts] Found carts:', carts?.length || 0);

    // Get items for each cart
    const cartsWithItems = await Promise.all(
      (carts || []).map(async (cart) => {
        const { data: items, error: itemsError } = await supabase
          .from('order_items')
          .select('*')
          .eq('order_id', cart.id);

        if (itemsError) {
          console.error('[admin-get-carts] Error fetching items for cart:', cart.id, itemsError);
        }

        const profile = Array.isArray(cart.profiles) ? cart.profiles[0] : cart.profiles;
        const userName = profile?.full_name || profile?.name || 'Unknown User';

        return {
          cartId: cart.id,
          userId: cart.user_id,
          userName,
          userPhone: profile?.phone || '',
          status: cart.status,
          itemCount: items?.length || 0,
          subtotalUsd: cart.item_total_usd || 0,
          shippingFeeUsd: cart.shipping_fee_usd || 0,
          serviceFeeUsd: cart.service_fee_usd || 0,
          totalUsd: cart.total_usd || 0,
          totalCdf: cart.total_cdf || 0,
          createdAt: cart.created_at,
          updatedAt: cart.updated_at,
          items: (items || []).map(item => ({
            id: item.id,
            productTitle: item.title || 'Untitled Product',
            productUrl: item.product_url,
            productImageUrl: item.product_image_url,
            store: item.store,
            basePriceUsd: Number(item.base_price_usd || 0),
            markupFeeUsd: Number(item.markup_fee_usd || 0),
            shippingFeeUsd: Number(item.shipping_fee_usd || 0),
            totalPriceUsd: Number(item.total_price_usd || 0),
            totalPriceCdf: Number(item.total_price_cdf || 0),
            quantity: item.quantity || 1,
          })),
        };
      })
    );

    return new Response(JSON.stringify({ carts: cartsWithItems }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[admin-get-carts] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
