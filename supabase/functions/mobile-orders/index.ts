/**
 * mobile-orders — Consolidated Orders Function
 * 
 * Routes by `action` field in POST body:
 *   create, list, get_by_id, status
 * 
 * AUTH: All actions require a valid JWT (via getClaims).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

  // Auth gate: all order actions require authentication
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  try {
    const url = new URL(req.url);
    let action = 'list';
    let body: any = {};

    if (req.method === 'GET') {
      action = url.searchParams.get('action') || 'list';
    } else {
      try {
        body = await req.json();
        action = body.action || 'create';
      } catch {
        return jsonRes({ ok: false, error: 'Invalid JSON body' }, 400);
      }
    }

    console.log(`[mobile-orders] action=${action}`);

    switch (action) {
      case 'create': {
        const { action: _a, ...createBody } = body;
        return forwardToFunction('mobile-create-order-from-cart', req, createBody);
      }

      case 'list': {
        const page = url.searchParams.get('page') || '1';
        const pageSize = url.searchParams.get('pageSize') || '20';
        return forwardToFunction(`mobile-get-orders?page=${page}&pageSize=${pageSize}`, req);
      }

      case 'get_by_id': {
        const orderId = body.order_id || body.orderId || url.searchParams.get('id') || url.searchParams.get('orderId');
        if (!orderId) return jsonRes({ ok: false, error: 'order_id required' }, 400);
        return forwardToFunction(`mobile-get-order-by-id?id=${orderId}`, req);
      }

      case 'status': {
        const orderId = body.order_id || body.orderId || url.searchParams.get('order_id') || url.searchParams.get('orderId');
        if (!orderId) return jsonRes({ ok: false, error: 'order_id required' }, 400);
        return forwardToFunction(`mobile-order-status?order_id=${orderId}`, req);
      }

      default:
        return jsonRes({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mobile-orders] Error:', msg);
    return jsonRes({ ok: false, error: msg }, 500);
  }
});
