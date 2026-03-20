/**
 * payments-provider — Consolidated Payment Provider Function
 *
 * Routes by `action` field in POST body:
 *   select, get_providers, update_provider, set_active, test_provider,
 *   pawapay_create, pawapay_verify, stripe_create_session, stripe_verify_session,
 *   create_payment
 *
 * AUTH: All actions require a valid JWT.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { extractRequestToken, verifyAndGetUser } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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
  const hasAuthorizationHeader = !!req.headers.get('Authorization');

  console.log('[payments-provider] auth-check', {
    action: actionHint,
    tokenSource: tokenSource || 'missing',
    hasAuthorizationHeader,
    hasExtractedToken: !!token,
  });

  if (!token) {
    console.warn('[payments-provider] auth-missing', { action: actionHint, hasAuthorizationHeader });
    return authFailureResponse('AUTH_REQUIRED', 'Authentication required.');
  }

  try {
    const { user } = await verifyAndGetUser(req, undefined, { token, source: tokenSource });
    console.log('[payments-provider] auth-ok', {
      action: actionHint,
      tokenSource: tokenSource || 'unknown',
      hasAuthorizationHeader,
      verifyUserSuccess: true,
      userId: user.id.slice(0, 8) + '***',
    });
    return { userId: user.id, token, tokenSource };
  } catch (error) {
    console.warn('[payments-provider] auth-failed', {
      action: actionHint,
      tokenSource: tokenSource || 'unknown',
      hasAuthorizationHeader,
      hasExtractedToken: !!token,
      verifyUserSuccess: false,
      reason: error instanceof Error ? error.message : String(error),
    });
    return authFailureResponse('AUTH_ERROR', 'Authentication failed. Please sign in again.');
  }
}

async function forwardToFunction(functionName: string, req: Request, token: string | null, action: string, overrideBody?: unknown): Promise<Response> {
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

  for (const h of ['x-device-id', 'user-agent', 'x-client-info', 'x-auth-token', 'x-session-token', 'x-access-token', 'x-jwt']) {
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

  console.log('[payments-provider] downstream-response', {
    action,
    functionName,
    downstreamStatusCode: response.status,
  });

  if (response.status === 401 || response.status === 403) {
    return authFailureResponse('AUTH_ERROR', 'Authentication failed. Please sign in again.');
  }

  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let actionHint = req.method === 'GET' ? 'get_providers' : 'unknown';
    let body: any = null;

    if (req.method !== 'GET') {
      const clonedReq = req.clone();
      try {
        body = await clonedReq.json();
      } catch {
        return jsonRes({ ok: false, error: 'Invalid JSON body' }, 400);
      }
      actionHint = body?.action || 'unknown';
    }

    const authResult = await requireAuth(req, actionHint);
    if (authResult instanceof Response) return authResult;

    if (req.method === 'GET') {
      console.log('[payments-provider] forward', { action: actionHint, functionName: 'get-payment-providers' });
      return forwardToFunction('get-payment-providers', req, authResult.token);
    }

    const action = body?.action;
    if (!action) {
      return jsonRes({ ok: false, error: 'Missing action field' }, 400);
    }

    switch (action) {
      case 'select': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'select-payment-provider' });
        return forwardToFunction('select-payment-provider', req, authResult.token, rest);
      }
      case 'get_providers': {
        console.log('[payments-provider] forward', { action, functionName: 'get-payment-providers' });
        return forwardToFunction('get-payment-providers', req, authResult.token);
      }
      case 'update_provider': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'update-payment-provider' });
        return forwardToFunction('update-payment-provider', req, authResult.token, rest);
      }
      case 'set_active': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'admin-set-active-provider' });
        return forwardToFunction('admin-set-active-provider', req, authResult.token, rest);
      }
      case 'test_provider': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'admin-test-provider' });
        return forwardToFunction('admin-test-provider', req, authResult.token, rest);
      }
      case 'pawapay_create': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'pawapay-create-payment' });
        return forwardToFunction('pawapay-create-payment', req, authResult.token, rest);
      }
      case 'pawapay_verify': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'pawapay-verify-payment' });
        return forwardToFunction('pawapay-verify-payment', req, authResult.token, rest);
      }
      case 'stripe_create_session': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'stripe-create-checkout-session' });
        return forwardToFunction('stripe-create-checkout-session', req, authResult.token, rest);
      }
      case 'stripe_verify_session': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'stripe-verify-checkout-session' });
        return forwardToFunction('stripe-verify-checkout-session', req, authResult.token, rest);
      }
      case 'create_payment': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, functionName: 'mobile-create-payment' });
        return forwardToFunction('mobile-create-payment', req, authResult.token, rest);
      }
      default:
        return jsonRes({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error('[payments-provider] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});