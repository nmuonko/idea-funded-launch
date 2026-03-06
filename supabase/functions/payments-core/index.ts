/**
 * payments-core — Consolidated Payment Core Function
 * 
 * Routes by `action` field in POST body:
 *   create_intent, check_intent, verify, status, decision, retry, reconcile, receipt
 * 
 * AUTH: All actions require a valid JWT (via getClaims).
 * Exception: reconcile may be called by cron with x-cron-secret.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/**
 * Allow cron jobs to authenticate via x-cron-secret header instead of JWT.
 */
function hasCronSecret(req: Request): boolean {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');
  return !!(cronSecret && expected && cronSecret === expected);
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

  for (const h of ['x-device-id', 'user-agent', 'x-client-info', 'x-cron-secret']) {
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

async function forwardGetToFunction(functionName: string, req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return jsonRes({ ok: false, error: 'SUPABASE_URL not configured' }, 500);
  }

  const originalUrl = new URL(req.url);
  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}?${originalUrl.searchParams.toString()}`;

  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) headers.set('Authorization', authHeader);
  headers.set('Content-Type', 'application/json');

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  headers.set('apikey', anonKey);

  const response = await fetch(targetUrl, { method: 'GET', headers });
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Actions that can be called by cron (with x-cron-secret) instead of JWT
const CRON_ACTIONS = new Set(['reconcile']);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Determine action early to check if it's a cron-allowed action
    let action = '';

    if (req.method === 'GET') {
      const url = new URL(req.url);
      action = url.searchParams.get('action') || 'status';
    }

    // For POST, we need to peek at the body for the action
    let body: any = null;
    if (req.method === 'POST') {
      const clonedReq = req.clone();
      try {
        body = await clonedReq.json();
      } catch {
        return jsonRes({ ok: false, error: 'Invalid JSON body' }, 400);
      }
      action = body?.action || '';
      if (!action) {
        return jsonRes({ ok: false, error: 'Missing action field' }, 400);
      }
    }

    // Auth gate: require JWT or cron secret
    if (CRON_ACTIONS.has(action) && hasCronSecret(req)) {
      // Cron-authenticated — proceed
    } else {
      const authResult = await requireAuth(req);
      if (authResult instanceof Response) return authResult;
    }

    // Route GET requests
    if (req.method === 'GET') {
      switch (action) {
        case 'status':
          return forwardGetToFunction('payment-status', req);
        case 'check_intent':
          return forwardGetToFunction('payments-check-intent', req);
        default:
          return jsonRes({ ok: false, error: `Unknown GET action: ${action}` }, 400);
      }
    }

    // Route POST requests
    switch (action) {
      case 'create_intent': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('payments-create-intent', req, rest);
      }
      case 'check_intent': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('payments-check-intent', req, rest);
      }
      case 'verify': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('mobile-verify-payment', req, rest);
      }
      case 'admin_verify': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('verify-payment', req, rest);
      }
      case 'status': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('payment-status', req, rest);
      }
      case 'decision': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('payment-decision', req, rest);
      }
      case 'retry': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('mobile-retry-payment', req, rest);
      }
      case 'reconcile': {
        return forwardToFunction('reconcile-payment-status', req, body);
      }
      case 'receipt': {
        const { action: _a, ...rest } = body;
        return forwardToFunction('generate-payment-receipt', req, rest);
      }
      default:
        return jsonRes({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error('[payments-core] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});
