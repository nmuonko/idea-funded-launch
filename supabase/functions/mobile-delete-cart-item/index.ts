import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation: base + (percentage × items subtotal)
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

// Calculate and persist order totals from items - CANONICAL FUNCTION
async function updateOrderTotals(
  supabase: any,
  orderId: string,
  shippingBaseFeeUsd: number,
  shippingPercent: number,
  exchangeRate: number
) {
  // Get all items for this order
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('subtotal_usd, markup_fee_usd, total_price_usd, quantity')
    .eq('order_id', orderId);

  if (itemsError) {
    console.error('[updateOrderTotals] Failed to fetch items:', itemsError);
    return null;
  }

  // Calculate order totals from items
  let itemTotalUsd = 0;
  let serviceFeeUsd = 0;
  let itemsWithMarkupUsd = 0;

  (items || []).forEach((item: any) => {
    itemTotalUsd += Number(item.subtotal_usd || 0);
    serviceFeeUsd += Number(item.markup_fee_usd || 0);
    itemsWithMarkupUsd += Number(item.total_price_usd || 0);
  });

  // Dynamic shipping: base + (percentage × items subtotal)
  const shippingFeeUsd = items && items.length > 0 
    ? calculateShipping(itemTotalUsd, shippingBaseFeeUsd, shippingPercent)
    : 0;
  
  // Grand totals
  const totalUsd = round2(itemsWithMarkupUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);

  console.log('[updateOrderTotals] Calculated totals:', {
    orderId,
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
    itemCount: items?.length || 0,
  });

  // Persist to orders table
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      item_total_usd: round2(itemTotalUsd),
      service_fee_usd: round2(serviceFeeUsd),
      shipping_fee_usd: round2(shippingFeeUsd),
      total_usd: totalUsd,
      total_cdf: totalCdf,
      exchange_rate_used: exchangeRate,
    })
    .eq('id', orderId);

  if (updateError) {
    console.error('[updateOrderTotals] Failed to update order totals:', updateError);
    return null;
  }

  return {
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
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
    const shippingBaseFeeUsd = settings?.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings?.shipping_percent ?? 0.10;

    // UPDATE ORDER TOTALS after deletion
    const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

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
