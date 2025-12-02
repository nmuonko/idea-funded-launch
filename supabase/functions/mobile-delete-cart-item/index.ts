import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate cart summary from items - single source of truth
function calculateCartSummary(items: any[], shippingFeeUsd: number, exchangeRate: number) {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let itemCount = 0;
  let totalItemsUsd = 0;
  let totalMarginUsd = 0;
  let itemsSubtotalUsd = 0;

  (items || []).forEach(item => {
    const qty = item.quantity || 1;
    itemCount += qty;
    totalItemsUsd += Number(item.subtotal_usd || 0);
    totalMarginUsd += Number(item.markup_fee_usd || 0);
    itemsSubtotalUsd += Number(item.total_price_usd || 0);
  });

  const grandTotalUsd = round2(itemsSubtotalUsd + shippingFeeUsd);
  const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

  return {
    itemCount,
    totalItemsUsd: round2(totalItemsUsd),
    totalMarginUsd: round2(totalMarginUsd),
    itemsSubtotalUsd: round2(itemsSubtotalUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    grandTotalUsd,
    grandTotalCdf,
    exchangeRate,
  };
}

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

    // Get pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    const exchangeRate = settings?.exchange_rate_usd_to_cdf ?? 2800;
    const shippingFeeUsd = settings?.shipping_base_fee_usd ?? 0;

    // Get updated cart summary
    const { data: remainingItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    const summary = calculateCartSummary(remainingItems || [], shippingFeeUsd, exchangeRate);

    console.log('[mobile-delete-cart-item] Updated cart summary:', summary);

    return new Response(JSON.stringify({
      success: true,
      summary,
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
