/**
 * admin-service — Consolidated Admin Function
 * 
 * Routes by `action` field in POST body:
 *   order_action, delete_order, bulk_delete_orders, update_item_status,
 *   invite_user, system_health, get_carts, ai_assistant, reset_section,
 *   catalog_settings
 * 
 * AUTH: All actions require a valid JWT (via getClaims).
 * No public actions — this is an admin-only endpoint.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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

async function forwardToFunction(functionName: string, req: Request, overrideBody?: unknown, overrideMethod?: string): Promise<Response> {
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

  const method = overrideMethod || (overrideBody !== undefined ? 'POST' : req.method);
  const fetchOpts: RequestInit = { method, headers };

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
    console.error(`[admin-service] forwardToFunction(${functionName}) error:`, err);
    return jsonRes({ ok: false, error: `Internal routing error: ${err.message}` }, 502);
  }
}

const ACTION_TO_FUNCTION: Record<string, string> = {
  order_action:        'admin-order-action',
  delete_order:        'admin-delete-order',
  bulk_delete_orders:  'admin-bulk-delete-orders',
  update_item_status:  'admin-update-item-status',
  invite_user:         'admin-invite-user',
  system_health:       'admin-system-health',
  get_carts:           'admin-get-carts',
  ai_assistant:        'admin-ai-assistant',
  reset_section:       'admin-reset-section',
  catalog_settings:    'admin-catalog-settings',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth gate: ALL admin actions require authentication
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  try {
    // GET requests default to system_health
    if (req.method === 'GET') {
      return forwardToFunction('admin-system-health', req);
    }

    const body = await req.json();
    const action = body.action;

    if (!action || typeof action !== 'string') {
      return jsonRes({
        ok: false,
        error: 'Missing "action" field. Supported: ' + Object.keys(ACTION_TO_FUNCTION).join(', '),
      }, 400);
    }

    const targetFunction = ACTION_TO_FUNCTION[action];
    if (!targetFunction) {
      return jsonRes({
        ok: false,
        error: `Unknown action "${action}". Supported: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
      }, 400);
    }

    console.log(`[admin-service] Routing action="${action}" -> ${targetFunction}`);

    const { action: _a, method: overrideMethod, ...payload } = body;
    return forwardToFunction(targetFunction, req, payload, overrideMethod);

  } catch (err) {
    console.error('[admin-service] Unhandled error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal server error' }, 500);
  }
});
