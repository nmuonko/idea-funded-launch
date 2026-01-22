/**
 * Stripe Checkout Session Creator
 * 
 * Creates a Stripe Checkout Session (hosted UI) for card payments.
 * Used for iOS and web where PaymentSheet is not available or unreliable.
 * 
 * POST /functions/v1/stripe-create-checkout-session
 * Input: { "order_id": "uuid" }
 */

import { verifyAndGetUser, handleCors, corsHeaders, createAdminClient } from "../_shared/auth.ts";
import { getStripeConfigFromEnv } from "../_shared/stripeAdapter.ts";

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

interface RequestBody {
  order_id: string;
}

interface CheckoutSessionResponse {
  success: boolean;
  order_id: string;
  checkout_session_id?: string;
  checkout_url?: string;
  amount?: number;
  currency?: string;
  error?: string;
  error_code?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const requestId = crypto.randomUUID();
  console.log(`[STRIPE_CHECKOUT] Request started`, { requestId });

  try {
    // Only accept POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed', error_code: 'METHOD_NOT_ALLOWED' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Authenticate user
    const { user, supabase } = await verifyAndGetUser(req);
    const userId = user.id;
    console.log(`[STRIPE_CHECKOUT] User authenticated`, { requestId, userId });

    // Parse request body
    const body: RequestBody = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing order_id', error_code: 'MISSING_ORDER_ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[STRIPE_CHECKOUT] Processing order`, { requestId, orderId: order_id });

    // Fetch order and verify ownership
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, status, total_usd, normalized_amount, normalized_currency')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      console.error(`[STRIPE_CHECKOUT] Order not found`, { requestId, orderId: order_id, error: orderError });
      return new Response(
        JSON.stringify({ success: false, order_id, error: 'Order not found', error_code: 'ORDER_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user owns this order
    if (order.user_id !== userId) {
      console.warn(`[STRIPE_CHECKOUT] Unauthorized access attempt`, { requestId, orderId: order_id, userId, orderUserId: order.user_id });
      return new Response(
        JSON.stringify({ success: false, order_id, error: 'Unauthorized', error_code: 'UNAUTHORIZED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check order status is payable
    const payableStatuses = ['DRAFT', 'PENDING_PAYMENT'];
    if (!payableStatuses.includes(order.status)) {
      console.warn(`[STRIPE_CHECKOUT] Order not payable`, { requestId, orderId: order_id, status: order.status });
      return new Response(
        JSON.stringify({ success: false, order_id, error: `Order status ${order.status} is not payable`, error_code: 'NOT_PAYABLE' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try to get grand_total from checkout_sessions first (canonical source)
    let grandTotal: number | null = null;
    let currency = 'USD';

    const { data: checkoutSession } = await supabase
      .from('checkout_sessions')
      .select('id, grand_total, currency, totals_breakdown')
      .eq('order_id', order_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (checkoutSession?.grand_total) {
      grandTotal = checkoutSession.grand_total;
      currency = checkoutSession.currency || 'USD';
      console.log(`[STRIPE_CHECKOUT] Using checkout_session grand_total`, { requestId, grandTotal, currency, sessionId: checkoutSession.id });
    } else {
      // Fallback to order.total_usd or normalized_amount
      grandTotal = order.normalized_amount || order.total_usd;
      currency = order.normalized_currency || 'USD';
      console.log(`[STRIPE_CHECKOUT] Using order totals`, { requestId, grandTotal, currency });
    }

    if (!grandTotal || grandTotal <= 0) {
      console.error(`[STRIPE_CHECKOUT] Invalid total`, { requestId, orderId: order_id, grandTotal });
      return new Response(
        JSON.stringify({ success: false, order_id, error: 'Order has no valid total', error_code: 'INVALID_TOTAL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert to cents
    const amountCents = Math.round(grandTotal * 100);
    console.log(`[STRIPE_CHECKOUT] Amount calculated`, { requestId, orderId: order_id, grandTotal, amountCents, currency });

    // Get Stripe config
    const stripeConfig = getStripeConfigFromEnv();

    // Build success/cancel URLs
    const successUrl = `https://afrishop-usa.com/stripe/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order_id}`;
    const cancelUrl = `https://afrishop-usa.com/stripe/cancel?order_id=${order_id}`;

    // Create Stripe Checkout Session
    const stripeBody = new URLSearchParams({
      'mode': 'payment',
      'line_items[0][price_data][currency]': currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': amountCents.toString(),
      'line_items[0][price_data][product_data][name]': `AfriShop Order ${order_id.slice(0, 8)}`,
      'line_items[0][quantity]': '1',
      'metadata[order_id]': order_id,
      'metadata[user_id]': userId,
      'success_url': successUrl,
      'cancel_url': cancelUrl,
    });

    // Add checkout session ID to metadata if we have one
    if (checkoutSession?.id) {
      stripeBody.append('metadata[checkout_session_id]', checkoutSession.id);
    }

    console.log(`[STRIPE_CHECKOUT] Creating Stripe session`, { requestId, orderId: order_id });

    const stripeResponse = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeConfig.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: stripeBody.toString(),
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(`[STRIPE_CHECKOUT] Stripe API error`, { requestId, orderId: order_id, error: stripeData });
      return new Response(
        JSON.stringify({ 
          success: false, 
          order_id, 
          error: stripeData.error?.message || 'Failed to create checkout session', 
          error_code: 'STRIPE_ERROR' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const checkoutSessionId = stripeData.id;
    const checkoutUrl = stripeData.url;

    console.log(`[STRIPE_CHECKOUT] Session created`, { 
      requestId, 
      orderId: order_id, 
      checkoutSessionId,
      hasUrl: !!checkoutUrl 
    });

    // Insert payment record with provider_key='stripe_checkout'
    const paymentReference = `stripe_checkout_${order_id}_${Date.now()}`;
    
    const { error: paymentInsertError } = await supabase
      .from('payments')
      .insert({
        order_id,
        provider_key: 'stripe_checkout',
        provider_deposit_id: checkoutSessionId,
        reference: paymentReference,
        amount: grandTotal,
        currency: currency.toUpperCase(),
        status: 'pending',
        raw_request: {
          checkout_session_id: checkoutSessionId,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
      });

    if (paymentInsertError) {
      console.error(`[STRIPE_CHECKOUT] Failed to insert payment record`, { requestId, orderId: order_id, error: paymentInsertError });
      // Continue anyway - the Stripe session was created successfully
    }

    // Update checkout_sessions metadata if we have a session
    if (checkoutSession?.id) {
      await supabase
        .from('checkout_sessions')
        .update({
          metadata: {
            ...(checkoutSession.metadata || {}),
            stripe_checkout_session_id: checkoutSessionId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', checkoutSession.id);
    }

    // Update order status to PENDING_PAYMENT if it's still DRAFT
    if (order.status === 'DRAFT') {
      await supabase
        .from('orders')
        .update({
          status: 'PENDING_PAYMENT',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order_id);
    }

    // Log summary
    console.log(`[STRIPE_CHECKOUT_SUMMARY]`, {
      requestId,
      orderId: order_id,
      userId,
      grandTotal,
      amountCents,
      currency,
      checkoutSessionId,
      hasCheckoutUrl: !!checkoutUrl,
    });

    const response: CheckoutSessionResponse = {
      success: true,
      order_id,
      checkout_session_id: checkoutSessionId,
      checkout_url: checkoutUrl,
      amount: grandTotal,
      currency: currency.toUpperCase(),
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[STRIPE_CHECKOUT] Unhandled error`, { requestId, error: error.message, stack: error.stack });
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error',
        error_code: 'INTERNAL_ERROR',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
