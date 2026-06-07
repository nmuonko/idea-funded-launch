/**
 * Unified Payment Webhook Router
 * 
 * Routes incoming webhooks to the appropriate provider handler.
 * URL pattern: /payments-webhook?provider=stripe (or /payments-webhook/stripe)
 * 
 * Supported providers:
 * - stripe: Stripe payment_intent events
 * - pawapay: pawaPay deposit callbacks
 */

import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/http.ts";
import { createReferralCommission } from "../_shared/referralCommission.ts";

const corsHeaders = getCorsHeaders();
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

// ==================== Helper Functions ====================

/**
 * Notify all admins via email about a payment event (success or failure).
 * Mirrors the support-service notifyAllAdminsNewMessage pattern.
 */
async function notifyAllAdminsPaymentEvent(
  supabase: any,
  orderId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  provider: string,
  extra: { customerName?: string; customerEmail?: string; amount?: number; currency?: string } = {}
): Promise<void> {
  try {
    // Get all admin user IDs from user_roles
    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    const adminUserIds = (adminRoles || []).map((r: any) => r.user_id);
    if (adminUserIds.length === 0) return;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email, full_name')
      .in('user_id', adminUserIds);

    const adminEmails = (profiles || [])
      .map((p: any) => p.email)
      .filter((e: string | null) => e);

    if (adminEmails.length === 0) return;

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop USA <noreply@afrishop-usa.com>';
    const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    if (!RESEND_API_KEY) {
      console.log('[payments-webhook] No RESEND_API_KEY, skipping admin payment notification');
      return;
    }

    const isSuccess = status === 'succeeded';
    const statusLabel = isSuccess ? '✅ Payment Successful' : '❌ Payment Failed';
    const statusColor = isSuccess ? '#16a34a' : '#dc2626';
    const urgency = isSuccess ? '' : ' — URGENT';
    const subject = `[AfriShop] ${statusLabel} — Order ${orderId.slice(0, 8)}${urgency}`;

    const customerName = extra.customerName || 'Unknown';
    const customerEmail = extra.customerEmail || 'N/A';
    const amountStr = extra.amount ? `$${extra.amount.toFixed(2)} ${extra.currency || 'USD'}` : 'N/A';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: adminEmails,
        subject,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:${statusColor};">${statusLabel}</h2>
            <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
              <p style="margin:0 0 8px;"><strong>Order ID:</strong> ${orderId}</p>
              <p style="margin:0 0 8px;"><strong>Customer:</strong> ${customerName}</p>
              <p style="margin:0 0 8px;"><strong>Email:</strong> ${customerEmail}</p>
              <p style="margin:0 0 8px;"><strong>Amount:</strong> ${amountStr}</p>
              <p style="margin:0 0 8px;"><strong>Provider:</strong> ${provider}</p>
              <p style="margin:0;"><strong>Status:</strong> <span style="color:${statusColor};font-weight:bold;">${status.toUpperCase()}</span></p>
            </div>
            <p style="margin:16px 0 8px;font-size:14px;color:#666;">${isSuccess ? 'A new payment has been received. Please log in to review and process the order.' : 'A payment has failed. Please log in to check the details and contact the customer if needed.'}</p>
            <p><a href="${frontendUrl}/admin/orders" style="background:${statusColor};color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Open Admin Orders</a></p>
          </div>
        `,
      }),
    });

    console.log(`[payments-webhook] Admin payment notification sent to ${adminEmails.length} admins (${status})`);
  } catch (err) {
    console.error('[payments-webhook] Failed to send admin payment notification:', err);
  }
}

/**
 * Fetch order + customer details for admin notification
 */
async function getOrderDetailsForNotification(supabase: any, orderId: string) {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('user_id, total_usd, total_cdf, normalized_amount, normalized_currency')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr) {
    console.error('[payments-webhook] getOrderDetailsForNotification order query error:', orderErr);
  }
  if (!order) return {};

  let profile: any = null;
  if (order.user_id) {
    const { data: p, error: profErr } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', order.user_id)
      .maybeSingle();
    if (profErr) {
      console.error('[payments-webhook] profile query error:', profErr);
    }
    profile = p;
  }

  const amount = Number(order.total_usd ?? order.normalized_amount ?? order.total_cdf ?? 0);
  const currency = order.normalized_currency || (order.total_usd ? 'USD' : (order.total_cdf ? 'CDF' : 'USD'));

  return {
    customerName: profile?.full_name || profile?.email || 'Unknown',
    customerEmail: profile?.email || 'N/A',
    amount: isFinite(amount) ? amount : 0,
    currency,
  };
}

/**
 * Send payment confirmation email if not already sent (idempotent)
 */
async function sendPaymentConfirmationEmailIfNeeded(
  supabase: any,
  orderId: string,
  source: string
): Promise<void> {
  try {
    // Check if email already sent
    const { data: orderCheck } = await supabase
      .from('orders')
      .select('payment_confirmation_email_sent_at')
      .eq('id', orderId)
      .single();
    
    if (orderCheck?.payment_confirmation_email_sent_at) {
      console.log(`[${source}] [PAYMENT_EMAIL] Email already sent, skipping`, { orderId });
      return;
    }
    
    // Mark as sent first (optimistic lock)
    const { error: updateError } = await supabase
      .from('orders')
      .update({ payment_confirmation_email_sent_at: new Date().toISOString() })
      .eq('id', orderId)
      .is('payment_confirmation_email_sent_at', null); // Only update if still null
    
    if (updateError) {
      console.warn(`[${source}] [PAYMENT_EMAIL] Failed to mark email as sent`, { orderId, error: updateError.message });
      return;
    }
    
    // Send email via edge function
    console.log(`[${source}] [PAYMENT_EMAIL] Sending confirmation email`, { orderId });
    
    const { error: invokeError } = await supabase.functions.invoke('send-payment-confirmation', {
      body: { orderId },
    });
    
    if (invokeError) {
      console.error(`[${source}] [PAYMENT_EMAIL] Send failed`, { orderId, error: invokeError.message });
    } else {
      console.log(`[${source}] [PAYMENT_EMAIL] Sent successfully`, { orderId });
    }
    
  } catch (error: any) {
    console.error(`[${source}] [PAYMENT_EMAIL] Error`, { orderId, error: error.message });
  }
}

// ==================== Main Handler ====================

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

  // Verify signature using proper HMAC-SHA256
  const isValid = await verifyWebhookSignature(body, signature, webhookSecret);
  if (!isValid) {
    console.error('[payments-webhook/stripe] Invalid signature');
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid signature' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const event = JSON.parse(body);
  
  // Handle both PaymentIntent and Checkout Session events
  const allowedEvents = [
    'payment_intent.succeeded', 
    'payment_intent.payment_failed',
    'checkout.session.completed',
    'checkout.session.expired',
  ];
  if (!allowedEvents.includes(event.type)) {
    console.log('[payments-webhook/stripe] Ignoring event type:', event.type);
    return new Response(
      JSON.stringify({ success: true, received: true, ignored: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Log event first
  await logPaymentEvent(supabase, {
    provider_key: 'stripe',
    event_type: event.type,
    event_id: event.id,
    payload: event,
  });

  // ==================== Handle checkout.session.completed ====================
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const sessionId = session.id; // cs_xxx
    const paymentStatus = session.payment_status; // 'paid' | 'unpaid'
    const orderId = session.metadata?.order_id;
    const isCompleted = event.type === 'checkout.session.completed' && paymentStatus === 'paid';
    const isExpired = event.type === 'checkout.session.expired';

    console.log('[PAYMENT_WEBHOOK]', {
      provider: 'stripe_checkout',
      eventType: event.type,
      sessionId,
      paymentStatus,
      orderId,
      isCompleted,
    });

    // Find payment by checkout session ID — try both provider_key values for robustness
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .or('provider_key.eq.stripe,provider_key.eq.stripe_checkout')
      .eq('provider_deposit_id', sessionId)
      .maybeSingle();

    if (paymentError || !payment) {
      console.warn('[payments-webhook/stripe] Payment not found for Checkout Session:', sessionId);
      return new Response(
        JSON.stringify({ success: true, warning: 'Payment record not found for checkout session' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Idempotency: skip if already succeeded
    if (payment.status === 'succeeded') {
      console.log('[payments-webhook/stripe] Payment already succeeded, idempotent skip:', payment.id);
      return new Response(
        JSON.stringify({ success: true, received: true, idempotent: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newStatus = isCompleted ? 'succeeded' : isExpired ? 'failed' : 'pending';

    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
      raw_events: [...(payment.raw_events || []), event],
    };

    if (newStatus === 'succeeded') {
      updateData.paid_at = new Date().toISOString();
      updateData.provider_transaction_id = session.payment_intent || sessionId;
    }

    const { error: updateError } = await supabase
      .from('payments')
      .update(updateData)
      .eq('id', payment.id);

    if (updateError) {
      console.error('[payments-webhook/stripe] Failed to update payment:', updateError);
    } else {
      console.log('[payments-webhook/stripe] Checkout payment updated:', payment.id, newStatus);
    }

    // Update order status on success
    if (newStatus === 'succeeded' && payment.order_id) {
      const paymentKind = (payment as any).kind || 'full';
      const nowIso = new Date().toISOString();

      if (paymentKind === 'balance') {
        // Balance for a deposit-plan order — order is already PAID; flip balance_status.
        await supabase.from('orders').update({
          balance_status: 'paid',
          balance_paid_at: nowIso,
          balance_payment_provider: 'stripe',
          balance_payment_reference: (payment as any).reference || null,
          updated_at: nowIso,
        }).eq('id', payment.order_id);
        console.log('[payments-webhook/stripe] Balance payment recorded, order:', payment.order_id);
      } else {
        // Idempotent order update - only if not already PAID
        const { data: currentOrder } = await supabase
          .from('orders')
          .select('status')
          .eq('id', payment.order_id)
          .single();

        if (currentOrder && currentOrder.status !== 'PAID') {
          await supabase
            .from('orders')
            .update({
              status: 'PAID',
              payment_verified_at: nowIso,
            })
            .eq('id', payment.order_id);

          console.log('[payments-webhook/stripe] Order marked as PAID via checkout webhook:', payment.order_id);
        }
      }

      
      // Clear original cart items
      const { data: checkoutSession } = await supabase
        .from('checkout_sessions')
        .select('id, metadata')
        .eq('order_id', payment.order_id)
        .maybeSingle();
      
      if (checkoutSession?.id) {
        await supabase.from('checkout_sessions').update({
          status: 'paid',
          paid_at: new Date().toISOString(),
        }).eq('id', checkoutSession.id);
        
        const metadata = checkoutSession.metadata as any;
        const originalCartItemIds = metadata?.original_cart_item_ids || metadata?.cart_item_ids;
        
        if (originalCartItemIds && Array.isArray(originalCartItemIds) && originalCartItemIds.length > 0) {
          console.log('[payments-webhook/stripe] Deleting original cart items:', originalCartItemIds.length);
          await supabase.from('order_items').delete().in('id', originalCartItemIds);
        }
      }
      
      // Send payment confirmation email (idempotent)
      await sendPaymentConfirmationEmailIfNeeded(supabase, payment.order_id, 'stripe-checkout-webhook');

      // Notify all admins about successful payment (fire-and-forget)
      const successDetails = await getOrderDetailsForNotification(supabase, payment.order_id);
      notifyAllAdminsPaymentEvent(supabase, payment.order_id, 'succeeded', 'Stripe Checkout', successDetails).catch(() => {});

      // Referral commission (fire-and-forget)
      const { data: paidOrder } = await supabase.from('orders').select('user_id, total_amount').eq('id', payment.order_id).maybeSingle();
      if (paidOrder?.user_id) {
        createReferralCommission(supabase, payment.order_id, paidOrder.user_id, paidOrder.total_amount || 0, 'stripe-checkout-webhook').catch(() => {});
      }
    } else if (newStatus === 'failed' || newStatus === 'cancelled') {
      // Notify admins about failed/cancelled payment
      if (payment.order_id) {
        const failDetails = await getOrderDetailsForNotification(supabase, payment.order_id);
        notifyAllAdminsPaymentEvent(supabase, payment.order_id, 'failed', 'Stripe Checkout', failDetails).catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({ success: true, received: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ==================== Handle payment_intent events (for PaymentSheet flow) ====================
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

  // Map Stripe status to internal payment status
  const internalStatus = mapStripeStatusToInternal(result.status);

  // Find the payment record by provider_deposit_id (PaymentIntent ID)
  // Search BOTH 'stripe' and 'stripe_checkout' provider keys for robustness
  if (result.payment_intent_id) {
    let payment: any = null;
    let paymentError: any = null;

    // Try 'stripe' first (PaymentSheet flow)
    const { data: p1, error: e1 } = await supabase
      .from('payments')
      .select('*')
      .eq('provider_key', 'stripe')
      .eq('provider_deposit_id', result.payment_intent_id)
      .maybeSingle();

    if (p1) {
      payment = p1;
    } else {
      // Fallback: try 'stripe_checkout' where PI ID might be stored as transaction ref
      const { data: p2, error: e2 } = await supabase
        .from('payments')
        .select('*')
        .eq('provider_key', 'stripe_checkout')
        .eq('provider_transaction_id', result.payment_intent_id)
        .maybeSingle();
      
      payment = p2;
      paymentError = e2;
    }

    if (!payment) {
      console.warn('[payments-webhook/stripe] Payment not found for PaymentIntent:', result.payment_intent_id);
      // Still return 200 to acknowledge receipt
      return new Response(
        JSON.stringify({ success: true, warning: 'Payment record not found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Idempotency: skip if already succeeded
    if (payment.status === 'succeeded') {
      console.log('[payments-webhook/stripe] Payment already succeeded, idempotent skip:', payment.id);
      return new Response(
        JSON.stringify({ success: true, received: true, idempotent: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update payment record with status, paid_at, and raw_events
    const updateData: any = {
      status: internalStatus,
      updated_at: new Date().toISOString(),
      raw_events: [...(payment.raw_events || []), event],
    };

    if (internalStatus === 'succeeded') {
      updateData.paid_at = new Date().toISOString();
      updateData.provider_transaction_id = result.payment_intent_id;
    }

    const { error: updateError } = await supabase
      .from('payments')
      .update(updateData)
      .eq('id', payment.id);

    if (updateError) {
      console.error('[payments-webhook/stripe] Failed to update payment:', updateError);
    } else {
      console.log('[payments-webhook/stripe] Payment updated:', payment.id, internalStatus);
    }

    // Update order status on success (with idempotency guard)
    if (internalStatus === 'succeeded' && payment.order_id) {
      const paymentKind = (payment as any).kind || 'full';
      const nowIso = new Date().toISOString();

      if (paymentKind === 'balance') {
        // Balance for a deposit-plan order — only flip balance_status.
        await supabase.from('orders').update({
          balance_status: 'paid',
          balance_paid_at: nowIso,
          balance_payment_provider: 'stripe',
          balance_payment_reference: (payment as any).reference || null,
          updated_at: nowIso,
        }).eq('id', payment.order_id);
        console.log('[payments-webhook/stripe] Balance payment recorded:', payment.order_id);
      } else {
        const { data: currentOrder } = await supabase
          .from('orders')
          .select('status')
          .eq('id', payment.order_id)
          .single();

        const terminalStatuses = ['PAID', 'COMPLETED', 'SHIPPED'];
        if (currentOrder && terminalStatuses.includes(currentOrder.status)) {
          console.log('[payments-webhook/stripe] Order already in terminal state, idempotent skip:', payment.order_id, currentOrder.status);
        } else {
          const { error: orderError } = await supabase
            .from('orders')
            .update({
              status: 'PAID',
              payment_verified_at: nowIso,
            })
            .eq('id', payment.order_id);

          if (orderError) {
            console.error('[payments-webhook/stripe] Failed to update order:', orderError);
          } else {
            console.log('[payments-webhook/stripe] Order marked as PAID:', payment.order_id);
          }
        }
      }

      
      // Clear original cart items
      const { data: checkoutSession } = await supabase
        .from('checkout_sessions')
        .select('id, metadata')
        .eq('order_id', payment.order_id)
        .maybeSingle();
      
      if (checkoutSession?.id) {
        await supabase.from('checkout_sessions').update({
          status: 'paid',
          paid_at: new Date().toISOString(),
        }).eq('id', checkoutSession.id);
        
        const metadata = checkoutSession.metadata as any;
        const originalCartItemIds = metadata?.original_cart_item_ids || metadata?.cart_item_ids;
        
        if (originalCartItemIds && Array.isArray(originalCartItemIds) && originalCartItemIds.length > 0) {
          console.log('[payments-webhook/stripe] Deleting original cart items:', originalCartItemIds.length);
          await supabase.from('order_items').delete().in('id', originalCartItemIds);
        }
      }
      
      // Send payment confirmation email (idempotent)
      await sendPaymentConfirmationEmailIfNeeded(supabase, payment.order_id, 'stripe-webhook');

      // Notify all admins about successful payment (fire-and-forget)
      const successDetails2 = await getOrderDetailsForNotification(supabase, payment.order_id);
      notifyAllAdminsPaymentEvent(supabase, payment.order_id, 'succeeded', 'Stripe', successDetails2).catch(() => {});

      // Referral commission (fire-and-forget)
      const { data: paidOrder2 } = await supabase.from('orders').select('user_id, total_amount').eq('id', payment.order_id).maybeSingle();
      if (paidOrder2?.user_id) {
        createReferralCommission(supabase, payment.order_id, paidOrder2.user_id, paidOrder2.total_amount || 0, 'stripe-webhook').catch(() => {});
      }
    } else if (internalStatus === 'failed' && payment.order_id) {
      // Notify admins about failed payment
      const failDetails2 = await getOrderDetailsForNotification(supabase, payment.order_id);
      notifyAllAdminsPaymentEvent(supabase, payment.order_id, 'failed', 'Stripe', failDetails2).catch(() => {});
    }
  }

  return new Response(
    JSON.stringify({ success: true, received: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Map Stripe webhook status to internal payment status
 */
function mapStripeStatusToInternal(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
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
    const paymentKind = (payment as any).kind || 'full';
    const nowIso = new Date().toISOString();

    if (paymentKind === 'balance') {
      await supabase.from('orders').update({
        balance_status: 'paid',
        balance_paid_at: nowIso,
        balance_payment_provider: 'pawapay',
        balance_payment_reference: (payment as any).reference || null,
        updated_at: nowIso,
      }).eq('id', payment.order_id);
      console.log('[payments-webhook/pawapay] Balance payment recorded:', payment.order_id);
    } else {
      // Idempotency guard: check current order status before updating
      const { data: currentOrder } = await supabase
        .from('orders')
        .select('status')
        .eq('id', payment.order_id)
        .single();

      const terminalStatuses = ['PAID', 'COMPLETED', 'SHIPPED'];
      if (currentOrder && terminalStatuses.includes(currentOrder.status)) {
        console.log('[payments-webhook/pawapay] Order already in terminal state, idempotent skip:', payment.order_id, currentOrder.status);
      } else {
        await supabase
          .from('orders')
          .update({
            status: 'PAID',
            payment_verified_at: nowIso,
          })
          .eq('id', payment.order_id);

        console.log('[payments-webhook/pawapay] Order marked as PAID:', payment.order_id);
      }
    }

    
    // Clear original cart items
    const { data: checkoutSession } = await supabase
      .from('checkout_sessions')
      .select('id, metadata')
      .eq('order_id', payment.order_id)
      .maybeSingle();
    
    if (checkoutSession?.id) {
      await supabase.from('checkout_sessions').update({
        status: 'paid',
        paid_at: new Date().toISOString(),
      }).eq('id', checkoutSession.id);
      
      const metadata = checkoutSession.metadata as any;
      const originalCartItemIds = metadata?.original_cart_item_ids || metadata?.cart_item_ids;
      
      if (originalCartItemIds && Array.isArray(originalCartItemIds) && originalCartItemIds.length > 0) {
        console.log('[payments-webhook/pawapay] Deleting original cart items:', originalCartItemIds.length);
        await supabase.from('order_items').delete().in('id', originalCartItemIds);
      }
    }
    
    // Send payment confirmation email (idempotent)
    await sendPaymentConfirmationEmailIfNeeded(supabase, payment.order_id, 'pawapay-webhook');

    // Notify all admins about successful payment (fire-and-forget)
    const pawapayDetails = await getOrderDetailsForNotification(supabase, payment.order_id);
    notifyAllAdminsPaymentEvent(supabase, payment.order_id, 'succeeded', 'PawaPay (Mobile Money)', pawapayDetails).catch(() => {});
  } else if (result.status === 'failed' && payment?.order_id) {
    // Notify admins about failed PawaPay payment
    const pawapayFailDetails = await getOrderDetailsForNotification(supabase, payment.order_id);
    notifyAllAdminsPaymentEvent(supabase, payment.order_id, 'failed', 'PawaPay (Mobile Money)', pawapayFailDetails).catch(() => {});
  }

  return new Response(
    JSON.stringify({ success: true, received: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
