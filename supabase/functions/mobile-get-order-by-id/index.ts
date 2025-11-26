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
    const orderId = url.pathname.split('/').pop();

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get items
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    return new Response(JSON.stringify({
      order: {
        id: order.id,
        status: order.status,
        shippingCity: order.shipping_city,
        itemTotalUsd: order.item_total_usd,
        serviceFeeUsd: order.service_fee_usd,
        shippingFeeUsd: order.shipping_fee_usd,
        totalUsd: order.total_usd,
        totalCdf: order.total_cdf,
        exchangeRateUsed: order.exchange_rate_used,
        maishaTransactionId: order.maisha_transaction_id,
        maishaPaymentStatus: order.maisha_payment_status,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      },
      items: items?.map(i => ({
        id: i.id,
        store: i.store,
        productUrl: i.product_url,
        title: i.title,
        unitPriceUsd: i.unit_price_usd,
        quantity: i.quantity,
        subtotalUsd: i.subtotal_usd,
        notes: i.notes,
      })) || [],
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
