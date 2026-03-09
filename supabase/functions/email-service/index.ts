/**
 * email-service — Consolidated Email Service
 * 
 * Single entry point for all email/notification sending.
 * Routes by `type` field in POST body to the appropriate send-* function.
 * 
 * AUTH: All actions require a valid JWT (via getClaims) or cron secret.
 * Exception: cart_reminder and abandoned_cart may be triggered by cron.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

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
    if (!targetFunction) {
      return jsonRes({ ok: false, error: `Unknown email type: ${emailType}. Expected one of: ${Object.keys(TYPE_TO_FUNCTION).join(', ')}` }, 400);
    }

    // Auth gate: require JWT or cron secret
    if (CRON_TYPES.has(emailType) && hasCronSecret(req)) {
      // Cron-authenticated — proceed
    } else {
      const authResult = await requireAuth(req);
      if (authResult instanceof Response) return authResult;
    }

    console.log(`[email-service] Routing type="${emailType}" → ${targetFunction}`);

    const { type: _t, ...payload } = body;
    return forwardToFunction(targetFunction, req, payload);
  } catch (err: any) {
    console.error('[email-service] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});
