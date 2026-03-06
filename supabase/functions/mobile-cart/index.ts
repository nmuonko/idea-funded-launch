/**
 * mobile-cart — Consolidated Cart Function
 * 
 * Routes by `action` field in POST body:
 *   get_cart, add_item, update_item, delete_item, sync, merge_guest, guest_snapshot
 * 
 * GET requests default to get_cart action.
 * 
 * AUTH: All actions require a valid JWT (via getClaims).
 * Exception: guest_snapshot is allowed without auth (guest users).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

// Actions that do NOT require authentication
const PUBLIC_ACTIONS = new Set(['guest_snapshot']);

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Validate JWT and return user ID. Returns null if invalid.
 */
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
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let action = 'get_cart';
    let body: any = {};

    if (req.method === 'GET') {
      action = 'get_cart';
    } else {
      try {
        body = await req.json();
        action = body.action || 'get_cart';
      } catch {
        return jsonRes({ ok: false, error: 'Invalid JSON body' }, 400);
      }
    }

    // Auth gate: require JWT for non-public actions
    if (!PUBLIC_ACTIONS.has(action)) {
      const authResult = await requireAuth(req);
      if (authResult instanceof Response) return authResult;
    }

    console.log(`[mobile-cart] action=${action}`);

    switch (action) {
      case 'get_cart':
        return forwardToFunction('mobile-get-cart', req);

      case 'add_item': {
        const { action: _a, ...addBody } = body;
        return forwardToFunction('mobile-add-cart-item', req, addBody);
      }

      case 'update_item': {
        const { action: _u, item_id, itemId, ...updateBody } = body;
        const id = item_id || itemId;
        if (!id) return jsonRes({ ok: false, error: 'item_id required' }, 400);
        return forwardToFunction(`mobile-update-cart-item/${id}`, req, updateBody);
      }

      case 'delete_item': {
        const { action: _d, item_id: delId, itemId: delId2, cart_item_id } = body;
        const deleteItemId = delId || delId2 || cart_item_id;
        if (!deleteItemId) return jsonRes({ ok: false, error: 'item_id required' }, 400);
        return forwardToFunction(`mobile-delete-cart-item/${deleteItemId}`, req);
      }

      case 'sync': {
        const { action: _s, ...syncBody } = body;
        return forwardToFunction('cart-sync-from-client', req, syncBody);
      }

      case 'merge_guest': {
        const { action: _m, ...mergeBody } = body;
        return forwardToFunction('merge-guest-cart', req, mergeBody);
      }

      case 'guest_snapshot': {
        const { action: _g, ...snapshotBody } = body;
        return forwardToFunction('cart-guest-snapshot', req, snapshotBody);
      }

      default:
        return jsonRes({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mobile-cart] Error:', msg);
    return jsonRes({ ok: false, error: msg }, 500);
  }
});
