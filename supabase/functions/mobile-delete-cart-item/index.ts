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

    if (!itemId) {
      return new Response(JSON.stringify({ error: 'Item ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[mobile-delete-cart-item] Deleting item:', itemId);

    // Verify item belongs to user and is in a DRAFT order
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .select('*, orders!inner(user_id, status, id)')
      .eq('id', itemId)
      .single();

    if (itemError || !item) {
      return new Response(JSON.stringify({ error: 'Item not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (item.orders.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (item.orders.status !== 'DRAFT') {
      return new Response(JSON.stringify({ error: 'Cannot delete from submitted order' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const orderId = item.orders.id;

    // Delete the item
    const { error: deleteError } = await supabase
      .from('order_items')
      .delete()
      .eq('id', itemId);

    if (deleteError) {
      console.error('[mobile-delete-cart-item] Delete error:', deleteError);
      return new Response(JSON.stringify({ error: 'Failed to delete item' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get updated cart summary
    const { data: remainingItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    let itemCount = 0;
    let baseSubtotalUsd = 0;
    let markupTotalUsd = 0;
    let shippingTotalUsd = 0;
    let grandTotalUsd = 0;

    (remainingItems || []).forEach(i => {
      const qty = i.quantity || 1;
      itemCount += qty;
      baseSubtotalUsd += Number(i.base_price_usd || 0) * qty;
      markupTotalUsd += Number(i.markup_fee_usd || 0) * qty;
      shippingTotalUsd += Number(i.shipping_fee_usd || 0) * qty;
      grandTotalUsd += Number(i.total_price_usd || 0) * qty;
    });

    const { data: settings } = await supabase.from('settings').select('exchange_rate_usd_to_cdf').single();
    const exchangeRate = settings?.exchange_rate_usd_to_cdf || 2800;
    const grandTotalCdf = grandTotalUsd * exchangeRate;

    console.log('[mobile-delete-cart-item] Updated cart summary:', {
      itemCount,
      grandTotalUsd,
    });

    return new Response(JSON.stringify({
      success: true,
      summary: {
        itemCount,
        baseSubtotalUsd: Math.round(baseSubtotalUsd * 100) / 100,
        markupTotalUsd: Math.round(markupTotalUsd * 100) / 100,
        shippingTotalUsd: Math.round(shippingTotalUsd * 100) / 100,
        grandTotalUsd: Math.round(grandTotalUsd * 100) / 100,
        grandTotalCdf: Math.round(grandTotalCdf * 100) / 100,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[mobile-delete-cart-item] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
