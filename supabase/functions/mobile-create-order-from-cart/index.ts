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

    // Calculate totals by summing all items (respecting quantity)
    const itemCount = existingOrder.order_items.reduce(
      (sum: number, item: any) => sum + (item.quantity || 1), 
      0
    );
    
    const baseSubtotalUsd = existingOrder.order_items.reduce(
      (sum: number, item: any) => sum + (Number(item.base_price_usd || 0) * (item.quantity || 1)), 
      0
    );
    
    const markupTotalUsd = existingOrder.order_items.reduce(
      (sum: number, item: any) => sum + (Number(item.markup_fee_usd || 0) * (item.quantity || 1)), 
      0
    );
    
    const shippingTotalUsd = existingOrder.order_items.reduce(
      (sum: number, item: any) => sum + (Number(item.shipping_fee_usd || 0) * (item.quantity || 1)), 
      0
    );
    
    const grandTotalUsd = baseSubtotalUsd + markupTotalUsd + shippingTotalUsd;
    const exchangeRate = settings.exchange_rate_usd_to_cdf || 2800;
    const grandTotalCdf = grandTotalUsd * exchangeRate;

    console.log('[mobile-create-order-from-cart] Calculated totals:', {
      itemCount,
      baseSubtotalUsd,
      markupTotalUsd,
      shippingTotalUsd,
      grandTotalUsd,
      grandTotalCdf,
      exchangeRate
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
        itemCount: itemCount,
        itemsTotalUsd: baseSubtotalUsd,
        markupTotalUsd: markupTotalUsd,
        shippingTotalUsd: shippingTotalUsd,
        grandTotalUsd: grandTotalUsd,
        grandTotalCdf: grandTotalCdf,
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
