/**
 * payments-core — Consolidated Payment Core Function
 *
 * Routes by `action` field in POST body:
 *   create_intent, check_intent, verify, status, decision, retry, reconcile, receipt
 *
 * AUTH: All actions require a valid JWT.
 * Exception: reconcile may be called by cron with x-cron-secret.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { extractRequestToken, verifyAndGetUser } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function authFailureResponse(errorCode = 'AUTH_REQUIRED', message = 'Authentication required.') {
  return jsonRes({
    ok: false,
    success: false,
    authenticated: false,
    error: errorCode,
    error_code: errorCode,
    message,
  }, 200);
}

async function requireAuth(req: Request, actionHint: string): Promise<{ userId: string; token: string | null; tokenSource: string | null } | Response> {
  const { token, source: tokenSource } = await extractRequestToken(req);

  console.log('[payments-core] auth-check', {
    action: actionHint,
    hasToken: !!token,
    tokenSource: tokenSource || 'missing',
  });

  if (!token) {
    console.warn('[payments-core] auth-missing', { action: actionHint });
    return authFailureResponse('AUTH_REQUIRED', 'Authentication required.');
  }

  try {
    const { user } = await verifyAndGetUser(req);
    console.log('[payments-core] auth-ok', {
      action: actionHint,
      tokenSource: tokenSource || 'unknown',
      userId: user.id.slice(0, 8) + '***',
    });
    return { userId: user.id, token, tokenSource };
  } catch (error) {
    console.warn('[payments-core] auth-failed', {
      action: actionHint,
      tokenSource: tokenSource || 'unknown',
      reason: error instanceof Error ? error.message : String(error),
    });
    return authFailureResponse('AUTH_ERROR', 'Authentication failed. Please sign in again.');
  }
}

/**
 * Allow cron jobs to authenticate via x-cron-secret header instead of JWT.
 */
function hasCronSecret(req: Request): boolean {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');
  return !!(cronSecret && expected && cronSecret === expected);
}

async function forwardToFunction(functionName: string, req: Request, token: string | null, overrideBody?: unknown): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return jsonRes({ ok: false, error: 'SUPABASE_URL not configured' }, 500);
  }

  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}`;

  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    headers.set('Authorization', authHeader);
  } else if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Content-Type', 'application/json');

  for (const h of ['x-device-id', 'user-agent', 'x-client-info', 'x-cron-secret', 'x-auth-token', 'x-session-token', 'x-access-token', 'x-jwt']) {
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
    } catch {
      // no body
    }
  }

  const response = await fetch(targetUrl, fetchOpts);
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function forwardGetToFunction(functionName: string, req: Request, token: string | null): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return jsonRes({ ok: false, error: 'SUPABASE_URL not configured' }, 500);
  }

  const originalUrl = new URL(req.url);
  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}?${originalUrl.searchParams.toString()}`;

  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    headers.set('Authorization', authHeader);
  } else if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Content-Type', 'application/json');

  for (const h of ['x-client-info', 'x-cron-secret', 'x-auth-token', 'x-session-token', 'x-access-token', 'x-jwt']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  headers.set('apikey', anonKey);

  const response = await fetch(targetUrl, { method: 'GET', headers });
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const CRON_ACTIONS = new Set(['reconcile']);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let action = '';
    let body: any = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      action = url.searchParams.get('action') || 'status';
    }

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

    let authToken: string | null = null;

    if (CRON_ACTIONS.has(action) && hasCronSecret(req)) {
      console.log('[payments-core] cron-auth', { action });
    } else {
      const authResult = await requireAuth(req, action || 'unknown');
      if (authResult instanceof Response) return authResult;
      authToken = authResult.token;
    }

    if (req.method === 'GET') {
      switch (action) {
        case 'status':
          console.log('[payments-core] forward', { action, functionName: 'payment-status' });
          return forwardGetToFunction('payment-status', req, authToken);
        case 'check_intent':
          console.log('[payments-core] forward', { action, functionName: 'payments-check-intent' });
          return forwardGetToFunction('payments-check-intent', req, authToken);
        default:
          return jsonRes({ ok: false, error: `Unknown GET action: ${action}` }, 400);
      }
    }

    switch (action) {
      case 'create_intent': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'payments-create-intent' });
        return forwardToFunction('payments-create-intent', req, authToken, rest);
      }
      case 'check_intent': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'payments-check-intent' });
        return forwardToFunction('payments-check-intent', req, authToken, rest);
      }
      case 'verify': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'mobile-verify-payment' });
        return forwardToFunction('mobile-verify-payment', req, authToken, rest);
      }
      case 'admin_verify': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'verify-payment' });
        return forwardToFunction('verify-payment', req, authToken, rest);
      }
      case 'status': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'payment-status' });
        return forwardToFunction('payment-status', req, authToken, rest);
      }
      case 'decision': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'payment-decision' });
        return forwardToFunction('payment-decision', req, authToken, rest);
      }
      case 'retry': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'mobile-retry-payment' });
        return forwardToFunction('mobile-retry-payment', req, authToken, rest);
      }
      case 'reconcile': {
        console.log('[payments-core] forward', { action, functionName: 'reconcile-payment-status' });
        return forwardToFunction('reconcile-payment-status', req, authToken, body);
      }
      case 'receipt': {
        const { action: _a, ...rest } = body;
        console.log('[payments-core] forward', { action, functionName: 'generate-payment-receipt' });
        return forwardToFunction('generate-payment-receipt', req, authToken, rest);
      }
      default:
        return jsonRes({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error('[payments-core] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});