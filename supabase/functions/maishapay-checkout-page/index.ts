import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectVehicleOrder, getPaymentCurrencyAndAmount } from "../_shared/vehiclePaymentGuard.ts";

/**
 * MaishaPay Checkout Page
 * 
 * This edge function serves an HTML page that auto-submits a form to MaishaPay.
 * This is required because MaishaPay's checkout works via HTML form POST submission.
 * 
 * URL: /functions/v1/maishapay-checkout-page?order_id=XXX
 * 
 * IMPORTANT: High-value orders (>$1000 USD) and vehicle orders use CDF currency
 * to avoid MaishaPay's USD transaction limits.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get('order_id') || url.searchParams.get('orderId');
    
    if (!orderId) {
      return new Response(renderErrorPage('Missing order_id parameter'), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    console.log('[maishapay-checkout-page] Processing order:', orderId);

    // Get MaishaPay configuration - check both env var names for mode
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
    const legacyMode = Deno.env.get('MAISHAPAY_MODE');
    
    // Determine if we're in live mode:
    // MAISHAPAY_GATEWAY_MODE: "1" = live, "0" = sandbox
    // MAISHAPAY_MODE: "1" or "live" = live
    const isLiveMode = gatewayMode === '1' || 
                       legacyMode === '1' || 
                       legacyMode?.toLowerCase() === 'live';
    
    console.log('[maishapay-checkout-page] Mode detection:', { gatewayMode, legacyMode, isLiveMode });
    
    let publicKey: string;
    let secretKey: string;
    
    // CRITICAL: Use MAISHAPAY_SECRET_API_KEY as the primary secret key source
    // This is the actual API key needed for checkout (NOT the webhook secret)
    const primarySecretKey = Deno.env.get('MAISHAPAY_SECRET_API_KEY');
    
    if (isLiveMode) {
      // Live mode - check LIVE keys first, then generic, then primary
      publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
      secretKey = primarySecretKey || 
                  Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || '';
    } else {
      // Sandbox mode
      publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
      secretKey = primarySecretKey || 
                  Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || 
                  Deno.env.get('MAISHA_SECRET_KEY') || '';
    }

    // Log key detection (without revealing full keys)
    console.log('[maishapay-checkout-page] Key detection:', {
      mode: isLiveMode ? 'live' : 'sandbox',
      hasPublicKey: !!publicKey,
      hasSecretKey: !!secretKey,
      publicKeyPrefix: publicKey ? publicKey.slice(0, 15) + '...' : 'MISSING',
      secretKeyPrefix: secretKey ? secretKey.slice(0, 15) + '...' : 'MISSING',
    });

    // Validate keys with clear error messages
    if (!publicKey) {
      const error = `[CONFIG ERROR] Missing MaishaPay public key. Set MAISHAPAY_${isLiveMode ? 'LIVE_' : ''}PUBLIC_KEY`;
      console.error('[maishapay-checkout-page]', error);
      return new Response(renderErrorPage('Payment gateway not configured: missing public key'), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    
    if (!secretKey) {
      const error = `[CONFIG ERROR] Missing MaishaPay secret key. Set MAISHAPAY_${isLiveMode ? 'LIVE_' : ''}SECRET_KEY`;
      console.error('[maishapay-checkout-page]', error);
      return new Response(renderErrorPage('Payment gateway not configured: missing secret key'), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Build callback URL - MUST point to our backend edge function, NOT frontend
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    // Always use the edge function URL for callbacks - ignore MAISHAPAY_CALLBACK_URL if it's a frontend URL
    const configuredCallback = Deno.env.get('MAISHAPAY_CALLBACK_URL') || '';
    const callbackUrl = configuredCallback.includes('/functions/v1/') 
      ? configuredCallback 
      : `${supabaseUrl}/functions/v1/maishapay-callback`;
    
    console.log('[maishapay-checkout-page] Callback URL:', callbackUrl);

    // Create Supabase client
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Fetch order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('[maishapay-checkout-page] Order not found:', orderError);
      return new Response(renderErrorPage('Order not found'), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Check order status
    if (order.status !== 'PENDING_PAYMENT') {
      console.error('[maishapay-checkout-page] Invalid order status:', order.status);
      return new Response(renderErrorPage(`This order cannot be paid. Status: ${order.status}`), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 🚗 VEHICLE DETECTION for logging
    const vehicleDetection = await detectVehicleOrder(supabase, orderId);
    const containsVehicle = vehicleDetection.isVehicle || order.contains_vehicle === true;

    // Get payment amounts
    const totalUsd = Number(order.total_usd) || 0;
    const totalCdf = Number(order.total_cdf) || 0;
    const exchangeRate = Number(order.exchange_rate_used) || 2500;
    
    // VALIDATION: Reject invalid amounts before MaishaPay
    if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
      console.error('[maishapay-checkout-page] INVALID AMOUNT:', {
        orderId,
        containsVehicle,
        total_usd: order.total_usd,
        total_cdf: order.total_cdf,
        item_total_usd: order.item_total_usd,
        shipping_fee_usd: order.shipping_fee_usd,
      });
      return new Response(renderErrorPage('Invalid order amount. Please contact support.'), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 💰 DETERMINE CURRENCY: Use CDF for high-value/vehicle orders to avoid MaishaPay USD limits
    const paymentInfo = getPaymentCurrencyAndAmount(totalUsd, totalCdf, containsVehicle, exchangeRate);
    const { currency, amount, amountFormatted, displayAmount, usedCdf, reason } = paymentInfo;
    
    // Generate reference if not exists
    const reference = order.maisha_transaction_id || `AFRISHOP-${orderId.slice(0, 8)}-${Date.now().toString(36)}`;

    // Update order with reference if new
    if (!order.maisha_transaction_id) {
      await supabase.from('orders').update({
        maisha_transaction_id: reference,
        normalized_currency: currency,
        normalized_amount: amount,
      }).eq('id', orderId);
    }

    // 🚗 VEHICLE CURRENCY GUARD logging
    console.log('[maishapay-checkout-page] CURRENCY SELECTION:', {
      order_id: orderId,
      is_vehicle_order: containsVehicle,
      vehicle_detection_reasons: vehicleDetection.reasons,
      order_contains_vehicle_flag: order.contains_vehicle,
      original_usd: totalUsd,
      original_cdf: totalCdf,
      exchange_rate: exchangeRate,
      final_currency: currency,
      final_amount: amountFormatted,
      used_cdf: usedCdf,
      reason,
    });

    console.log('[maishapay-checkout-page] MAISHAPAY FORM VALUES:', {
      orderId,
      currency,
      amount_raw: amount,
      amount_formatted: amountFormatted,
      display_amount: displayAmount,
      order_shipping_fee_usd: order.shipping_fee_usd,
      order_item_total_usd: order.item_total_usd,
      order_service_fee_usd: order.service_fee_usd,
      contains_vehicle: containsVehicle,
      used_cdf: usedCdf,
      validation: {
        isNumber: typeof amount === 'number',
        isFinite: Number.isFinite(amount),
        isPositive: amount > 0,
      },
      mode: isLiveMode ? 'live' : 'sandbox',
      callbackUrl,
    });

    // Render HTML page with auto-submit form
    const html = renderCheckoutPage({
      publicKey,
      secretKey,
      gatewayMode: isLiveMode ? '1' : '0',
      amount: amountFormatted,
      currency,
      displayAmount,
      reference,
      callbackUrl,
      orderId,
    });

    return new Response(html, {
      status: 200,
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        // Allow inline scripts for auto-submit functionality
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action https://marchand.maishapay.online",
      },
    });

  } catch (error: any) {
    console.error('[maishapay-checkout-page] Error:', error.message);
    return new Response(renderErrorPage('An unexpected error occurred'), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
});

interface CheckoutParams {
  publicKey: string;
  secretKey: string;
  gatewayMode: string;
  amount: string;
  currency: string;
  displayAmount: string;
  reference: string;
  callbackUrl: string;
  orderId: string;
}

function renderCheckoutPage(params: CheckoutParams): string {
  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';
  
  // HTML with auto-submit after showing content briefly
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Paiement AfriShop</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.container{text-align:center;width:100%;max-width:350px}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:20px;margin-bottom:8px}
.subtitle{opacity:0.7;font-size:14px;margin-bottom:24px}
.amount-box{background:rgba(255,255,255,0.1);border-radius:12px;padding:20px;margin-bottom:24px}
.amount-label{font-size:12px;opacity:0.6;margin-bottom:8px}
.amount{font-size:28px;font-weight:bold;color:#00d4ff}
.ref{font-size:11px;opacity:0.5;margin-top:8px}
.btn{width:100%;padding:16px;background:#00d4ff;color:#1a1a2e;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer}
.btn:hover{background:#00b8e6}
.secure{margin-top:20px;font-size:11px;opacity:0.4}
.status{margin-top:16px;font-size:13px;opacity:0.8}
.spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:#00d4ff;border-radius:50%;animation:spin 1s linear infinite;margin-right:8px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
  <div class="icon">💳</div>
  <h1>Paiement Sécurisé</h1>
  <p class="subtitle">AfriShop via MaishaPay</p>
  
  <div class="amount-box">
    <p class="amount-label">Montant à payer</p>
    <p class="amount">${params.displayAmount}</p>
    <p class="ref">Réf: ${params.reference}</p>
  </div>
  
  <form id="payForm" action="${checkoutUrl}" method="POST">
    <input type="hidden" name="gatewayMode" value="${params.gatewayMode}">
    <input type="hidden" name="publicApiKey" value="${params.publicKey}">
    <input type="hidden" name="secretApiKey" value="${params.secretKey}">
    <input type="hidden" name="montant" value="${params.amount}">
    <input type="hidden" name="devise" value="${params.currency}">
    <input type="hidden" name="callbackUrl" value="${params.callbackUrl}">
    <input type="hidden" name="reference" value="${params.reference}">
    
    <button type="submit" class="btn" id="payBtn">Payer maintenant</button>
  </form>
  
  <p class="status" id="status"></p>
  <p class="secure">🔒 Paiement sécurisé via MaishaPay</p>
</div>

<script>
(function(){
  var status = document.getElementById('status');
  var btn = document.getElementById('payBtn');
  var form = document.getElementById('payForm');
  var submitted = false;
  
  function submit() {
    if (submitted) return;
    submitted = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Redirection...';
    status.innerHTML = 'Connexion à MaishaPay...';
    setTimeout(function() { form.submit(); }, 500);
  }
  
  // Auto-submit after 2 seconds
  setTimeout(submit, 2000);
  
  // Or on button click
  btn.onclick = function(e) {
    e.preventDefault();
    submit();
  };
})();
</script>

<noscript>
<style>#status{display:none}</style>
</noscript>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Error</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
      color: #ff6b6b;
    }
    p {
      opacity: 0.8;
      font-size: 0.9rem;
      max-width: 300px;
    }
    .back-btn {
      margin-top: 2rem;
      padding: 1rem 2rem;
      background: #00d4ff;
      color: #1a1a2e;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: bold;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⚠️</div>
    <h1>Payment Error</h1>
    <p>${message}</p>
    <a href="javascript:history.back()" class="back-btn">Go Back</a>
  </div>
</body>
</html>`;
}
