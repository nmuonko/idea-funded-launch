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

    const { productUrl, store } = await req.json();

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

    // Create order item
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: order.id,
        store,
        product_url: productUrl,
        quantity: 1,
      })
      .select()
      .single();

    if (itemError) throw itemError;

    return new Response(JSON.stringify({ cartItemId: item.id, orderId: order.id }), {
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
