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
    const itemId = url.pathname.split('/').pop();

    // Verify item belongs to user's draft order
    const { data: item, error: fetchError } = await supabase
      .from('order_items')
      .select('*, orders!inner(user_id, status)')
      .eq('id', itemId)
      .single();

    if (fetchError || !item || item.orders.user_id !== user.id || item.orders.status !== 'DRAFT') {
      return new Response(JSON.stringify({ error: 'Item not found or not editable' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const orderId = item.order_id;

    // Delete item
    const { error: deleteError } = await supabase
      .from('order_items')
      .delete()
      .eq('id', itemId);

    if (deleteError) throw deleteError;

    // Check if order has remaining items
    const { data: remainingItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (remainingItems && remainingItems.length > 0) {
      // Recalculate totals
      const { data: settings } = await supabase.from('settings').select('*').single();

      const itemTotal = remainingItems.reduce((sum, i) => sum + (Number(i.subtotal_usd || 0)), 0);
      const serviceFee = itemTotal * (settings?.service_fee_percent || 0.12);
      const shippingFee = Number(settings?.shipping_base_fee_usd || 10) + (itemTotal * (settings?.shipping_percent || 0.10));
      const totalUsd = itemTotal + serviceFee + shippingFee;
      const totalCdf = totalUsd * (settings?.exchange_rate_usd_to_cdf || 2800);

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
        .eq('id', orderId);
    }

    return new Response(JSON.stringify({ success: true }), {
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
