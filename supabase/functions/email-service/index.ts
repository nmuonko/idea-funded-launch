/**
 * email-service — Consolidated Email Service
 * 
 * Single entry point for all email/notification sending.
 * Routes by `type` field in POST body to the appropriate send-* function.
 * 
 * TEMPORARY: Forwards to original individual send-* functions to avoid
 * duplicating template logic and email infrastructure code.
 * 
 * Supported types:
 *   order_email, customer_email, order_confirmation, confirmation_email,
 *   payment_confirmation, order_processing, order_ready, order_shipped,
 *   order_delivered, delivery_notification, shipping_notification, shipping_update,
 *   cart_reminder, abandoned_cart, abandoned_cart_recovery,
 *   quote_email, quote_response, ticket_notification, feedback,
 *   fraud_alert, admin_payment_notification, application_email,
 *   order_assistance, test_email, push_notification
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Map email type to original function name
 */
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

  // Push notifications (not email but same pattern)
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

  for (const h of ['x-device-id', 'user-agent', 'x-client-info']) {
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

    console.log(`[email-service] Routing type="${emailType}" → ${targetFunction}`);

    // Forward the body without the 'type' field
    const { type: _t, ...payload } = body;
    return forwardToFunction(targetFunction, req, payload);
  } catch (err: any) {
    console.error('[email-service] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});
