import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  generateRequestId,
  generateReference,
  buildRedirectResponse,
  buildManualResponse,
  buildCheckoutErrorResponse,
  buildServerErrorResponse,
  getBankDetailsFromSettings,
  checkSoftRateLimit,
  logCheckoutEvent,
  truncate,
  CHECKOUT_ERROR_CODES,
  type BankTransferDetails,
} from "../_shared/checkoutResponse.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * initiate-link-payment Edge Function
 * 
 * PUBLIC endpoint - initiates payment from a payment link.
 * 
 * CRITICAL: ALWAYS returns HTTP 200 for expected cases:
 * - Amount exceeds limits → mode="manual" with bank_transfer
 * - Provider failure → mode="manual" with bank_transfer + error
 * - Rate limit soft → mode="manual" with bank_transfer + error
 * 
 * Only truly unexpected server faults return 500.
 * 
 * Input: { token: string, payment_method?: 'MOBILE_MONEY' | 'CARD' }
 * Output: CheckoutResponse schema
 */
serve(async (req) => {
  const requestId = generateRequestId();

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return buildCheckoutErrorResponse({
      error: {
        code: CHECKOUT_ERROR_CODES.INVALID_INPUT,
        message: 'Method not allowed',
      },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    // Parse request safely
    let body: { token?: string; payment_method?: string } = {};
    try {
      body = await req.json();
    } catch {
      logCheckoutEvent(requestId, 'PARSE_ERROR', { error: 'Invalid JSON body' });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.INVALID_INPUT,
          message: 'Invalid request body',
        },
      });
    }

    const { token, payment_method = 'MOBILE_MONEY' } = body;

    // Validate token
    if (!token || token.length < 32) {
      logCheckoutEvent(requestId, 'VALIDATION_ERROR', { error: 'Invalid token' });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.INVALID_INPUT,
          message: 'Invalid or missing token',
        },
      });
    }

    logCheckoutEvent(requestId, 'INITIATE_PAYMENT_START', {
      token_prefix: token.substring(0, 8),
      payment_method,
    });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate payment link
    const { data: link, error: linkError } = await supabase
      .from('payment_links')
      .select('id, order_id, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (linkError || !link) {
      logCheckoutEvent(requestId, 'LINK_NOT_FOUND', { token_prefix: token.substring(0, 8) });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.LINK_NOT_FOUND,
          message: 'Payment link not found',
          message_fr: 'Lien de paiement introuvable',
        },
      });
    }

    // Check link status
    if (link.status !== 'active') {
      logCheckoutEvent(requestId, 'LINK_INACTIVE', { status: link.status });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.LINK_EXPIRED,
          message: 'This payment link is no longer active',
          message_fr: 'Ce lien de paiement n\'est plus actif',
        },
      });
    }

    // Check expiry
    if (new Date(link.expires_at) < new Date()) {
      logCheckoutEvent(requestId, 'LINK_EXPIRED', { expires_at: link.expires_at });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.LINK_EXPIRED,
          message: 'Payment link has expired. Please request a new link.',
          message_fr: 'Le lien de paiement a expiré. Veuillez demander un nouveau lien.',
        },
      });
    }

    // Fetch order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, status, total_usd, total_cdf, exchange_rate_used, contains_vehicle, maisha_transaction_id')
      .eq('id', link.order_id)
      .single();

    if (orderError || !order) {
      logCheckoutEvent(requestId, 'ORDER_NOT_FOUND', { order_id: link.order_id });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.ORDER_NOT_FOUND,
          message: 'Order not found',
        },
      });
    }

    // Check order status
    if (order.status === 'PAID' || order.status === 'COMPLETED') {
      logCheckoutEvent(requestId, 'ORDER_ALREADY_PAID', { order_id: order.id, status: order.status });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.ORDER_ALREADY_PAID,
          message: 'This order has already been paid.',
          message_fr: 'Cette commande a déjà été payée.',
        },
        order_id: order.id,
        amount: Number(order.total_usd || 0),
        currency: 'USD',
      });
    }

    // Soft rate limit check (returns manual mode, not hard block)
    const rateLimitResult = checkSoftRateLimit(order.user_id || 'anonymous');
    if (!rateLimitResult.allowed) {
      logCheckoutEvent(requestId, 'RATE_LIMIT_SOFT', {
        order_id: order.id,
        count: rateLimitResult.count,
        limit: rateLimitResult.limit,
      });
    }

    // Fetch settings
    const { data: settings } = await supabase
      .from('settings')
      .select(`
        exchange_rate_usd_to_cdf,
        maishapay_max_usd,
        maishapay_max_cdf,
        bank_name,
        bank_account_holder,
        bank_account_number,
        bank_swift,
        bank_iban,
        bank_address,
        bank_instructions_fr,
        bank_instructions_en,
        support_whatsapp,
        support_email
      `)
      .limit(1)
      .single();

    const fxRate = settings?.exchange_rate_usd_to_cdf || order.exchange_rate_used || 2500;
    const maxUsd = settings?.maishapay_max_usd || 5000;
    const maxCdf = settings?.maishapay_max_cdf || 30000000;

    const totalUsd = Number(order.total_usd || 0);
    const totalCdf = Math.round(totalUsd * fxRate);

    // Generate or use existing reference
    const reference = order.maisha_transaction_id || generateReference(order.id, order.user_id);

    // Get bank details for fallback
    const bankDetails = getBankDetailsFromSettings(settings);
    const fallbackBankDetails: BankTransferDetails = bankDetails || {
      beneficiary_name: 'AfriShop LLC',
      bank_name: 'Contact support@afrishop.com',
      iban_or_rib: '',
      swift_or_bic: '',
      notes: 'Please contact support for bank transfer instructions.',
    };

    // Check if rate limited (soft limit - still allow manual mode)
    if (!rateLimitResult.allowed) {
      return buildManualResponse({
        order_id: order.id,
        reference,
        amount: totalUsd,
        currency: 'USD',
        fx_rate: fxRate,
        amount_cdf: totalCdf,
        bank_transfer: fallbackBankDetails,
        error: {
          code: CHECKOUT_ERROR_CODES.RATE_LIMIT_SOFT,
          message: 'Too many requests. Please use bank transfer or try again later.',
          message_fr: 'Trop de requêtes. Veuillez utiliser le virement bancaire ou réessayer plus tard.',
        },
      });
    }

    // Determine enforced currency based on limits
    let enforcedCurrency: 'USD' | 'CDF';
    let payableAmount: number;

    if (totalUsd <= maxUsd) {
      enforcedCurrency = 'USD';
      payableAmount = totalUsd;
    } else if (totalCdf <= maxCdf) {
      enforcedCurrency = 'CDF';
      payableAmount = totalCdf;
    } else {
      // Amount exceeds ALL limits → MUST use bank transfer
      logCheckoutEvent(requestId, 'MANUAL_MODE_REQUIRED', {
        order_id: order.id,
        total_usd: totalUsd,
        total_cdf: totalCdf,
        max_usd: maxUsd,
        max_cdf: maxCdf,
        reason: 'amount_exceeds_all_limits',
      });

      // Update order status to pending bank transfer
      await supabase
        .from('orders')
        .update({
          status: 'PENDING_PAYMENT',
          maisha_transaction_id: reference,
          normalized_currency: 'USD',
          normalized_amount: totalUsd,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      // Create a manual transfer session for tracking
      await supabase
        .from('manual_transfer_sessions')
        .upsert({
          order_id: order.id,
          reference,
          upload_token: crypto.randomUUID(),
          status: 'active',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'order_id' });

      // Return HTTP 200 with mode="manual" (NOT 400!)
      return buildManualResponse({
        order_id: order.id,
        reference,
        amount: totalUsd,
        currency: 'USD',
        fx_rate: fxRate,
        amount_cdf: totalCdf,
        bank_transfer: fallbackBankDetails,
      });
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
      logCheckoutEvent(requestId, 'IDEMPOTENT_HIT', {
        order_id: order.id,
        session_id: existingSession.id,
      });

      return buildRedirectResponse({
        order_id: order.id,
        reference: existingSession.maisha_reference || reference,
        redirect_url: existingSession.redirect_url,
        amount: payableAmount,
        currency: enforcedCurrency,
        fx_rate: fxRate,
        amount_cdf: totalCdf,
        session_id: existingSession.id,
        reused: true,
      });
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
          maisha_transaction_id: reference,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);
    }

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

    // If MaishaPay not configured, fallback to manual mode
    if (!publicKey || !secretKey) {
      logCheckoutEvent(requestId, 'MAISHAPAY_NOT_CONFIGURED', { order_id: order.id });

      return buildManualResponse({
        order_id: order.id,
        reference,
        amount: totalUsd,
        currency: 'USD',
        fx_rate: fxRate,
        amount_cdf: totalCdf,
        bank_transfer: fallbackBankDetails,
        error: {
          code: CHECKOUT_ERROR_CODES.PROVIDER_LINK_FAILED,
          message: 'Payment gateway not configured. Please use bank transfer.',
          message_fr: 'Passerelle de paiement non configurée. Veuillez utiliser le virement bancaire.',
        },
      });
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

    // Create checkout session
    const { data: checkoutSession, error: sessionError } = await supabase
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
        metadata: { from_payment_link: true, link_id: link.id, request_id: requestId },
      })
      .select('id')
      .single();

    if (sessionError) {
      logCheckoutEvent(requestId, 'SESSION_CREATE_FAILED', {
        order_id: order.id,
        error: sessionError.message,
      });

      // Fallback to manual mode instead of returning 500
      return buildManualResponse({
        order_id: order.id,
        reference,
        amount: totalUsd,
        currency: 'USD',
        fx_rate: fxRate,
        amount_cdf: totalCdf,
        bank_transfer: fallbackBankDetails,
        error: {
          code: CHECKOUT_ERROR_CODES.PROVIDER_LINK_FAILED,
          message: 'Unable to create checkout session. Please use bank transfer.',
          message_fr: 'Impossible de créer la session de paiement. Veuillez utiliser le virement bancaire.',
        },
      });
    }

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

    logCheckoutEvent(requestId, 'PAYMENT_INITIATED', {
      order_id: order.id,
      link_id: link.id,
      currency: enforcedCurrency,
      amount: payableAmount,
      mode: 'redirect',
    });

    // Return success with both redirect URL and HTML
    return new Response(
      JSON.stringify({
        ok: true,
        mode: 'redirect',
        currency: enforcedCurrency,
        amount: payableAmount,
        order_id: order.id,
        reference,
        redirect_url: checkoutPageUrl,
        checkout_url: checkoutPageUrl,
        html,
        fx_rate: fxRate,
        amount_cdf: totalCdf,
        display_amount: displayAmount,
        session_id: checkoutSession?.id,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logCheckoutEvent(requestId, 'UNEXPECTED_ERROR', { error: truncate(errorMessage, 200) });
    return buildServerErrorResponse(requestId);
  }
});
