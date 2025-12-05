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
} from "../_shared/maishapay.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

/**
 * Generate the HTML checkout page with auto-submitting form
 */
function generateCheckoutHtml(params: {
  checkoutUrl: string;
  gatewayMode: string;
  publicApiKey: string;
  secretApiKey: string;
  amount: number;
  currency: string;
  orderId: string;
  callbackUrl: string;
}): string {
  const { checkoutUrl, gatewayMode, publicApiKey, secretApiKey, amount, currency, orderId, callbackUrl } = params;
  
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paiement MaishaPay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px 30px;
      text-align: center;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      width: 80px;
      height: 80px;
      margin: 0 auto 20px;
      background: #0066cc;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo svg {
      width: 40px;
      height: 40px;
      fill: white;
    }
    h1 {
      color: #1a1a2e;
      font-size: 22px;
      margin-bottom: 10px;
    }
    .amount {
      font-size: 32px;
      font-weight: bold;
      color: #0066cc;
      margin: 20px 0;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid #e0e0e0;
      border-top-color: #0066cc;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    p {
      color: #666;
      font-size: 14px;
      line-height: 1.5;
    }
    .order-ref {
      background: #f5f5f5;
      padding: 8px 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      color: #888;
      margin-top: 20px;
    }
    noscript button {
      background: #0066cc;
      color: white;
      border: none;
      padding: 16px 32px;
      font-size: 18px;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
    </div>
    <h1>Paiement en cours</h1>
    <div class="amount">${amount.toFixed(2)} ${currency}</div>
    <div class="spinner"></div>
    <p>Redirection vers MaishaPay...<br>Veuillez patienter.</p>
    <div class="order-ref">Ref: ${orderId.slice(0, 8).toUpperCase()}</div>
    
    <form id="paymentForm" method="POST" action="${checkoutUrl}">
      <input type="hidden" name="gatewayMode" value="${gatewayMode}">
      <input type="hidden" name="publicApiKey" value="${publicApiKey}">
      <input type="hidden" name="secretApiKey" value="${secretApiKey}">
      <input type="hidden" name="montant" value="${amount}">
      <input type="hidden" name="devise" value="${currency}">
      <input type="hidden" name="callbackUrl" value="${callbackUrl}">
      <input type="hidden" name="reference" value="${orderId}">
      <noscript>
        <button type="submit">Continuer vers MaishaPay</button>
      </noscript>
    </form>
  </div>
  <script>
    document.getElementById('paymentForm').submit();
  </script>
</body>
</html>`;
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
        success: false,
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
      return jsonResponse({ success: false, error: 'DB_FETCH_ERROR', message: 'Failed to fetch cart data.' }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ success: false, error: 'EMPTY_CART', message: 'Your cart is empty.' }, 400);
    }

    // Get the requested items
    const { data: requestedItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', cart_item_ids)
      .eq('order_id', existingOrder.id);

    if (itemsError) {
      console.error('[mobile-create-payment] Error fetching items:', itemsError);
      return jsonResponse({ success: false, error: 'DB_FETCH_ERROR', message: 'Failed to fetch cart items.' }, 500);
    }

    // Validate items
    if (!requestedItems || requestedItems.length !== cart_item_ids.length) {
      return jsonResponse({ success: false, error: 'INVALID_ITEMS', message: 'Some items not found in cart.' }, 400);
    }

    // Check for saved items
    const savedItems = requestedItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ success: false, error: 'SAVED_ITEMS_INCLUDED', message: 'Cannot checkout saved items.' }, 400);
    }

    // Check for manual quote items
    const manualQuoteItems = requestedItems.filter(item => item.requires_manual_quote);
    if (manualQuoteItems.length > 0) {
      return jsonResponse({ success: false, error: 'MANUAL_QUOTE_REQUIRED', message: 'Some items require custom quote.' }, 400);
    }

    // Get pricing settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      return jsonResponse({ success: false, error: 'SETTINGS_ERROR', message: 'Failed to load pricing.' }, 500);
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
      return jsonResponse({ success: false, error: 'DB_ORDER_CREATE_FAILED', message: 'Failed to create order.' }, 500);
    }

    // Move items to new order
    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: checkoutOrder.id })
      .in('id', cart_item_ids);

    if (moveItemsError) {
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ success: false, error: 'DB_MOVE_ITEMS_FAILED', message: 'Failed to process checkout.' }, 500);
    }

    // Generate payment reference
    const paymentReference = generatePaymentReference(checkoutOrder.id);

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
        },
      });

    if (paymentRecordError) {
      console.error('[mobile-create-payment] Error creating payment record:', paymentRecordError);
    }

    // Update order with MaishaPay reference
    await supabase.from('orders').update({
      maisha_transaction_id: paymentReference,
    }).eq('id', checkoutOrder.id);

    // Determine checkout URL based on mode
    const isLiveMode = maishaConfig.mode === 'live';
    const checkoutUrl = isLiveMode 
      ? 'https://maishapay.com/payment/vers1.0/merchant/checkout'
      : 'http://maishapay.test/payment/vers1.0/merchant/checkout';

    // Generate HTML with auto-submitting form
    const html = generateCheckoutHtml({
      checkoutUrl,
      gatewayMode: isLiveMode ? '1' : '0',
      publicApiKey: maishaConfig.publicKey,
      secretApiKey: maishaConfig.secretKey,
      amount: grandTotalUsd,
      currency: 'USD',
      orderId: checkoutOrder.id,
      callbackUrl: maishaConfig.callbackUrl,
    });

    if (!html || html.length === 0) {
      console.error('[mobile-create-payment] Failed to generate HTML');
      return jsonResponse({ 
        success: false, 
        error: 'HTML_GENERATION_FAILED', 
        message: 'Failed to create payment page.' 
      }, 500);
    }

    console.log('[mobile-create-payment] HTML generated successfully, length:', html.length);
    console.log('[mobile-create-payment] Checkout URL:', checkoutUrl);
    console.log('[mobile-create-payment] Mode:', maishaConfig.mode);

    // Return HTML for WebView
    return jsonResponse({
      success: true,
      orderId: checkoutOrder.id,
      html: html,
      order: {
        id: checkoutOrder.id,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
      },
    });

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
