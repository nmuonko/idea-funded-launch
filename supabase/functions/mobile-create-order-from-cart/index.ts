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

    // Authenticate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Create Order] User:', user.id);

    // Get cart items
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (!existingOrder || !existingOrder.order_items || existingOrder.order_items.length === 0) {
      return new Response(JSON.stringify({ error: 'Cart is empty' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Create Order] Found draft order with items:', existingOrder.order_items.length);

    // Get pricing settings
    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (!settings) {
      return new Response(JSON.stringify({ error: 'Pricing settings not found' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate totals
    const itemCount = existingOrder.order_items.reduce((sum: number, item: any) => sum + item.quantity, 0);
    const baseSubtotalUsd = existingOrder.order_items.reduce(
      (sum: number, item: any) => sum + (Number(item.base_price_usd || 0) * item.quantity), 
      0
    );
    const markupTotalUsd = existingOrder.order_items.reduce(
      (sum: number, item: any) => sum + (Number(item.markup_fee_usd || 0) * item.quantity), 
      0
    );
    const shippingTotalUsd = existingOrder.order_items.reduce(
      (sum: number, item: any) => sum + (Number(item.shipping_fee_usd || 0) * item.quantity), 
      0
    );
    const grandTotalUsd = baseSubtotalUsd + markupTotalUsd + shippingTotalUsd;
    const grandTotalCdf = grandTotalUsd * (settings.exchange_rate_usd_to_cdf || 2800);

    console.log('[Create Order] Totals calculated:', {
      itemCount,
      baseSubtotalUsd,
      markupTotalUsd,
      shippingTotalUsd,
      grandTotalUsd,
      grandTotalCdf
    });

    // Update existing DRAFT order to PENDING_PAYMENT status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'PENDING_PAYMENT',
        item_total_usd: baseSubtotalUsd,
        service_fee_usd: markupTotalUsd,
        shipping_fee_usd: shippingTotalUsd,
        total_usd: grandTotalUsd,
        total_cdf: grandTotalCdf,
        exchange_rate_used: settings.exchange_rate_usd_to_cdf,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingOrder.id)
      .select()
      .single();

    if (updateError) {
      console.error('[Create Order] Error updating order:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to create order' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Create Order] Order updated successfully:', updatedOrder.id);

    return new Response(JSON.stringify({
      orderId: updatedOrder.id,
      grandTotalUsd: grandTotalUsd,
      grandTotalCdf: grandTotalCdf,
      itemCount: itemCount,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Create Order] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
