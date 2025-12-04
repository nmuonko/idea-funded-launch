import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import {
  createPaymentSession,
  getMaishaPayConfig,
  validateConfig,
} from "../_shared/maishapay.ts";

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

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    console.log('[mobile-checkout] Request received');

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-checkout] User authenticated:', user.id);

    // Parse request body
    const body = await req.json();
    const { cart_item_ids, phone, email } = body;

    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      return jsonResponse({ success: false, error: 'cart_item_ids array is required and must not be empty' }, 400);
    }

    console.log('[mobile-checkout] Checkout requested for items:', cart_item_ids);

    // Validate MaishaPay configuration
    const maishaConfig = getMaishaPayConfig();
    const configValidation = validateConfig(maishaConfig);
    if (!configValidation.valid) {
      console.error('[mobile-checkout] MaishaPay config error:', configValidation.error);
      return jsonResponse({ 
        success: false,
        error: 'Payment gateway is not properly configured' 
      }, 500);
    }

    console.log('[mobile-checkout] MaishaPay mode:', maishaConfig.mode);

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
        success: false,
        error: 'Failed to fetch cart data.' 
      }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ 
        success: false,
        error: 'Your cart is empty. Please add items before checkout.' 
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
        success: false,
        error: 'Failed to fetch cart items.' 
      }, 500);
    }

    // Validate all requested items exist and are valid
    if (!requestedItems || requestedItems.length !== cart_item_ids.length) {
      return jsonResponse({ 
        success: false,
        error: 'Some requested items were not found in your cart.'
      }, 400);
    }

    // Check for saved items
    const savedItems = requestedItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ 
        success: false,
        error: 'Cannot checkout items that are saved for later. Please move them to cart first.'
      }, 400);
    }

    // Check for items requiring manual quote
    const manualQuoteItems = requestedItems.filter(item => item.requires_manual_quote);
    if (manualQuoteItems.length > 0) {
      return jsonResponse({ 
        success: false,
        error: 'Some items require a custom shipping quote. Please contact us.'
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
        success: false,
        error: 'Failed to load pricing configuration.' 
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

    console.log('[mobile-checkout] Calculated totals:', {
      itemCount,
      totalItemsUsd: round2(totalItemsUsd),
      shippingFeeUsd,
      grandTotalUsd,
    });

    // Get user profile for customer details
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, name, phone')
      .eq('user_id', user.id)
      .maybeSingle();

    const customerEmail = email || user.email || '';
    const customerPhone = phone || profile?.phone || '';
    const customerName = profile?.full_name || profile?.name || '';

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
        maisha_payment_status: 'PENDING',
      })
      .select()
      .single();

    if (createOrderError) {
      console.error('[mobile-checkout] Error creating checkout order:', createOrderError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to create order. Please try again.' 
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
        success: false,
        error: 'Failed to process checkout. Please try again.' 
      }, 500);
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
      const errorDetail = paymentResult.error || 'Unknown payment gateway error';
      console.error('[mobile-checkout] MaishaPay initialization failed:', {
        error: errorDetail,
        orderId: checkoutOrder.id,
        reference: paymentResult.reference,
      });
      
      // Update order status with error details
      await supabase.from('orders').update({ 
        maisha_payment_status: 'INIT_FAILED',
        maisha_description: errorDetail,
      }).eq('id', checkoutOrder.id);
      
      return jsonResponse({ 
        success: false,
        error: `Payment initialization failed: ${errorDetail}`,
        details: errorDetail,
        orderId: checkoutOrder.id,
      }, 500);
    }
    
    console.log('[mobile-checkout] MaishaPay payment session created:', {
      reference: paymentResult.reference,
      checkoutUrlLength: paymentResult.checkoutUrl?.length,
    });

    // Create payment record
    await supabase
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

    // Update order with MaishaPay reference
    await supabase.from('orders').update({
      maisha_transaction_id: paymentResult.reference,
    }).eq('id', checkoutOrder.id);

    // Build the response body
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
      
      // Additional order info
      order: {
        id: checkoutOrder.id,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
      },
    };

    console.log('[mobile-checkout] Response body:', JSON.stringify(responseBody));

    return jsonResponse(responseBody);

  } catch (error: any) {
    console.error('[mobile-checkout] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ success: false, error: error.message }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    }, 500);
  }
});
