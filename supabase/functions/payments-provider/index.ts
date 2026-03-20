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
import {
  extractRequestToken,
  verifyAndGetUser,
  authErrorResponse,
  buildForwardHeaders,
  extractDownstreamAuthFailure,
  getRequestAuthDiagnostics,
  normalizeAuthErrorCode,
} from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id, x-auth-token, x-session-token, x-access-token, x-jwt, x-supabase-auth, X-Afrishop-Environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function requireAuth(req: Request, actionHint: string): Promise<{ userId: string; token: string | null; tokenSource: string | null } | Response> {
  const { token, source: tokenSource } = await extractRequestToken(req);
  const authDiagnostics = getRequestAuthDiagnostics(req, token, tokenSource);

  console.log('[payments-provider] auth-check', {
    action: actionHint,
    ...authDiagnostics,
  });

  if (!token) {
    console.warn('[payments-provider] auth-failed', { action: actionHint, errorCode: 'NO_TOKEN', ...authDiagnostics });
    return authErrorResponse('NO_TOKEN', 'No authentication token found. Please sign in.', { action: actionHint });
  }

  try {
    const { user } = await verifyAndGetUser(req, undefined, { token, source: tokenSource });
    console.log('[payments-provider] auth-ok', {
      action: actionHint,
      tokenSource: authDiagnostics.tokenSource,
      hasAuthorizationHeader: authDiagnostics.hasAuthorizationHeader,
      hasExtractedToken: authDiagnostics.hasExtractedToken,
      userId: user.id.slice(0, 8) + '***',
    });
    return { userId: user.id, token, tokenSource };
  } catch (error: any) {
    const errorCode = normalizeAuthErrorCode(error) || 'INVALID_TOKEN';
    console.warn('[payments-provider] auth-failed', {
      action: actionHint,
      ...authDiagnostics,
      errorCode,
      reason: error instanceof Error ? error.message : String(error),
    });
    return authErrorResponse(errorCode, undefined, { action: actionHint });
  }
}

async function forwardToFunction(functionName: string, req: Request, token: string | null, action: string, overrideBody?: unknown): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return jsonRes({ ok: false, error: 'SUPABASE_URL not configured' }, 200);
  }

  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}`;
  const headers = buildForwardHeaders(req, token, { includeApiKey: true, contentType: 'application/json' });

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
  const authFailure = extractDownstreamAuthFailure(response.status, responseBody);

  console.log('[payments-provider] downstream-response', {
    action,
    downstreamFunction: functionName,
    downstreamStatusCode: response.status,
  });

  if (authFailure) {
    return authErrorResponse(authFailure.errorCode, authFailure.message, {
      action,
      downstream_function: functionName,
      downstream_status_code: response.status,
    });
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
        return jsonRes({ ok: false, error: 'Invalid JSON body' }, 200);
      }
      actionHint = body?.action || 'unknown';
    }

    const authResult = await requireAuth(req, actionHint);
    if (authResult instanceof Response) return authResult;

    if (req.method === 'GET') {
      console.log('[payments-provider] forward', { action: actionHint, downstreamFunction: 'get-payment-providers' });
      return forwardToFunction('get-payment-providers', req, authResult.token, actionHint);
    }

    const action = body?.action;
    if (!action) {
      return jsonRes({ ok: false, error: 'Missing action field' }, 200);
    }

    switch (action) {
      case 'select': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'select-payment-provider' });
        return forwardToFunction('select-payment-provider', req, authResult.token, action, rest);
      }
      case 'get_providers': {
        console.log('[payments-provider] forward', { action, downstreamFunction: 'get-payment-providers' });
        return forwardToFunction('get-payment-providers', req, authResult.token, action);
      }
      case 'update_provider': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'update-payment-provider' });
        return forwardToFunction('update-payment-provider', req, authResult.token, action, rest);
      }
      case 'set_active': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'admin-set-active-provider' });
        return forwardToFunction('admin-set-active-provider', req, authResult.token, action, rest);
      }
      case 'test_provider': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'admin-test-provider' });
        return forwardToFunction('admin-test-provider', req, authResult.token, action, rest);
      }
      case 'pawapay_create': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'pawapay-create-payment' });
        return forwardToFunction('pawapay-create-payment', req, authResult.token, action, rest);
      }
      case 'pawapay_verify': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'pawapay-verify-payment' });
        return forwardToFunction('pawapay-verify-payment', req, authResult.token, action, rest);
      }
      case 'stripe_create_session': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'stripe-create-checkout-session' });
        return forwardToFunction('stripe-create-checkout-session', req, authResult.token, action, rest);
      }
      case 'stripe_verify_session': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'stripe-verify-checkout-session' });
        return forwardToFunction('stripe-verify-checkout-session', req, authResult.token, action, rest);
      }
      case 'create_payment': {
        const { action: _a, ...rest } = body;
        console.log('[payments-provider] forward', { action, downstreamFunction: 'mobile-create-payment' });
        return forwardToFunction('mobile-create-payment', req, authResult.token, action, rest);
      }
      default:
        return jsonRes({ ok: false, error: `Unknown action: ${action}` }, 200);
    }
  } catch (err: any) {
    console.error('[payments-provider] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});