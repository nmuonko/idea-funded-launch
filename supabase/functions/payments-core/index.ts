/**
 * payments-core — Consolidated Payment Core Function
 * 
 * Routes by `action` field in POST body:
 *   create_intent, check_intent, verify, status, decision, retry, reconcile, receipt
 * 
 * TEMPORARY: Forwards to original individual functions to avoid duplicating
 * thousands of lines of battle-tested payment logic.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

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

/**
 * Forward GET request with query params preserved
 */
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // For GET requests, check query param 'action' or default to 'status'
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action') || 'status';
      
      switch (action) {
        case 'status':
          return forwardGetToFunction('payment-status', req);
        case 'check_intent':
          return forwardGetToFunction('payments-check-intent', req);
        default:
          return jsonRes({ ok: false, error: `Unknown GET action: ${action}` }, 400);
      }
    }

    // POST requests — parse body for action
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
