/**
 * email-service — Consolidated Email Service
 * 
 * Single entry point for all email/notification sending.
 * Routes by `type` field in POST body to the appropriate send-* function.
 * Some types (order_assistance) are handled inline to avoid forwarding issues.
 * 
 * AUTH: All actions require a valid JWT (via getUser) or cron secret.
 * Exception: cart_reminder and abandoned_cart may be triggered by cron.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, ADMIN_EMAIL } from "../_shared/email.ts";
import { buildOrderAssistanceEmail, AssistanceEmailLanguage } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function requireAuth(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonRes({ ok: false, error: 'Unauthorized: missing Bearer token' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return jsonRes({ ok: false, error: 'Unauthorized: invalid token' }, 401);
  }

  return { userId: user.id };
}

function hasCronSecret(req: Request): boolean {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');
  return !!(cronSecret && expected && cronSecret === expected);
}

// Email types that can be triggered by cron jobs
const CRON_TYPES = new Set(['cart_reminder', 'abandoned_cart', 'abandoned_cart_recovery', 'saved_cart_reminders']);

// Types handled inline (not forwarded)
const INLINE_TYPES = new Set(['order_assistance']);

const TYPE_TO_FUNCTION: Record<string, string> = {
  // Order lifecycle
  order_email: 'send-order-email',
  order_confirmation: 'send-order-confirmation',
  confirmation_email: 'send-confirmation-email',
  order_processing: 'send-order-processing-email',
  order_ready: 'send-order-ready-email',
  order_shipped: 'send-order-shipped-email',
  order_delivered: 'send-order-delivered-email',
  order_assistance: 'send-order-assistance-email',

  // Payment
  payment_confirmation: 'send-payment-confirmation',
  payment_confirmation_email: 'send-payment-confirmation-email',
  admin_payment_notification: 'send-admin-payment-notification',

  // Shipping / Delivery
  shipping_notification: 'send-shipping-notification',
  shipping_update: 'send-shipping-update',
  delivery_notification: 'send-delivery-notification',

  // Cart recovery
  cart_reminder: 'send-cart-reminder-emails',
  abandoned_cart: 'send-abandoned-cart-emails',
  abandoned_cart_recovery: 'send-abandoned-cart-recovery',

  // Quotes
  quote_email: 'send-quote-email',
  quote_response: 'send-quote-response-notification',

  // Support
  ticket_notification: 'send-ticket-notification',
  feedback: 'send-feedback-email',
  fraud_alert: 'send-fraud-alert-email',

  // Customer / General
  customer_email: 'send-customer-email',
  application_email: 'send-application-emails',
  test_email: 'send-test-email',
  saved_cart_reminders: 'saved-cart-reminders',

  // Push notifications
  push_notification: 'send-push-notification',
};

// ==================== Inline Handlers ====================

const VALID_LANGUAGES: AssistanceEmailLanguage[] = ['en', 'fr', 'sw', 'ln', 'en_sw'];

async function handleOrderAssistance(body: any, userId: string): Promise<Response> {
  const { orderId, language = 'fr' } = body;

  if (!orderId) {
    return jsonRes({ ok: false, error: 'orderId is required' }, 400);
  }

  const validatedLanguage: AssistanceEmailLanguage = VALID_LANGUAGES.includes(language as AssistanceEmailLanguage)
    ? (language as AssistanceEmailLanguage)
    : 'fr';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // Fetch order with profile
  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .select('id, status, total_usd, user_id, profiles(name, email, full_name)')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    console.error('[order_assistance] Order fetch error:', orderError?.message);
    return jsonRes({ ok: false, error: 'Order not found' }, 404);
  }

  console.log(`[order_assistance] Order ${orderId} status=${order.status} total=$${order.total_usd}`);

  // Allow incomplete statuses
  if (!['DRAFT', 'PENDING_PAYMENT'].includes(order.status)) {
    return jsonRes({ ok: false, error: `Email only for incomplete orders. Current status: ${order.status}` }, 400);
  }

  const profile = order.profiles as any;
  const customerEmail = profile?.email;
  const customerName = profile?.full_name || profile?.name || 'Customer';

  if (!customerEmail) {
    console.error('[order_assistance] No customer email for order', orderId);
    return jsonRes({ ok: false, error: 'Customer email not found on profile' }, 400);
  }

  // Get item count
  const { data: items } = await serviceClient
    .from('order_items')
    .select('id')
    .eq('order_id', orderId)
    .eq('is_saved_for_later', false);

  const itemCount = items?.length || 0;

  // Get support contact
  const { data: supportContact } = await serviceClient
    .from('settings')
    .select('support_whatsapp, support_email')
    .limit(1)
    .maybeSingle();

  const supportWhatsapp = supportContact?.support_whatsapp || '243973141627';
  const supportEmail = supportContact?.support_email || 'nkadimisha@afrishop-usa.com';
  const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

  // Build and send email
  const emailTemplate = buildOrderAssistanceEmail({
    customerName,
    orderId,
    itemCount,
    totalUsd: Number(order.total_usd || 0),
    frontendBaseUrl,
    language: validatedLanguage,
    supportWhatsapp,
    supportEmail,
  });

  console.log(`[order_assistance] Sending ${validatedLanguage} email to ${customerEmail}`);

  const emailResult = await sendEmail({
    to: customerEmail,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    category: 'customer_email',
    replyTo: ADMIN_EMAIL,
  });

  if (!emailResult.success) {
    console.error('[order_assistance] Email send failed:', emailResult.error);
    return jsonRes({ ok: false, error: `Failed to send email: ${emailResult.error}` }, 500);
  }

  // Log to customer_email_logs
  await serviceClient.from('customer_email_logs').insert({
    customer_id: order.user_id,
    customer_email: customerEmail,
    subject: emailTemplate.subject,
    body: emailTemplate.html,
    sent_by: userId,
    status: 'sent',
  });

  console.log(`[order_assistance] ✅ Email sent to ${customerEmail} for order ${orderId}`);

  return jsonRes({
    ok: true,
    success: true,
    message: `Assistance email sent to ${customerEmail}`,
    language: validatedLanguage,
    emailId: emailResult.id,
  });
}

// ==================== Forwarding ====================

async function forwardToFunction(functionName: string, req: Request, overrideBody?: unknown): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return jsonRes({ ok: false, error: 'SUPABASE_URL not configured' }, 500);
  }

  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}`;

  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) headers.set('Authorization', authHeader);
  headers.set('Content-Type', 'application/json');

  for (const h of ['x-device-id', 'user-agent', 'x-client-info', 'x-cron-secret']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  headers.set('apikey', anonKey);

  const fetchOpts: RequestInit = {
    method: 'POST',
    headers,
  };

  if (overrideBody !== undefined) {
    fetchOpts.body = JSON.stringify(overrideBody);
  }

  const response = await fetch(targetUrl, fetchOpts);
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ==================== Main Handler ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonRes({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const emailType = body?.type;

    if (!emailType) {
      return jsonRes({ ok: false, error: 'Missing type field. Expected one of: ' + Object.keys(TYPE_TO_FUNCTION).join(', ') }, 400);
    }

    const targetFunction = TYPE_TO_FUNCTION[emailType];
    if (!targetFunction && !INLINE_TYPES.has(emailType)) {
      return jsonRes({ ok: false, error: `Unknown email type: ${emailType}` }, 400);
    }

    // Auth gate: require JWT or cron secret
    let authUserId: string | undefined;
    if (CRON_TYPES.has(emailType) && hasCronSecret(req)) {
      // Cron-authenticated — proceed
    } else {
      const authResult = await requireAuth(req);
      if (authResult instanceof Response) return authResult;
      authUserId = authResult.userId;
    }

    console.log(`[email-service] Handling type="${emailType}" userId=${authUserId || 'cron'}`);

    // Handle inline types
    if (emailType === 'order_assistance' && authUserId) {
      return handleOrderAssistance(body, authUserId);
    }

    // Forward to separate function
    const { type: _t, ...payload } = body;
    return forwardToFunction(targetFunction!, req, payload);
  } catch (err: any) {
    console.error('[email-service] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});
