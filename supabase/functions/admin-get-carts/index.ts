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

    // Get pricing settings for calculations
    const { data: settings } = await supabase
      .from('settings')
      .select('exchange_rate_usd_to_cdf, shipping_base_fee_usd, global_markup_percent')
      .single();

    const exchangeRate = settings?.exchange_rate_usd_to_cdf || 2800;
    const shippingFeeUsd = settings?.shipping_base_fee_usd || 10;
    const markupPercent = settings?.global_markup_percent || 15;

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

    // Get items for each cart and calculate totals
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
        
        // Determine user display name
        let userName = 'Guest';
        if (profile?.full_name) {
          userName = profile.full_name;
        } else if (profile?.name) {
          userName = profile.name;
        } else if (profile?.phone) {
          userName = `User (${profile.phone})`;
        }

        // Calculate cart totals from items if order totals are zero
        const formattedItems = (items || []).map(item => ({
          id: item.id,
          productTitle: item.title || 'Untitled Product',
          productUrl: item.product_url,
          productImageUrl: item.product_image_url,
          store: item.store,
          basePriceUsd: Number(item.base_price_usd || item.unit_price_usd || 0),
          markupFeeUsd: Number(item.markup_fee_usd || 0),
          shippingFeeUsd: Number(item.shipping_fee_usd || 0),
          totalPriceUsd: Number(item.subtotal_usd || item.total_price_usd || 0),
          totalPriceCdf: Number(item.total_price_cdf || 0),
          quantity: item.quantity || 1,
        }));

        // Calculate totals from items
        let subtotalUsd = 0;
        let totalMarkupUsd = 0;
        
        formattedItems.forEach(item => {
          const itemBase = item.basePriceUsd * item.quantity;
          const itemMarkup = item.markupFeeUsd > 0 
            ? item.markupFeeUsd * item.quantity 
            : itemBase * (markupPercent / 100);
          
          subtotalUsd += itemBase;
          totalMarkupUsd += itemMarkup;
        });

        // Use calculated values if order has zeros
        const finalSubtotal = cart.item_total_usd > 0 ? cart.item_total_usd : subtotalUsd;
        const finalServiceFee = cart.service_fee_usd > 0 ? cart.service_fee_usd : totalMarkupUsd;
        const finalShippingFee = cart.shipping_fee_usd > 0 ? cart.shipping_fee_usd : (formattedItems.length > 0 ? shippingFeeUsd : 0);
        const finalTotalUsd = cart.total_usd > 0 ? cart.total_usd : (finalSubtotal + finalServiceFee + finalShippingFee);
        const finalTotalCdf = cart.total_cdf > 0 ? cart.total_cdf : (finalTotalUsd * exchangeRate);

        return {
          cartId: cart.id,
          userId: cart.user_id,
          userName,
          userPhone: profile?.phone || '',
          status: cart.status,
          itemCount: formattedItems.length,
          subtotalUsd: Number(finalSubtotal.toFixed(2)),
          shippingFeeUsd: Number(finalShippingFee.toFixed(2)),
          serviceFeeUsd: Number(finalServiceFee.toFixed(2)),
          totalUsd: Number(finalTotalUsd.toFixed(2)),
          totalCdf: Number(finalTotalCdf.toFixed(0)),
          createdAt: cart.created_at,
          updatedAt: cart.updated_at,
          items: formattedItems,
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
