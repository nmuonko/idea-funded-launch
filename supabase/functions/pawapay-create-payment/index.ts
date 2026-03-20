/**
 * pawapay-create-payment Edge Function
 * 
 * Creates a deposit request with pawaPay for mobile money payments.
 * Returns the same response shape as mobile-create-payment for compatibility.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser,
  extractRequestToken,
  handleCors, 
  errorResponse, 
  jsonResponse,
  createAdminClient,
  authErrorResponse,
  getRequestAuthDiagnostics,
  normalizeAuthErrorCode,
} from "../_shared/auth.ts";
import { generateTraceId, createTracedLogger } from "../_shared/auditLog.ts";
import {
  getProviderByKey,
  generatePaymentReference,
  createPaymentRecord,
  logPaymentEvent,
} from "../_shared/paymentProviders.ts";
import {
  getPawaPayConfig,
  createDeposit,
  formatPhoneE164,
} from "../_shared/pawapayAdapter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id, x-auth-token, x-session-token, x-access-token, x-jwt, x-supabase-auth, X-Afrishop-Environment',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  try {
    const { token, source: tokenSource } = await extractRequestToken(req);
    const authDiagnostics = getRequestAuthDiagnostics(req, token, tokenSource);
    log.log('pawapay-create-payment auth-check', authDiagnostics);

    if (!token) {
      return authErrorResponse('NO_TOKEN', 'No authentication token found. Please sign in.', { trace_id: traceId });
    }

    let user: any;
    let supabase: any;
    try {
      const authResult = await verifyAndGetUser(req, undefined, { token, source: tokenSource });
      user = authResult.user;
      supabase = authResult.supabase;
      log.log('pawapay-create-payment auth-ok', { userId: user.id, tokenSource: authDiagnostics.tokenSource });
    } catch (authError: any) {
      const errorCode = normalizeAuthErrorCode(authError) || 'INVALID_TOKEN';
      log.error('pawapay-create-payment auth-failed', { ...authDiagnostics, errorCode, reason: authError?.message });
      return authErrorResponse(errorCode, undefined, { trace_id: traceId });
    }

    // Parse request body
    const body = await req.json();
    const { orderId, amount, currency, phone, forceCurrency } = body;

    if (!orderId) {
      return jsonResponse({ ok: false, success: false, code: 'MISSING_ORDER_ID', message: 'orderId is required' }, 200);
    }

    if (!phone) {
      return jsonResponse({ ok: false, success: false, code: 'PHONE_REQUIRED', message: 'phone is required for pawaPay payments' }, 200);
    }

    // Get pawaPay provider config
    const adminClient = createAdminClient();
    const provider = await getProviderByKey(adminClient, 'pawapay');

    if (!provider || !provider.is_enabled) {
      log.error('pawaPay provider not enabled');
      return jsonResponse({ ok: false, success: false, code: 'PROVIDER_NOT_AVAILABLE', message: 'pawaPay is not enabled' }, 200);
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      log.error('Order not found', { orderId, error: orderError?.message });
      return jsonResponse({ ok: false, success: false, code: 'ORDER_NOT_FOUND', message: 'Order not found' }, 200);
    }

    if (order.status !== 'PENDING_PAYMENT') {
      return jsonResponse({ ok: false, success: false, code: 'ORDER_NOT_PAYABLE', message: 'Order cannot be paid' }, 200);
    }

    // Determine payment amount and currency
    let paymentAmount = amount || order.total_usd;
    let paymentCurrency = currency || forceCurrency || 'USD';

    // Apply currency rules
    const exchangeRate = order.exchange_rate_used || 2500;
    if (paymentCurrency === 'CDF') {
      paymentAmount = order.total_cdf || Math.round(order.total_usd * exchangeRate);
    }

    log.log('Payment details', {
      orderId,
      paymentAmount,
      paymentCurrency,
      phone: phone.slice(0, 6) + '****',
    });

    // Get pawaPay API config
    const config = getPawaPayConfig(provider);
    const reference = generatePaymentReference(orderId);

    // Get user profile for email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('user_id', user.id)
      .single();

    // Create deposit with pawaPay
    const result = await createDeposit(config, {
      orderId,
      amount: paymentAmount,
      currency: paymentCurrency as 'USD' | 'CDF',
      customerPhone: phone,
      customerEmail: profile?.email || user.email || '',
      country: 'CD',
      reference,
      description: `AfriShop order ${orderId.slice(0, 8)}`,
    });

    log.log('pawaPay deposit result', {
      success: result.success,
      status: result.status,
      depositId: result.provider_deposit_id,
    });

    if (!result.success) {
      // Log failed attempt
      await logPaymentEvent(adminClient, {
        provider_key: 'pawapay',
        event_type: 'deposit_failed',
        payload: {
          orderId,
          error: result.error,
          raw_response: result.raw_response,
        },
      });

      return jsonResponse({
        ok: false,
        success: false,
        error: result.error,
        code: 'PAWAPAY_ERROR',
        trace_id: traceId,
      }, 200);
    }

    // Create payment record
    const paymentRecord = await createPaymentRecord(adminClient, {
      order_id: orderId,
      provider_key: 'pawapay',
      amount: paymentAmount,
      currency: paymentCurrency,
      reference,
      customer_phone: formatPhoneE164(phone),
      country: 'CD',
      provider_deposit_id: result.provider_deposit_id,
      raw_request: result.raw_request,
      status: 'pending',
    });

    // Log the event
    await logPaymentEvent(adminClient, {
      payment_id: paymentRecord?.id,
      provider_key: 'pawapay',
      event_type: 'deposit_created',
      event_id: result.provider_deposit_id,
      payload: {
        orderId,
        depositId: result.provider_deposit_id,
        amount: paymentAmount,
        currency: paymentCurrency,
      },
    });

    // Update order with payment reference
    await adminClient.from('orders').update({
      normalized_currency: paymentCurrency,
      normalized_amount: paymentAmount,
    }).eq('id', orderId);

    log.log('Payment created successfully', { reference });

    // Build redirect URL for mobile app polling using environment variable
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const redirectUrl = `${frontendBaseUrl}/payment-callback?orderId=${orderId}&provider=pawapay`;

    // Return response compatible with existing mobile app
    return jsonResponse({
      success: true,
      orderId,
      cartId: orderId,
      reference,
      provider: 'pawapay',
      provider_deposit_id: result.provider_deposit_id,
      status: 'pending',
      message: result.message || 'Payment request sent to your phone',
      payment_flow: 'USSD_PUSH',
      redirectUrl, // For mobile WebView intercept
      totals: {
        itemTotal: order.item_total_usd || order.total_usd,
        serviceFee: order.service_fee_usd || 0,
        shippingFee: order.shipping_fee_usd || 0,
        totalUsd: order.total_usd,
        totalCdf: order.total_cdf,
        paymentAmount,
        paymentCurrency,
        exchangeRate,
      },
      trace_id: traceId,
    });

  } catch (error: any) {
    log.error('Error', { message: error.message });
    
    if (error.name === 'AuthError') {
      return jsonResponse({
        ok: false,
        success: false,
        authenticated: false,
        error: 'AUTH_ERROR',
        code: 'AUTH_ERROR',
        message: 'Authentication failed. Please sign in again.',
        trace_id: traceId,
      }, 200);
    }
    
    return jsonResponse({
      ok: false,
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      trace_id: traceId,
    }, 200);
  }
});
