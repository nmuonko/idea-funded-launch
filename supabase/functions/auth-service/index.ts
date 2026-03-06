/**
 * auth-service — Consolidated Auth & Profile Function
 * 
 * Routes by `action` field in POST body:
 *   register, login, me, check_verified, resend_verification,
 *   get_profile, update_profile
 * 
 * TEMPORARY: This function proxies to the original individual functions
 * via internal fetch to avoid duplicating battle-tested code.
 * Once frontend + mobile are fully migrated, old functions will be inlined.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Forward the request to an existing edge function by constructing 
 * a new internal fetch to the same Supabase functions endpoint.
 */
async function forwardToFunction(functionName: string, req: Request, overrideBody?: unknown): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return jsonRes({ ok: false, error: 'SUPABASE_URL not configured' }, 500);
  }

  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}`;
  
  // Build headers — forward auth and content-type
  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) headers.set('Authorization', authHeader);
  headers.set('Content-Type', 'application/json');
  
  // Forward device/platform headers
  for (const h of ['x-device-id', 'user-agent', 'x-client-info']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  
  // Use anon key for internal call
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  headers.set('apikey', anonKey);

  const fetchOpts: RequestInit = {
    method: overrideBody !== undefined ? 'POST' : req.method,
    headers,
  };

  if (overrideBody !== undefined) {
    fetchOpts.body = JSON.stringify(overrideBody);
  }

  try {
    const resp = await fetch(targetUrl, fetchOpts);
    const body = await resp.text();
    
    // Forward the response with CORS headers
    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set('Content-Type', resp.headers.get('Content-Type') || 'application/json');
    
    return new Response(body, {
      status: resp.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`[auth-service] forwardToFunction(${functionName}) error:`, err);
    return jsonRes({ ok: false, error: `Internal routing error: ${err.message}` }, 502);
  }
}

// Map action names to legacy function names
const ACTION_TO_FUNCTION: Record<string, string> = {
  register:             'auth-register',
  login:                'auth-login',
  me:                   'auth-me',
  check_verified:       'auth-check-verified',
  resend_verification:  'auth-resend-verification',
  get_profile:          'mobile-profile',
  update_profile:       'mobile-profile-update',
  update_profile_web:   'update-profile',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // GET requests default to 'me' action (get current user info)
    if (req.method === 'GET') {
      return forwardToFunction('auth-me', req);
    }

    const body = await req.json();
    const action = body.action;

    if (!action || typeof action !== 'string') {
      return jsonRes({
        ok: false,
        error: 'Missing or invalid "action" field. Supported: ' + Object.keys(ACTION_TO_FUNCTION).join(', '),
      }, 400);
    }

    const targetFunction = ACTION_TO_FUNCTION[action];
    if (!targetFunction) {
      return jsonRes({
        ok: false,
        error: `Unknown action "${action}". Supported: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
      }, 400);
    }

    console.log(`[auth-service] Routing action="${action}" -> ${targetFunction}`);

    // Strip the action field before forwarding
    const { action: _a, ...payload } = body;
    return forwardToFunction(targetFunction, req, payload);

  } catch (err) {
    console.error('[auth-service] Unhandled error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal server error' }, 500);
  }
});
