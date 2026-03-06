/**
 * mobile-cart — Consolidated Cart Function
 * 
 * Routes by `action` field in POST body:
 *   get_cart, add_item, update_item, delete_item, sync, merge_guest, guest_snapshot
 * 
 * GET requests default to get_cart action.
 * 
 * TEMPORARY: This function re-exports logic from the original individual functions
 * via dynamic import to avoid duplicating 2000+ lines of battle-tested code.
 * Once frontend + mobile are fully migrated, old functions will be deleted.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  
  // Use service role key for internal call
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  headers.set('apikey', anonKey);

  const fetchOpts: RequestInit = {
    method: overrideBody !== undefined ? 'POST' : req.method,
    headers,
  };

  if (overrideBody !== undefined) {
    fetchOpts.body = JSON.stringify(overrideBody);
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Clone and forward body
    try {
      const body = await req.clone().text();
      if (body) fetchOpts.body = body;
    } catch { /* no body */ }
  }

  const response = await fetch(targetUrl, fetchOpts);
  
  // Forward the response with our CORS headers
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Determine action
    let action = 'get_cart'; // default
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

    console.log(`[mobile-cart] action=${action}`);

    // Route to the appropriate existing function
    switch (action) {
      case 'get_cart':
        return forwardToFunction('mobile-get-cart', req);

      case 'add_item':
        // Forward the body minus the action field
        const { action: _a, ...addBody } = body;
        return forwardToFunction('mobile-add-cart-item', req, addBody);

      case 'update_item': {
        const { action: _u, item_id, itemId, ...updateBody } = body;
        const id = item_id || itemId;
        if (!id) return jsonRes({ ok: false, error: 'item_id required' }, 400);
        // mobile-update-cart-item expects item ID in URL path, but also accepts body
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
