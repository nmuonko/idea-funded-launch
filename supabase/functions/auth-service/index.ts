/**
 * auth-service — Consolidated Auth & Profile Function
 * 
 * Routes by `action` field in POST body:
 *   register, login, me, check_verified, resend_verification,
 *   get_profile, update_profile, update_profile_web
 * 
 * AUTH: Most actions require a valid JWT (via getClaims).
 * Exceptions: register and login are public (no auth required).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

// Actions that do NOT require authentication
const PUBLIC_ACTIONS = new Set(['register', 'login']);

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
  }

  try {
    const resp = await fetch(targetUrl, fetchOpts);
    const body = await resp.text();
    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set('Content-Type', resp.headers.get('Content-Type') || 'application/json');
    return new Response(body, { status: resp.status, headers: responseHeaders });
  } catch (err) {
    console.error(`[auth-service] forwardToFunction(${functionName}) error:`, err);
    return jsonRes({ ok: false, error: `Internal routing error: ${err.message}` }, 502);
  }
}

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // GET requests default to 'me' action (requires auth)
    if (req.method === 'GET') {
      const authResult = await requireAuth(req);
      if (authResult instanceof Response) return authResult;
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

    // Auth gate: require JWT for non-public actions
    if (!PUBLIC_ACTIONS.has(action)) {
      const authResult = await requireAuth(req);
      if (authResult instanceof Response) return authResult;
    }

    console.log(`[auth-service] Routing action="${action}" -> ${targetFunction}`);

    const { action: _a, ...payload } = body;
    return forwardToFunction(targetFunction, req, payload);

  } catch (err) {
    console.error('[auth-service] Unhandled error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal server error' }, 500);
  }
});
