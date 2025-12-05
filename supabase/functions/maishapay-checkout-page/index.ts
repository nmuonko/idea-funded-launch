import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MaishaPay Checkout Page
 * 
 * This edge function serves an HTML page that auto-submits a form to MaishaPay.
 * This is required because MaishaPay's checkout works via HTML form POST submission.
 * 
 * URL: /functions/v1/maishapay-checkout-page?order_id=XXX
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

    // Get payment amount
    const amount = order.total_usd || 0;
    const currency = 'USD';
    
    // Generate reference if not exists
    const reference = order.maisha_transaction_id || `AFRISHOP-${orderId.slice(0, 8)}-${Date.now().toString(36)}`;

    // Update order with reference if new
    if (!order.maisha_transaction_id) {
      await supabase.from('orders').update({
        maisha_transaction_id: reference
      }).eq('id', orderId);
    }

    console.log('[maishapay-checkout-page] Rendering checkout form:', {
      orderId,
      amount,
      currency,
      reference,
      mode: isLiveMode ? 'live' : 'sandbox',
      callbackUrl,
    });

    // Render HTML page with auto-submit form
    const html = renderCheckoutPage({
      publicKey,
      secretKey,
      gatewayMode: isLiveMode ? '1' : '0',
      amount: amount.toFixed(2),
      currency,
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
  reference: string;
  callbackUrl: string;
  orderId: string;
}

function renderCheckoutPage(params: CheckoutParams): string {
  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';
  
  // CRITICAL: Keep HTML extremely simple for mobile WebView compatibility
  // No JavaScript, minimal CSS, immediate button visibility
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Paiement</title>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#1a1a2e;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">

<div style="text-align:center;width:100%;max-width:350px;">
  <div style="font-size:48px;margin-bottom:16px;">💳</div>
  <h1 style="font-size:20px;margin:0 0 8px 0;">Paiement Sécurisé</h1>
  <p style="margin:0 0 24px 0;opacity:0.7;font-size:14px;">AfriShop - MaishaPay</p>
  
  <div style="background:#16213e;border-radius:12px;padding:20px;margin-bottom:24px;">
    <p style="margin:0 0 8px 0;font-size:12px;opacity:0.6;">Montant à payer</p>
    <p style="margin:0;font-size:32px;font-weight:bold;color:#00d4ff;">$${params.amount}</p>
    <p style="margin:8px 0 0 0;font-size:11px;opacity:0.5;">Réf: ${params.reference.slice(0, 20)}...</p>
  </div>
  
  <form action="${checkoutUrl}" method="POST">
    <input type="hidden" name="gatewayMode" value="${params.gatewayMode}">
    <input type="hidden" name="publicApiKey" value="${params.publicKey}">
    <input type="hidden" name="secretApiKey" value="${params.secretKey}">
    <input type="hidden" name="montant" value="${params.amount}">
    <input type="hidden" name="devise" value="${params.currency}">
    <input type="hidden" name="callbackUrl" value="${params.callbackUrl}">
    <input type="hidden" name="reference" value="${params.reference}">
    
    <button type="submit" style="width:100%;padding:16px;background:#00d4ff;color:#1a1a2e;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;">
      Payer maintenant
    </button>
  </form>
  
  <p style="margin-top:20px;font-size:11px;opacity:0.4;">🔒 Paiement sécurisé via MaishaPay</p>
</div>

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
