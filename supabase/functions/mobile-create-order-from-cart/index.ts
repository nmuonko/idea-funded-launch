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

// Calculate cart summary from items - single source of truth
function calculateCartSummary(
  items: any[], 
  shippingBaseFeeUsd: number, 
  shippingPercent: number,
  exchangeRate: number
) {
  let itemCount = 0;
  let totalItemsUsd = 0;    // Sum of (base_price * qty) for all items
  let totalMarginUsd = 0;   // Sum of markup fees
  let itemsSubtotalUsd = 0; // Sum of (base + margin) for all items

  (items || []).forEach(item => {
    const qty = item.quantity || 1;
    itemCount += qty;
    totalItemsUsd += Number(item.subtotal_usd || 0);
    totalMarginUsd += Number(item.markup_fee_usd || 0);
    itemsSubtotalUsd += Number(item.total_price_usd || 0);
  });

  // Dynamic shipping: base + (percentage × items subtotal)
  const shippingFeeUsd = items && items.length > 0 
    ? calculateShipping(totalItemsUsd, shippingBaseFeeUsd, shippingPercent)
    : 0;

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
    console.log('[mobile-create-order-from-cart] Request received');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Authenticate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('[mobile-create-order-from-cart] Authentication failed:', userError);
      return new Response(JSON.stringify({ 
        error: 'UNAUTHORIZED', 
        message: 'Authentication required.' 
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[mobile-create-order-from-cart] User authenticated:', user.id);

    // Get existing DRAFT order with items
    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error('[mobile-create-order-from-cart] Error fetching draft order:', orderFetchError);
      return new Response(JSON.stringify({ 
        error: 'DB_FETCH_ERROR', 
        message: 'Failed to fetch cart data.',
        details: orderFetchError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!existingOrder) {
      console.log('[mobile-create-order-from-cart] No draft order found');
      return new Response(JSON.stringify({ 
        error: 'EMPTY_CART', 
        message: 'Your cart is empty. Please add items before checkout.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!existingOrder.order_items || existingOrder.order_items.length === 0) {
      console.log('[mobile-create-order-from-cart] Draft order has no items');
      return new Response(JSON.stringify({ 
        error: 'EMPTY_CART', 
        message: 'Your cart is empty. Please add items before checkout.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[mobile-create-order-from-cart] Found draft order:', {
      orderId: existingOrder.id,
      itemCount: existingOrder.order_items.length
    });

    // Get pricing settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      console.error('[mobile-create-order-from-cart] Error fetching settings:', settingsError);
      return new Response(JSON.stringify({ 
        error: 'SETTINGS_ERROR', 
        message: 'Failed to load pricing configuration.',
        details: settingsError?.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Calculate totals using shared helper with dynamic shipping
    const summary = calculateCartSummary(
      existingOrder.order_items, 
      shippingBaseFeeUsd, 
      shippingPercent, 
      exchangeRate
    );

    console.log('[mobile-create-order-from-cart] Calculated totals:', summary);

    // Update existing DRAFT order to PENDING_PAYMENT status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'PENDING_PAYMENT',
        item_total_usd: summary.totalItemsUsd,
        service_fee_usd: summary.totalMarginUsd,
        shipping_fee_usd: summary.shippingFeeUsd,
        total_usd: summary.grandTotalUsd,
        total_cdf: summary.grandTotalCdf,
        exchange_rate_used: exchangeRate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingOrder.id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('[mobile-create-order-from-cart] Error updating order:', {
        error: updateError,
        orderId: existingOrder.id,
        userId: user.id
      });
      
      return new Response(JSON.stringify({ 
        error: 'DB_ORDER_UPDATE_FAILED', 
        message: 'Failed to finalize order. Please try again.',
        details: updateError.message,
        code: updateError.code
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!updatedOrder) {
      console.error('[mobile-create-order-from-cart] Order update returned no data');
      return new Response(JSON.stringify({ 
        error: 'DB_ORDER_UPDATE_FAILED', 
        message: 'Failed to finalize order. Please try again.' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[mobile-create-order-from-cart] Order updated successfully:', {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      totalUsd: updatedOrder.total_usd,
      totalCdf: updatedOrder.total_cdf
    });

    // Return success with order details
    return new Response(JSON.stringify({
      success: true,
      orderId: updatedOrder.id,
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        itemCount: summary.itemCount,
        totalItemsUsd: summary.totalItemsUsd,
        totalMarginUsd: summary.totalMarginUsd,
        shippingFeeUsd: summary.shippingFeeUsd,
        grandTotalUsd: summary.grandTotalUsd,
        grandTotalCdf: summary.grandTotalCdf,
        exchangeRate: exchangeRate,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[mobile-create-order-from-cart] Unexpected error:', error);
    return new Response(JSON.stringify({ 
      error: 'INTERNAL_ERROR', 
      message: 'An unexpected error occurred. Please try again.',
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
