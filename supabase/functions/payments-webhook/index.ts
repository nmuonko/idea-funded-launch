/**
 * Unified Payment Webhook Router
 * 
 * Routes incoming webhooks to the appropriate provider handler.
 * URL pattern: /payments-webhook?provider=stripe (or /payments-webhook/stripe)
 * 
 * Supported providers:
 * - stripe: Stripe payment_intent events
 * - pawapay: pawaPay deposit callbacks
 * - maishapay: MaishaPay callbacks (delegates to existing handler)
 * - avadapay: Stub (returns 501)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";
import {
  getPaymentByDepositId,
  updatePaymentStatus,
  logPaymentEvent,
} from "../_shared/paymentProviders.ts";
import {
  handleWebhook as handleStripeWebhook,
  verifyWebhookSignature,
} from "../_shared/stripeAdapter.ts";
import {
  processCallback as processPawaPayCallback,
  PawaPayCallbackPayload,
} from "../_shared/pawapayAdapter.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  
  // Extract provider from path or query
  // Supports: /payments-webhook/stripe OR /payments-webhook?provider=stripe
  const pathParts = url.pathname.split('/');
  const pathProvider = pathParts[pathParts.length - 1];
  const queryProvider = url.searchParams.get('provider');
  
  const provider = (pathProvider && pathProvider !== 'payments-webhook') 
    ? pathProvider 
    : queryProvider;

  if (!provider) {
    console.error('[payments-webhook] No provider specified');
    return new Response(
      JSON.stringify({ success: false, error: 'Provider parameter required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('[payments-webhook] Incoming webhook for provider:', provider);

  // Create admin Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    switch (provider.toLowerCase()) {
      case 'stripe':
        return await handleStripe(req, supabase);
      
      case 'pawapay':
        return await handlePawaPay(req, supabase);
      
      case 'maishapay':
        // Delegate to existing maishapay-callback function
        // This maintains backwards compatibility
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Use dedicated /maishapay-callback endpoint' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      
      case 'avadapay':
        console.log('[payments-webhook] AvadaPay webhook - NOT IMPLEMENTED');
        return new Response(
          JSON.stringify({ success: false, error: 'AvadaPay not implemented' }),
          { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      
      default:
        console.error('[payments-webhook] Unknown provider:', provider);
        return new Response(
          JSON.stringify({ success: false, error: `Unknown provider: ${provider}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: any) {
    console.error('[payments-webhook] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ==================== Stripe Handler ====================

async function handleStripe(req: Request, supabase: any): Promise<Response> {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!signature) {
    console.error('[payments-webhook/stripe] Missing stripe-signature header');
    return new Response(
      JSON.stringify({ success: false, error: 'Missing signature' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!webhookSecret) {
    console.error('[payments-webhook/stripe] STRIPE_WEBHOOK_SECRET not configured');
    return new Response(
      JSON.stringify({ success: false, error: 'Webhook secret not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Verify signature (simplified - in production use proper HMAC)
  const isValid = verifyWebhookSignature(body, signature, webhookSecret);
  if (!isValid) {
    console.error('[payments-webhook/stripe] Invalid signature');
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid signature' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const event = JSON.parse(body);
  
  // Log event first
  await logPaymentEvent(supabase, {
    provider_key: 'stripe',
    event_type: event.type,
    event_id: event.id,
    payload: event,
  });

  // Process webhook
  const result = handleStripeWebhook(event);

  console.log('[PAYMENT_WEBHOOK]', {
    provider: 'stripe',
    eventType: event.type,
    paymentIntentId: result.payment_intent_id,
    orderId: result.order_id,
    status: result.status,
  });

  if (!result.success) {
    return new Response(
      JSON.stringify({ success: false, error: result.error }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Update payment record if we have intent_id
  if (result.intent_id) {
    const updated = await updatePaymentStatus(supabase, result.intent_id, result.status, {
      provider_transaction_id: result.payment_intent_id,
      paid_at: result.status === 'succeeded' ? new Date().toISOString() : undefined,
    });

    if (updated && result.status === 'succeeded' && result.order_id) {
      // Update order status
      await supabase
        .from('orders')
        .update({ 
          status: 'PAID',
          payment_verified_at: new Date().toISOString(),
        })
        .eq('id', result.order_id);

      console.log('[payments-webhook/stripe] Order marked as PAID:', result.order_id);
    }
  } else if (result.order_id && result.payment_intent_id) {
    // Fallback: find payment by order_id and update
    const payment = await getPaymentByDepositId(supabase, 'stripe', result.payment_intent_id);
    
    if (payment) {
      await updatePaymentStatus(supabase, payment.id, result.status, {
        provider_transaction_id: result.payment_intent_id,
        paid_at: result.status === 'succeeded' ? new Date().toISOString() : undefined,
      });

      if (result.status === 'succeeded') {
        await supabase
          .from('orders')
          .update({ 
            status: 'PAID',
            payment_verified_at: new Date().toISOString(),
          })
          .eq('id', result.order_id);
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true, received: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ==================== pawaPay Handler ====================

async function handlePawaPay(req: Request, supabase: any): Promise<Response> {
  const payload: PawaPayCallbackPayload = await req.json();

  console.log('[payments-webhook/pawapay] Callback received:', {
    depositId: payload.depositId,
    status: payload.status,
  });

  // Log event first
  await logPaymentEvent(supabase, {
    provider_key: 'pawapay',
    event_type: `deposit.${payload.status?.toLowerCase()}`,
    event_id: payload.depositId,
    payload: payload,
  });

  // Process callback
  const result = processPawaPayCallback(payload);

  console.log('[PAYMENT_WEBHOOK]', {
    provider: 'pawapay',
    depositId: payload.depositId,
    status: result.status,
  });

  // Find payment by deposit ID
  const payment = await getPaymentByDepositId(supabase, 'pawapay', payload.depositId);
  
  if (!payment) {
    console.warn('[payments-webhook/pawapay] Payment not found for depositId:', payload.depositId);
    // Still return 200 to acknowledge receipt
    return new Response(
      JSON.stringify({ success: true, warning: 'Payment not found' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Update payment status
  const updated = await updatePaymentStatus(supabase, payment.id, result.status, {
    provider_transaction_id: payload.correspondentIds?.operatorId || payload.depositId,
    paid_at: result.status === 'succeeded' ? (payload.respondedByPayer || new Date().toISOString()) : undefined,
    raw_events: [...(payment.raw_events || []), payload],
  });

  if (updated && result.status === 'succeeded') {
    // Update order status
    await supabase
      .from('orders')
      .update({ 
        status: 'PAID',
        payment_verified_at: new Date().toISOString(),
      })
      .eq('id', payment.order_id);

    console.log('[payments-webhook/pawapay] Order marked as PAID:', payment.order_id);
  }

  return new Response(
    JSON.stringify({ success: true, received: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
