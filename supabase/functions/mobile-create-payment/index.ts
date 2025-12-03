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
  createPaymentSession,
  getCheckoutFormFields,
  getMaishaPayConfig,
  validateConfig,
  generatePaymentReference,
} from "../_shared/maishapay.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    console.log('[mobile-create-payment] Request received');

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-create-payment] User authenticated:', user.id);

    // Parse request body
    const body = await req.json();
    const { cart_item_ids, payment_method, phone, email } = body;

    // Validate required fields
    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      return errorResponse('cart_item_ids array is required', 400);
    }

    if (payment_method !== 'maishapay') {
      return errorResponse('Only maishapay payment method is supported', 400);
    }

    // Validate MaishaPay configuration
    const maishaConfig = getMaishaPayConfig();
    const configValidation = validateConfig(maishaConfig);
    if (!configValidation.valid) {
      console.error('[mobile-create-payment] MaishaPay config error:', configValidation.error);
      return jsonResponse({ 
        error: 'PAYMENT_CONFIG_ERROR', 
        message: 'Payment gateway is not properly configured' 
      }, 500);
    }

    console.log('[mobile-create-payment] MaishaPay mode:', maishaConfig.mode);

    // Get user's DRAFT order
    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error('[mobile-create-payment] Error fetching draft order:', orderFetchError);
      return jsonResponse({ error: 'DB_FETCH_ERROR', message: 'Failed to fetch cart data.' }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ error: 'EMPTY_CART', message: 'Your cart is empty.' }, 400);
    }

    // Get the requested items
    const { data: requestedItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', cart_item_ids)
      .eq('order_id', existingOrder.id);

    if (itemsError) {
      console.error('[mobile-create-payment] Error fetching items:', itemsError);
      return jsonResponse({ error: 'DB_FETCH_ERROR', message: 'Failed to fetch cart items.' }, 500);
    }

    // Validate items
    if (!requestedItems || requestedItems.length !== cart_item_ids.length) {
      return jsonResponse({ error: 'INVALID_ITEMS', message: 'Some items not found in cart.' }, 400);
    }

    // Check for saved items
    const savedItems = requestedItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ error: 'SAVED_ITEMS_INCLUDED', message: 'Cannot checkout saved items.' }, 400);
    }

    // Check for manual quote items
    const manualQuoteItems = requestedItems.filter(item => item.requires_manual_quote);
    if (manualQuoteItems.length > 0) {
      return jsonResponse({ error: 'MANUAL_QUOTE_REQUIRED', message: 'Some items require custom quote.' }, 400);
    }

    // Get pricing settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      return jsonResponse({ error: 'SETTINGS_ERROR', message: 'Failed to load pricing.' }, 500);
    }

    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Calculate totals
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

    console.log('[mobile-create-payment] Totals:', { grandTotalUsd, grandTotalCdf, itemCount });

    // Get user profile for customer details
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, name, phone')
      .eq('user_id', user.id)
      .maybeSingle();

    const customerEmail = email || user.email || '';
    const customerPhone = phone || profile?.phone || '';
    const customerName = profile?.full_name || profile?.name || '';

    // Create checkout order
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
        maisha_payment_status: 'PENDING',
      })
      .select()
      .single();

    if (createOrderError) {
      console.error('[mobile-create-payment] Error creating order:', createOrderError);
      return jsonResponse({ error: 'DB_ORDER_CREATE_FAILED', message: 'Failed to create order.' }, 500);
    }

    // Move items to new order
    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: checkoutOrder.id })
      .in('id', cart_item_ids);

    if (moveItemsError) {
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ error: 'DB_MOVE_ITEMS_FAILED', message: 'Failed to process checkout.' }, 500);
    }

    // Create MaishaPay payment session
    const paymentResult = await createPaymentSession({
      amountUsd: grandTotalUsd,
      currency: 'USD',
      customerEmail,
      customerPhone,
      customerName,
      orderId: checkoutOrder.id,
      description: `AfriShop Order #${checkoutOrder.id.slice(0, 8)}`,
    });

    if (!paymentResult.success) {
      console.error('[mobile-create-payment] MaishaPay error:', paymentResult.error);
      // Don't rollback order, just mark payment as failed
      await supabase.from('orders').update({ 
        maisha_payment_status: 'INIT_FAILED',
        maisha_description: paymentResult.error,
      }).eq('id', checkoutOrder.id);
      
      return jsonResponse({ 
        success: false,
        error: 'Failed to initialize payment gateway.',
        orderId: checkoutOrder.id,
      }, 500);
    }

    // Create payment record
    const { error: paymentRecordError } = await supabase
      .from('maisha_payments')
      .insert({
        order_id: checkoutOrder.id,
        maisha_reference: paymentResult.reference,
        amount_usd: grandTotalUsd,
        amount_cdf: grandTotalCdf,
        currency: 'USD',
        status: 'pending',
        raw_request: {
          amount: grandTotalUsd,
          email: customerEmail,
          phone: customerPhone,
          mode: maishaConfig.mode,
        },
      });

    if (paymentRecordError) {
      console.error('[mobile-create-payment] Error creating payment record:', paymentRecordError);
      // Continue anyway, the payment can still work
    }

    // Update order with MaishaPay reference
    await supabase.from('orders').update({
      maisha_transaction_id: paymentResult.reference,
    }).eq('id', checkoutOrder.id);

    console.log('[mobile-create-payment] Payment session created:', {
      orderId: checkoutOrder.id,
      reference: paymentResult.reference,
      mode: maishaConfig.mode,
    });

    // Get checkout form fields for the mobile app
    const formFields = getCheckoutFormFields({
      amountUsd: grandTotalUsd,
      customerEmail,
      customerPhone,
      customerName,
      orderId: checkoutOrder.id,
    });

    // Build final response body
    const responseBody = {
      // Required camelCase keys for mobile app (TOP LEVEL)
      success: true,
      orderId: checkoutOrder.id,
      paymentUrl: paymentResult.checkoutUrl,
      maishapayTransactionId: paymentResult.reference,
      
      // Snake_case for backwards compatibility
      order_id: checkoutOrder.id,
      payment_url: paymentResult.checkoutUrl,
      maishapay_transaction_id: paymentResult.reference,
      maishapay_reference: paymentResult.reference,
      payment_mode: maishaConfig.mode,
      checkout_fields: formFields,
      order: {
        id: checkoutOrder.id,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
      },
    };

    console.log('[mobile-create-payment] Response body:', JSON.stringify(responseBody));

    return jsonResponse(responseBody);

  } catch (error: any) {
    console.error('[mobile-create-payment] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    }, 500);
  }
});
