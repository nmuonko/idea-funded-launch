import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * initiate-link-payment Edge Function
 * 
 * PUBLIC endpoint - initiates MaishaPay checkout from a payment link.
 * Enforces currency based on amount limits.
 * Idempotent: reuses existing pending checkout sessions within 10 minutes.
 * 
 * Input: { token: string, payment_method?: 'MOBILE_MONEY' | 'CARD' }
 * Output: { success: true, checkout_url: string, html: string }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    const body = await req.json();
    const { token, payment_method = 'MOBILE_MONEY' } = body;

    if (!token || token.length < 32) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate payment link
    const { data: link, error: linkError } = await supabase
      .from('payment_links')
      .select('id, order_id, status, expires_at')
      .eq('token', token)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (linkError || !link) {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment link invalid or expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, status, total_usd, total_cdf, exchange_rate_used, contains_vehicle')
      .eq('id', link.order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check order status
    if (order.status === 'PAID' || order.status === 'COMPLETED') {
      return new Response(
        JSON.stringify({ success: false, error: 'Order already paid' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch settings
    const { data: settings } = await supabase
      .from('settings')
      .select('exchange_rate_usd_to_cdf, maishapay_max_usd, maishapay_max_cdf')
      .limit(1)
      .single();

    const fxRate = settings?.exchange_rate_usd_to_cdf || order.exchange_rate_used || 2500;
    const maxUsd = settings?.maishapay_max_usd || 5000;
    const maxCdf = settings?.maishapay_max_cdf || 30000000;

    const totalUsd = Number(order.total_usd || 0);
    const totalCdf = Math.round(totalUsd * fxRate);

    // Determine enforced currency
    let enforcedCurrency: 'USD' | 'CDF';
    let payableAmount: number;

    if (totalUsd <= maxUsd) {
      enforcedCurrency = 'USD';
      payableAmount = totalUsd;
    } else if (totalCdf <= maxCdf) {
      enforcedCurrency = 'CDF';
      payableAmount = totalCdf;
    } else {
      // Should not reach here if client checked decision first
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Order total exceeds MaishaPay limits. Bank transfer required.',
          decision: 'MANUAL_BANK'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing pending checkout session (idempotency)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const { data: existingSession } = await supabase
      .from('checkout_sessions')
      .select('id, maisha_reference, redirect_url, status')
      .eq('order_id', order.id)
      .eq('currency', enforcedCurrency)
      .gte('created_at', tenMinutesAgo)
      .in('status', ['initiated', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSession && existingSession.redirect_url) {
      console.log('LINK_PAYMENT_IDEMPOTENT_HIT', {
        order_id: order.id,
        session_id: existingSession.id,
      });

      return new Response(
        JSON.stringify({
          success: true,
          checkout_url: existingSession.redirect_url,
          reused: true,
          session_id: existingSession.id,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update order status to PENDING_PAYMENT if still DRAFT
    if (order.status === 'DRAFT') {
      await supabase
        .from('orders')
        .update({ 
          status: 'PENDING_PAYMENT',
          normalized_currency: enforcedCurrency,
          normalized_amount: payableAmount,
          exchange_rate_used: fxRate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);
    }

    // Generate reference
    const timestamp = Date.now().toString(36);
    const reference = `AFRISHOP-${order.id.slice(0, 8)}-${timestamp}`;

    // Get MaishaPay config
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
    const legacyMode = Deno.env.get('MAISHAPAY_MODE');
    const isLiveMode = gatewayMode === '1' || legacyMode === '1' || legacyMode?.toLowerCase() === 'live';
    
    let publicKey: string;
    let secretKey: string;
    
    if (isLiveMode) {
      publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_SECRET_API_KEY') || Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || '';
    } else {
      publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_SECRET_API_KEY') || Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || '';
    }

    if (!publicKey || !secretKey) {
      console.error('[initiate-link-payment] Missing MaishaPay keys');
      return new Response(
        JSON.stringify({ success: false, error: 'Payment gateway not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || 
      `${supabaseUrl}/functions/v1/maishapay-callback`;

    // Format amount
    const amountFormatted = enforcedCurrency === 'CDF' 
      ? payableAmount.toString()
      : payableAmount.toFixed(2);

    const displayAmount = enforcedCurrency === 'CDF'
      ? `${payableAmount.toLocaleString('fr-FR')} CDF`
      : `$${payableAmount.toFixed(2)} USD`;

    // Update order with transaction reference
    await supabase
      .from('orders')
      .update({ maisha_transaction_id: reference })
      .eq('id', order.id);

    // Create checkout session
    const { data: checkoutSession } = await supabase
      .from('checkout_sessions')
      .insert({
        user_id: order.user_id,
        order_id: order.id,
        cart_snapshot: [],
        totals_breakdown: { total_usd: totalUsd, total_cdf: totalCdf },
        currency: enforcedCurrency,
        pay_method: payment_method,
        grand_total: payableAmount,
        integrity_hash: `link-${token.substring(0, 16)}`,
        maisha_reference: reference,
        status: 'initiated',
        metadata: { from_payment_link: true, link_id: link.id },
      })
      .select('id')
      .single();

    // Create maisha_payments record
    await supabase
      .from('maisha_payments')
      .insert({
        order_id: order.id,
        maisha_reference: reference,
        amount_usd: totalUsd,
        amount_cdf: totalCdf,
        currency: enforcedCurrency,
        status: 'pending',
        user_id: order.user_id,
      });

    // Generate checkout HTML
    const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';
    const motif = `Paiement AfriShop - Commande ${order.id.slice(0, 8).toUpperCase()}`;

    const html = `<!DOCTYPE html>
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
    <p class="amount">${displayAmount}</p>
    <p class="ref">Réf: ${reference}</p>
  </div>
  
  <form id="payForm" action="${checkoutUrl}" method="POST">
    <input type="hidden" name="gatewayMode" value="${isLiveMode ? '1' : '0'}">
    <input type="hidden" name="publicApiKey" value="${publicKey}">
    <input type="hidden" name="secretApiKey" value="${secretKey}">
    <input type="hidden" name="montant" value="${amountFormatted}">
    <input type="hidden" name="devise" value="${enforcedCurrency}">
    <input type="hidden" name="callbackUrl" value="${callbackUrl}">
    <input type="hidden" name="reference" value="${reference}">
    <input type="hidden" name="motif" value="${motif}">
    <input type="hidden" name="isoCode" value="CD">
    <input type="hidden" name="countryCode" value="CD">
    
    <button type="submit" class="btn" id="payBtn">Payer maintenant</button>
  </form>
  
  <p class="status" id="status"></p>
  <p class="secure">🔒 Paiement sécurisé via MaishaPay</p>
</div>

<script>
(function(){
  var btn = document.getElementById('payBtn');
  var form = document.getElementById('payForm');
  var status = document.getElementById('status');
  var submitted = false;
  
  function submit() {
    if (submitted) return;
    submitted = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Redirection...';
    status.innerHTML = 'Connexion à MaishaPay...';
    setTimeout(function() { form.submit(); }, 500);
  }
  
  setTimeout(submit, 2000);
  
  btn.onclick = function(e) {
    e.preventDefault();
    submit();
  };
})();
</script>
</body>
</html>`;

    // Store redirect URL for idempotency
    const checkoutPageUrl = `${supabaseUrl}/functions/v1/maishapay-checkout-page?order_id=${order.id}`;
    
    if (checkoutSession?.id) {
      await supabase
        .from('checkout_sessions')
        .update({ redirect_url: checkoutPageUrl })
        .eq('id', checkoutSession.id);
    }

    console.log('LINK_PAYMENT_INITIATED', {
      order_id: order.id,
      link_id: link.id,
      currency: enforcedCurrency,
      amount: payableAmount,
      reference,
    });

    return new Response(
      JSON.stringify({
        success: true,
        checkout_url: checkoutPageUrl,
        html,
        reference,
        currency: enforcedCurrency,
        amount: payableAmount,
        display_amount: displayAmount,
        session_id: checkoutSession?.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[initiate-link-payment] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
