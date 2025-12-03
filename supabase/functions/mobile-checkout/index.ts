import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('[mobile-checkout] Request received');

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-checkout] User authenticated:', user.id);

    // Parse request body
    const body = await req.json();
    const { cart_item_ids } = body;

    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      return errorResponse('cart_item_ids array is required and must not be empty', 400);
    }

    console.log('[mobile-checkout] Checkout requested for items:', cart_item_ids);

    // Get user's DRAFT order
    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error('[mobile-checkout] Error fetching draft order:', orderFetchError);
      return jsonResponse({ 
        error: 'DB_FETCH_ERROR', 
        message: 'Failed to fetch cart data.' 
      }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ 
        error: 'EMPTY_CART', 
        message: 'Your cart is empty. Please add items before checkout.' 
      }, 400);
    }

    // Get the requested items - validate they belong to user, are in DRAFT order, and NOT saved for later
    const { data: requestedItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', cart_item_ids)
      .eq('order_id', existingOrder.id);

    if (itemsError) {
      console.error('[mobile-checkout] Error fetching items:', itemsError);
      return jsonResponse({ 
        error: 'DB_FETCH_ERROR', 
        message: 'Failed to fetch cart items.' 
      }, 500);
    }

    // Validate all requested items exist and are valid
    if (!requestedItems || requestedItems.length !== cart_item_ids.length) {
      const foundIds = requestedItems?.map(i => i.id) || [];
      const missingIds = cart_item_ids.filter(id => !foundIds.includes(id));
      return jsonResponse({ 
        error: 'INVALID_ITEMS', 
        message: 'Some requested items were not found in your cart.',
        missingIds 
      }, 400);
    }

    // Check for saved items
    const savedItems = requestedItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ 
        error: 'SAVED_ITEMS_INCLUDED', 
        message: 'Cannot checkout items that are saved for later. Please move them to cart first.',
        savedItemIds: savedItems.map(i => i.id)
      }, 400);
    }

    // Check for items requiring manual quote
    const manualQuoteItems = requestedItems.filter(item => item.requires_manual_quote);
    if (manualQuoteItems.length > 0) {
      return jsonResponse({ 
        error: 'MANUAL_QUOTE_REQUIRED', 
        message: 'Some items require a custom shipping quote. Please contact us.',
        manualQuoteItemIds: manualQuoteItems.map(i => i.id)
      }, 400);
    }

    // Get pricing settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      console.error('[mobile-checkout] Error fetching settings:', settingsError);
      return jsonResponse({ 
        error: 'SETTINGS_ERROR', 
        message: 'Failed to load pricing configuration.' 
      }, 500);
    }

    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Calculate totals for selected items only
    let itemCount = 0;
    let totalItemsUsd = 0;
    let totalMarginUsd = 0;
    let itemsSubtotalUsd = 0;

    requestedItems.forEach(item => {
      const qty = item.quantity || 1;
      itemCount += qty;
      totalItemsUsd += Number(item.subtotal_usd || 0);
      totalMarginUsd += Number(item.markup_fee_usd || 0);
      itemsSubtotalUsd += Number(item.total_price_usd || 0);
    });

    const shippingFeeUsd = calculateShipping(totalItemsUsd, shippingBaseFeeUsd, shippingPercent);
    const grandTotalUsd = round2(itemsSubtotalUsd + shippingFeeUsd);
    const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

    console.log('[mobile-checkout] Calculated totals for selected items:', {
      itemCount,
      totalItemsUsd: round2(totalItemsUsd),
      shippingFeeUsd,
      grandTotalUsd,
    });

    // Create a new order for checkout with only selected items
    const { data: checkoutOrder, error: createOrderError } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        status: 'PENDING_PAYMENT',
        item_total_usd: round2(totalItemsUsd),
        service_fee_usd: round2(totalMarginUsd),
        shipping_fee_usd: round2(shippingFeeUsd),
        total_usd: grandTotalUsd,
        total_cdf: grandTotalCdf,
        exchange_rate_used: exchangeRate,
      })
      .select()
      .single();

    if (createOrderError) {
      console.error('[mobile-checkout] Error creating checkout order:', createOrderError);
      return jsonResponse({ 
        error: 'DB_ORDER_CREATE_FAILED', 
        message: 'Failed to create order. Please try again.' 
      }, 500);
    }

    // Move selected items to the new order
    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: checkoutOrder.id })
      .in('id', cart_item_ids);

    if (moveItemsError) {
      console.error('[mobile-checkout] Error moving items to checkout order:', moveItemsError);
      // Rollback: delete the new order
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ 
        error: 'DB_MOVE_ITEMS_FAILED', 
        message: 'Failed to process checkout. Please try again.' 
      }, 500);
    }

    console.log('[mobile-checkout] Order created successfully:', {
      orderId: checkoutOrder.id,
      itemCount,
      totalUsd: grandTotalUsd,
    });

    // Return success with order details
    return jsonResponse({
      success: true,
      orderId: checkoutOrder.id,
      order: {
        id: checkoutOrder.id,
        status: checkoutOrder.status,
        itemCount,
        totalItemsUsd: round2(totalItemsUsd),
        totalMarginUsd: round2(totalMarginUsd),
        shippingFeeUsd: round2(shippingFeeUsd),
        grandTotalUsd,
        grandTotalCdf,
        exchangeRate,
      },
      message: 'Order created. Proceed to payment.',
    });

  } catch (error: any) {
    console.error('[mobile-checkout] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ 
      error: 'INTERNAL_ERROR', 
      message: 'An unexpected error occurred. Please try again.',
      details: error.message 
    }, 500);
  }
});
