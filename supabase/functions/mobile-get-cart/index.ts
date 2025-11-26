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

    // Get DRAFT order
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .single();

    if (!order) {
      return new Response(JSON.stringify({ order: null, items: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get items
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', order.id);

    // Get settings
    const { data: settings } = await supabase.from('settings').select('*').single();

    // Calculate totals
    const itemTotal = items?.reduce((sum, i) => sum + (Number(i.unit_price_usd || 0) * i.quantity), 0) || 0;
    const serviceFee = itemTotal * (settings?.service_fee_percent || 0.12);
    const shippingFee = Number(settings?.shipping_base_fee_usd || 10) + (itemTotal * (settings?.shipping_percent || 0.10));
    const totalUsd = itemTotal + serviceFee + shippingFee;
    const totalCdf = totalUsd * (settings?.exchange_rate_usd_to_cdf || 2800);

    // Update order
    await supabase
      .from('orders')
      .update({
        item_total_usd: itemTotal,
        service_fee_usd: serviceFee,
        shipping_fee_usd: shippingFee,
        total_usd: totalUsd,
        total_cdf: totalCdf,
        exchange_rate_used: settings?.exchange_rate_usd_to_cdf,
      })
      .eq('id', order.id);

    return new Response(JSON.stringify({
      order: {
        id: order.id,
        itemTotalUsd: itemTotal,
        serviceFeeUsd: serviceFee,
        shippingFeeUsd: shippingFee,
        totalUsd,
        totalCdf,
        exchangeRateUsed: settings?.exchange_rate_usd_to_cdf,
        status: order.status,
        shippingCity: order.shipping_city,
      },
      items: items?.map(i => ({
        id: i.id,
        store: i.store,
        productUrl: i.product_url,
        unitPriceUsd: i.unit_price_usd,
        quantity: i.quantity,
        subtotalUsd: i.subtotal_usd,
        notes: i.notes,
      })),
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
