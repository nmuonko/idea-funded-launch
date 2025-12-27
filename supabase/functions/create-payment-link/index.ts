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
  logCheckoutEvent,
  CHECKOUT_ERROR_CODES,
  type BankTransferDetails,
} from "../_shared/checkoutResponse.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * create-payment-link Edge Function
 * 
 * Creates or returns existing payment link for an order.
 * Idempotent: if active link exists, returns it.
 * 
 * CRITICAL: ALWAYS returns HTTP 200 for expected cases.
 * Only truly unexpected server faults return 500.
 * 
 * Input: { order_id: string }
 * Output: CheckoutResponse schema (ok, mode, redirect_url, bank_transfer, etc.)
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
    let body: { order_id?: string } = {};
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

    const { order_id } = body;

    // Validate order_id
    if (!order_id) {
      logCheckoutEvent(requestId, 'VALIDATION_ERROR', { error: 'Missing order_id' });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.INVALID_INPUT,
          message: 'order_id is required',
        },
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(order_id)) {
      logCheckoutEvent(requestId, 'VALIDATION_ERROR', { error: 'Invalid order_id format' });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.INVALID_INPUT,
          message: 'Invalid order_id format',
        },
      });
    }

    logCheckoutEvent(requestId, 'CREATE_LINK_START', { order_id });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order exists and fetch details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, user_id, total_usd, total_cdf, exchange_rate_used')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      logCheckoutEvent(requestId, 'ORDER_NOT_FOUND', { order_id, error: orderError?.message });
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.ORDER_NOT_FOUND,
          message: 'Order not found',
        },
        order_id,
      });
    }

    // Check order status - return structured response, not 400
    if (!['DRAFT', 'PENDING_PAYMENT'].includes(order.status)) {
      logCheckoutEvent(requestId, 'ORDER_INVALID_STATUS', { order_id, status: order.status });
      
      if (order.status === 'PAID' || order.status === 'COMPLETED') {
        return buildCheckoutErrorResponse({
          error: {
            code: CHECKOUT_ERROR_CODES.ORDER_ALREADY_PAID,
            message: 'This order has already been paid.',
            message_fr: 'Cette commande a déjà été payée.',
          },
          order_id,
          amount: Number(order.total_usd || 0),
          currency: 'USD',
        });
      }
      
      return buildCheckoutErrorResponse({
        error: {
          code: CHECKOUT_ERROR_CODES.INVALID_INPUT,
          message: `Order is not awaiting payment (status: ${order.status})`,
        },
        order_id,
      });
    }

    // Fetch settings for payment limits and bank details
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

    // CRITICAL: All amounts in DOLLARS (not cents!) and whole CDF
    const totalUsdDollars = Number(order.total_usd || 0);
    const fxRate = settings?.exchange_rate_usd_to_cdf || order.exchange_rate_used || 2500;
    const totalCdfUnits = Math.round(totalUsdDollars * fxRate);
    const maxUsdDollars = settings?.maishapay_max_usd || 5000;
    const maxCdfUnits = settings?.maishapay_max_cdf || 30000000;

    // Generate reference
    const reference = generateReference(order_id, order.user_id);

    /**
     * PAYMENT FLOW DECISION LOGIC:
     * 
     * 1. If total_usd <= 5000 → MAISHAPAY (USD payment)
     * 2. If total_usd > 5000 AND total_cdf <= 30M → MAISHAPAY_CDF_FORCED (CDF payment)
     * 3. If total_cdf > 30M → BANK_TRANSFER
     */
    type PaymentFlow = 'MAISHAPAY' | 'MAISHAPAY_CDF_FORCED' | 'BANK_TRANSFER';
    
    let payment_flow: PaymentFlow;
    let payable_currency: 'USD' | 'CDF';
    let payable_amount: number;

    if (totalUsdDollars <= maxUsdDollars) {
      // RULE 1: USD within MaishaPay limit
      payment_flow = 'MAISHAPAY';
      payable_currency = 'USD';
      payable_amount = Math.round(totalUsdDollars * 100) / 100;
    } else if (totalCdfUnits <= maxCdfUnits) {
      // RULE 2: USD exceeds limit, but CDF conversion is within limit
      payment_flow = 'MAISHAPAY_CDF_FORCED';
      payable_currency = 'CDF';
      payable_amount = totalCdfUnits;
    } else {
      // RULE 3: Both limits exceeded → Bank transfer required
      payment_flow = 'BANK_TRANSFER';
      payable_currency = 'USD';
      payable_amount = Math.round(totalUsdDollars * 100) / 100;
    }

    // STRUCTURED LOG: Payment flow decision with all inputs
    logCheckoutEvent(requestId, 'CHECKOUT_LIMITS_DECISION', {
      order_id,
      total_usd_dollars: totalUsdDollars,
      total_usd_cents: Math.round(totalUsdDollars * 100),
      total_cdf_units: totalCdfUnits,
      usd_limit_dollars: maxUsdDollars,
      cdf_limit_units: maxCdfUnits,
      fx_rate: fxRate,
      payment_flow,
      payable_currency,
      payable_amount,
      usd_exceeds_limit: totalUsdDollars > maxUsdDollars,
      cdf_exceeds_limit: totalCdfUnits > maxCdfUnits,
    });

    // Only require bank transfer when payment_flow is BANK_TRANSFER
    const requiresBankTransfer = payment_flow === 'BANK_TRANSFER';

    if (requiresBankTransfer) {
      logCheckoutEvent(requestId, 'MANUAL_MODE_REQUIRED', {
        order_id,
        total_usd_dollars: totalUsdDollars,
        total_cdf_units: totalCdfUnits,
        max_usd_dollars: maxUsdDollars,
        max_cdf_units: maxCdfUnits,
        reason: 'amount_exceeds_all_limits',
      });

      // Get bank details
      const bankDetails = getBankDetailsFromSettings(settings);

      if (!bankDetails) {
        // Bank not configured - still return 200 with error info
        return buildManualResponse({
          order_id,
          reference,
          amount: totalUsdDollars,
          currency: 'USD',
          fx_rate: fxRate,
          amount_cdf: totalCdfUnits,
          bank_transfer: {
            beneficiary_name: 'Contact Support',
            bank_name: 'Contact support for bank details',
            iban_or_rib: '',
            swift_or_bic: '',
            notes: 'Please contact support@afrishop.com for bank transfer instructions.',
          },
          error: {
            code: CHECKOUT_ERROR_CODES.BANK_CONFIG_MISSING,
            message: 'Bank transfer details not configured. Please contact support.',
            message_fr: 'Les coordonnées bancaires ne sont pas configurées. Veuillez contacter le support.',
          },
        });
      }

      // Update order status to pending bank transfer
      await supabase
        .from('orders')
        .update({
          status: 'PENDING_PAYMENT',
          maisha_transaction_id: reference,
          normalized_currency: payable_currency,
          normalized_amount: payable_amount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order_id);

      // Return manual mode response (HTTP 200)
      return buildManualResponse({
        order_id,
        reference,
        amount: totalUsdDollars,
        currency: 'USD',
        fx_rate: fxRate,
        amount_cdf: totalCdfUnits,
        bank_transfer: bankDetails,
      });
    }

    // Check for existing active link (idempotent)
    const { data: existingLink } = await supabase
      .from('payment_links')
      .select('id, token, expires_at, status')
      .eq('order_id', order_id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existingLink) {
      logCheckoutEvent(requestId, 'LINK_REUSED', {
        order_id,
        link_id: existingLink.id,
        expires_at: existingLink.expires_at,
        payment_flow,
        payable_currency,
      });

      const url = `${frontendBaseUrl}/pay/${existingLink.token}`;

      return buildRedirectResponse({
        order_id,
        reference,
        redirect_url: url,
        amount: payable_amount,
        currency: payable_currency,
        fx_rate: fxRate,
        amount_cdf: totalCdfUnits,
        reused: true,
      });
    }

    // Expire any old links for this order
    await supabase
      .from('payment_links')
      .update({ status: 'expired' })
      .eq('order_id', order_id)
      .eq('status', 'active');

    // Create new payment link
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const { data: newLink, error: insertError } = await supabase
      .from('payment_links')
      .insert({
        order_id,
        expires_at: expiresAt.toISOString(),
        created_by: order.user_id,
      })
      .select('id, token, expires_at')
      .single();

    if (insertError || !newLink) {
      logCheckoutEvent(requestId, 'LINK_CREATE_FAILED', { order_id, error: insertError?.message });
      
      // Fallback to manual mode instead of returning 500
      const bankDetails = getBankDetailsFromSettings(settings);
      
      return buildManualResponse({
        order_id,
        reference,
        amount: totalUsdDollars,
        currency: 'USD',
        fx_rate: fxRate,
        amount_cdf: totalCdfUnits,
        bank_transfer: bankDetails || {
          beneficiary_name: 'Contact Support',
          bank_name: 'Contact support for bank details',
          iban_or_rib: '',
          swift_or_bic: '',
        },
        error: {
          code: CHECKOUT_ERROR_CODES.PROVIDER_LINK_FAILED,
          message: 'Unable to create payment link. Please use bank transfer.',
          message_fr: 'Impossible de créer le lien de paiement. Veuillez utiliser le virement bancaire.',
        },
      });
    }

    logCheckoutEvent(requestId, 'LINK_CREATED', {
      order_id,
      link_id: newLink.id,
      total_usd_dollars: totalUsdDollars,
      payment_flow,
      payable_currency,
      payable_amount,
      mode: 'redirect',
    });

    const url = `${frontendBaseUrl}/pay/${newLink.token}`;

    return buildRedirectResponse({
      order_id,
      reference,
      redirect_url: url,
      amount: payable_amount,
      currency: payable_currency,
      fx_rate: fxRate,
      amount_cdf: totalCdfUnits,
      reused: false,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logCheckoutEvent(requestId, 'UNEXPECTED_ERROR', { error: errorMessage });
    return buildServerErrorResponse(requestId);
  }
});
