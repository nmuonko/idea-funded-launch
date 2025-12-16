import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  corsHeaders
} from "../_shared/auth.ts";
import {
  getMaishaPayConfig,
  validateConfig,
  generatePaymentReference,
  generateCheckoutHtml,
} from "../_shared/maishapay.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
import { calculateShipping as calcShipping } from "../_shared/cartHelpers.ts";

/**
 * Mobile Create Payment - STABLE PAYMENT INITIALIZATION
 * 
 * Accepts EITHER:
 * - cartId: UUID of the DRAFT order (will use ALL active items)
 * - cart_item_ids: Array of specific item UUIDs to checkout
 * 
 * CRITICAL: This function NEVER modifies cart data on errors.
 * Items are only moved AFTER all validation passes.
 */

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  }

  try {
    console.log('[mobile-create-payment] Request received');

    // FIRST: Validate MaishaPay configuration
    const maishaConfig = getMaishaPayConfig();
    const configValidation = validateConfig(maishaConfig);
    
    if (!configValidation.valid) {
      console.error('[mobile-create-payment] MaishaPay config error:', configValidation.error);
      return jsonResponse({ 
        success: false,
        error: 'PAYMENT_CONFIG_ERROR',
        message: 'Payment gateway is not properly configured. Please contact support.' 
      }, 500);
    }

    console.log('[mobile-create-payment] MaishaPay mode:', maishaConfig.mode);

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-create-payment] User authenticated:', user.id);

    // Parse request body - accept EITHER cartId OR cart_item_ids
    const body = await req.json();
    const { cartId, cart_item_ids, payment_method, phone, email } = body;

    // Get cached settings - SINGLE SOURCE OF TRUTH
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent } = settings;

    console.log('[mobile-create-payment] Settings loaded:', { exchangeRate, markupPercent, shippingBaseFeeUsd });

    // STEP 1: Find the user's DRAFT order
    let draftOrderId: string | null = null;
    let itemIdsToCheckout: string[] = [];

    if (cartId) {
      // Validate cartId belongs to user and is DRAFT
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, status, user_id')
        .eq('id', cartId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (orderErr) {
        console.error('[mobile-create-payment] Error fetching order by cartId:', orderErr);
        return jsonResponse({ success: false, error: 'CART_FETCH_ERROR', message: 'Failed to fetch cart.' }, 500);
      }

      if (!order) {
        return jsonResponse({ success: false, error: 'CART_NOT_FOUND', message: 'Cart not found.' }, 404);
      }

      if (order.status !== 'DRAFT') {
        return jsonResponse({ success: false, error: 'CART_NOT_DRAFT', message: 'Cart is no longer available for checkout.' }, 400);
      }

      draftOrderId = order.id;
      
      // Get ALL active items from this cart (not saved for later)
      const { data: allItems, error: allItemsErr } = await supabase
        .from('order_items')
        .select('id')
        .eq('order_id', draftOrderId)
        .eq('is_saved_for_later', false);

      if (allItemsErr) {
        console.error('[mobile-create-payment] Error fetching items by cartId:', allItemsErr);
        return jsonResponse({ success: false, error: 'FAILED_TO_FETCH_CART_ITEMS', message: 'Failed to fetch cart items.' }, 500);
      }

      itemIdsToCheckout = (allItems || []).map((i: any) => i.id);
      console.log('[mobile-create-payment] Using cartId mode, found', itemIdsToCheckout.length, 'items');

    } else if (cart_item_ids && Array.isArray(cart_item_ids) && cart_item_ids.length > 0) {
      // Use specific item IDs - find their parent DRAFT order
      const { data: existingOrder, error: orderFetchError } = await supabase
        .from('orders')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'DRAFT')
        .maybeSingle();

      if (orderFetchError) {
        console.error('[mobile-create-payment] Error fetching draft order:', orderFetchError);
        return jsonResponse({ success: false, error: 'CART_FETCH_ERROR', message: 'Failed to fetch cart data.' }, 500);
      }

      if (!existingOrder) {
        return jsonResponse({ success: false, error: 'EMPTY_CART', message: 'Your cart is empty. Please add items before paying.' }, 400);
      }

      draftOrderId = existingOrder.id;
      itemIdsToCheckout = cart_item_ids;
      console.log('[mobile-create-payment] Using cart_item_ids mode, checking', itemIdsToCheckout.length, 'items');

    } else {
      // No cartId or cart_item_ids - find latest DRAFT order automatically
      const { data: latestDraft, error: latestErr } = await supabase
        .from('orders')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'DRAFT')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestErr) {
        console.error('[mobile-create-payment] Error fetching latest draft:', latestErr);
        return jsonResponse({ success: false, error: 'CART_FETCH_ERROR', message: 'Failed to fetch cart.' }, 500);
      }

      if (!latestDraft) {
        return jsonResponse({ success: false, error: 'EMPTY_CART', message: 'Your cart is empty. Please add items before paying.' }, 400);
      }

      draftOrderId = latestDraft.id;

      // Get ALL active items
      const { data: allItems, error: allItemsErr } = await supabase
        .from('order_items')
        .select('id')
        .eq('order_id', draftOrderId)
        .eq('is_saved_for_later', false);

      if (allItemsErr) {
        console.error('[mobile-create-payment] Error fetching items:', allItemsErr);
        return jsonResponse({ success: false, error: 'FAILED_TO_FETCH_CART_ITEMS', message: 'Failed to fetch cart items.' }, 500);
      }

      itemIdsToCheckout = (allItems || []).map((i: any) => i.id);
      console.log('[mobile-create-payment] Using auto-detect mode, found', itemIdsToCheckout.length, 'items');
    }

    // STEP 2: Validate we have items to checkout
    if (itemIdsToCheckout.length === 0) {
      return jsonResponse({ success: false, error: 'EMPTY_CART', message: 'Your cart is empty. Please add items before paying.' }, 400);
    }

    // STEP 3: Fetch full item details
    const { data: requestedItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', itemIdsToCheckout)
      .eq('order_id', draftOrderId);

    if (itemsError) {
      console.error('[mobile-create-payment] Error fetching item details:', itemsError);
      return jsonResponse({ success: false, error: 'FAILED_TO_FETCH_CART_ITEMS', message: 'Failed to fetch cart items.' }, 500);
    }

    if (!requestedItems || requestedItems.length === 0) {
      return jsonResponse({ success: false, error: 'EMPTY_CART', message: 'Your cart is empty. Please add items before paying.' }, 400);
    }

    // Validate all requested items were found
    if (requestedItems.length !== itemIdsToCheckout.length) {
      console.warn('[mobile-create-payment] Some items not found:', {
        requested: itemIdsToCheckout.length,
        found: requestedItems.length
      });
      return jsonResponse({ success: false, error: 'ITEMS_NOT_FOUND', message: 'Some items were not found in your cart.' }, 400);
    }

    // Check for saved items
    const savedItems = requestedItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ success: false, error: 'SAVED_ITEMS', message: 'Cannot checkout items that are saved for later.' }, 400);
    }

    // Check for manual quote items (vehicles without applied quotes)
    const pendingQuoteItems = requestedItems.filter(item => 
      item.requires_manual_quote === true || 
      (item.is_vehicle === true && item.vehicle_quote_applied !== true)
    );
    if (pendingQuoteItems.length > 0) {
      return jsonResponse({ 
        success: false, 
        error: 'QUOTE_REQUIRED', 
        message: 'Some items require a shipping quote before checkout.',
        pendingItems: pendingQuoteItems.map(i => ({ id: i.id, title: i.title }))
      }, 400);
    }

    // STEP 4: Calculate totals using SAME LOGIC as mobile-get-cart
    let itemCount = 0;
    let regularItemsBase = 0;
    let regularItemsMargin = 0;
    let vehicleTotal = 0;
    let vehicleShipping = 0;

    requestedItems.forEach(item => {
      const qty = item.quantity || 1;
      itemCount += qty;
      
      if (item.is_vehicle === true && item.vehicle_quote_applied === true) {
        // Vehicle with applied quote - use stored total (includes shipping)
        vehicleTotal += Number(item.total_price_usd || 0);
        vehicleShipping += Number(item.shipping_fee_usd || 0);
      } else {
        // Regular item
        regularItemsBase += Number(item.subtotal_usd || item.base_price_usd || 0);
        regularItemsMargin += Number(item.markup_fee_usd || 0);
      }
    });

    // Calculate shipping for regular items only
    const regularShippingFeeUsd = regularItemsBase > 0 
      ? calcShipping(regularItemsBase, shippingBaseFeeUsd, shippingPercent) 
      : 0;

    // Final totals - CONSISTENT with mobile-get-cart
    const regularTotal = round2(regularItemsBase + regularItemsMargin + regularShippingFeeUsd);
    const grandTotalUsd = round2(regularTotal + vehicleTotal);
    const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

    // Combined values for order record
    const totalItemsUsd = round2(regularItemsBase + (vehicleTotal - vehicleShipping));
    const totalMarginUsd = round2(regularItemsMargin);
    const totalShippingUsd = round2(regularShippingFeeUsd + vehicleShipping);

    console.log('[mobile-create-payment] Totals calculated:', {
      itemCount,
      regularItemsBase,
      regularItemsMargin,
      regularShippingFeeUsd,
      vehicleTotal,
      vehicleShipping,
      grandTotalUsd,
      grandTotalCdf,
      exchangeRate
    });

    // VALIDATION: Reject invalid amounts
    if (!Number.isFinite(grandTotalUsd) || grandTotalUsd <= 0) {
      console.error('[mobile-create-payment] INVALID AMOUNT:', { grandTotalUsd, itemCount });
      return jsonResponse({
        success: false,
        error: 'INVALID_AMOUNT',
        message: 'Unable to calculate order total. Please refresh your cart and try again.',
      }, 400);
    }

    // STEP 5: Create checkout order (ONLY after all validation passes)
    const { data: checkoutOrder, error: createOrderError } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        status: 'PENDING_PAYMENT',
        item_total_usd: round2(totalItemsUsd),
        service_fee_usd: round2(totalMarginUsd),
        shipping_fee_usd: round2(totalShippingUsd),
        total_usd: grandTotalUsd,
        total_cdf: grandTotalCdf,
        exchange_rate_used: exchangeRate,
        maisha_payment_status: 'PENDING',
      })
      .select()
      .single();

    if (createOrderError) {
      console.error('[mobile-create-payment] Error creating order:', createOrderError);
      return jsonResponse({ success: false, error: 'ORDER_CREATE_ERROR', message: 'Failed to create order. Please try again.' }, 500);
    }

    // STEP 6: Move items to new order
    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: checkoutOrder.id })
      .in('id', itemIdsToCheckout);

    if (moveItemsError) {
      console.error('[mobile-create-payment] Error moving items:', moveItemsError);
      // Rollback: delete the empty checkout order
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ success: false, error: 'CHECKOUT_ERROR', message: 'Failed to process checkout. Please try again.' }, 500);
    }

    // STEP 7: Generate payment reference and create payment record
    const paymentReference = generatePaymentReference(checkoutOrder.id);
    const orderNumber = checkoutOrder.id.slice(0, 8).toUpperCase();

    // Update order with MaishaPay reference
    await supabase.from('orders').update({
      maisha_transaction_id: paymentReference,
    }).eq('id', checkoutOrder.id);

    // Create payment record
    const { error: paymentRecordError } = await supabase
      .from('maisha_payments')
      .insert({
        order_id: checkoutOrder.id,
        maisha_reference: paymentReference,
        amount_usd: grandTotalUsd,
        amount_cdf: grandTotalCdf,
        currency: 'USD',
        status: 'pending',
        user_id: user.id,
        raw_request: {
          amount: grandTotalUsd,
          mode: maishaConfig.mode,
          orderNumber,
          itemCount,
        },
      });

    if (paymentRecordError) {
      console.error('[mobile-create-payment] Error creating payment record:', paymentRecordError);
      // Non-fatal - continue
    }

    // STEP 8: Generate HTML checkout page
    const { html, error: htmlError } = generateCheckoutHtml({
      amount: grandTotalUsd,
      currency: 'USD',
      orderId: checkoutOrder.id,
      orderNumber,
    });

    if (htmlError || !html || html.length === 0) {
      console.error('[mobile-create-payment] HTML generation failed:', htmlError);
      return jsonResponse({ 
        success: false, 
        error: 'PAYMENT_PAGE_ERROR',
        message: 'Failed to create payment page. Please try again.' 
      }, 500);
    }

    console.log('[mobile-create-payment] SUCCESS - Order:', checkoutOrder.id, 'Reference:', paymentReference);

    // Return success with totals for mobile display
    return jsonResponse({
      success: true,
      orderId: checkoutOrder.id,
      cartId: checkoutOrder.id, // Alias for compatibility
      confirmationId: orderNumber,
      html: html,
      totals: {
        itemsTotal: totalItemsUsd,
        marginFee: totalMarginUsd,
        shippingFee: totalShippingUsd,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
        exchangeRate: exchangeRate,
      },
      order: {
        id: checkoutOrder.id,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
      },
    });

  } catch (error: any) {
    console.error('[mobile-create-payment] Unhandled error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        success: false, 
        error: 'AUTH_ERROR', 
        message: error.message 
      }, error.status || 401);
    }
    
    // Generic error - NEVER expose internal details
    return jsonResponse({ 
      success: false,
      error: 'UNEXPECTED_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    }, 500);
  }
});
