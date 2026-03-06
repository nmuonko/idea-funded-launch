/**
 * payments-provider — Consolidated Payment Provider Function
 * 
 * Routes by `action` field in POST body:
 *   select, get_providers, update_provider, set_active, test_provider,
 *   pawapay_create, pawapay_verify, stripe_create_session, stripe_verify_session,
 *   create_payment
 * 
 * AUTH: All actions require a valid JWT (via getClaims).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) {
    return jsonRes({ ok: false, error: 'Unauthorized: invalid token' }, 401);
  }

  return { userId: data.claims.sub as string };
}

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
    method: overrideBody !== undefined ? 'POST' : req.method,
    headers,
  };

  if (overrideBody !== undefined) {
    fetchOpts.body = JSON.stringify(overrideBody);
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      const body = await req.clone().text();
      if (body) fetchOpts.body = body;
    } catch { /* no body */ }
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

  // Auth gate: all provider actions require authentication
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  try {
    // GET requests forward to get-payment-providers
    if (req.method === 'GET') {
      return forwardToFunction('get-payment-providers', req);
    }

    const clonedReq = req.clone();
    let body: any;
    try {
      body = await clonedReq.json();
    } catch {
      return jsonRes({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const action = body?.action;
    if (!action) {
      return jsonRes({ ok: false, error: 'Missing action field' }, 400);
    }

    switch (action) {
      case 'select': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('select-payment-provider', req, rest);
      }
      case 'get_providers': {
        return forwardToFunction('get-payment-providers', req);
      }
      case 'update_provider': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('update-payment-provider', req, rest);
      }
      case 'set_active': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('admin-set-active-provider', req, rest);
      }
      case 'test_provider': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('admin-test-provider', req, rest);
      }
      case 'pawapay_create': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('pawapay-create-payment', req, rest);
      }
      case 'pawapay_verify': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('pawapay-verify-payment', req, rest);
      }
      case 'stripe_create_session': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('stripe-create-checkout-session', req, rest);
      }
      case 'stripe_verify_session': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('stripe-verify-checkout-session', req, rest);
      }
      case 'create_payment': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('mobile-create-payment', req, rest);
      }
      default:
        return jsonRes({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error('[payments-provider] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});
