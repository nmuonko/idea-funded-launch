import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation: base + (percentage × items subtotal)
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  const normalizedPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
  return round2(shippingBaseFee + (itemsSubtotal * normalizedPercent));
}

// Calculate cart summary from items
function calculateCartSummary(
  items: any[], 
  shippingBaseFeeUsd: number, 
  shippingPercent: number,
  exchangeRate: number
) {
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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[mobile-create-order-from-cart] Request received');

    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ 
          error: 'DB_FETCH_ERROR', 
          message: 'Failed to fetch cart data.',
          details: orderFetchError.message 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!existingOrder) {
      console.log('[mobile-create-order-from-cart] No draft order found');
      return new Response(
        JSON.stringify({ 
          error: 'EMPTY_CART', 
          message: 'Your cart is empty. Please add items before checkout.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!existingOrder.order_items || existingOrder.order_items.length === 0) {
      console.log('[mobile-create-order-from-cart] Draft order has no items');
      return new Response(
        JSON.stringify({ 
          error: 'EMPTY_CART', 
          message: 'Your cart is empty. Please add items before checkout.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ 
          error: 'SETTINGS_ERROR', 
          message: 'Failed to load pricing configuration.',
          details: settingsError?.message 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Calculate totals
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
      
      return new Response(
        JSON.stringify({ 
          error: 'DB_ORDER_UPDATE_FAILED', 
          message: 'Failed to finalize order. Please try again.',
          details: updateError.message,
          code: updateError.code
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!updatedOrder) {
      console.error('[mobile-create-order-from-cart] Order update returned no data');
      return new Response(
        JSON.stringify({ 
          error: 'DB_ORDER_UPDATE_FAILED', 
          message: 'Failed to finalize order. Please try again.' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[mobile-create-order-from-cart] Order updated successfully:', {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      totalUsd: updatedOrder.total_usd,
      totalCdf: updatedOrder.total_cdf
    });

    // Extract order item IDs for the checkout step
    const orderItemIds = existingOrder.order_items.map((item: any) => item.id);

    // Return success with order details
    // Include BOTH camelCase and snake_case for mobile/web compatibility
    return new Response(
      JSON.stringify({
        success: true,
        // snake_case for web compatibility
        order_id: updatedOrder.id,
        order_item_ids: orderItemIds,
        // camelCase for mobile compatibility
        orderId: updatedOrder.id,
        orderItemIds: orderItemIds,
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
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[mobile-create-order-from-cart] Error:', error.message);
    
    return new Response(
      JSON.stringify({ 
        error: 'INTERNAL_ERROR', 
        message: 'An unexpected error occurred. Please try again.',
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
