/**
 * support-service — Consolidated Support/Chat Function
 * 
 * Routes by `action` field in POST body:
 *   start, chat_bot, notify_agent
 * 
 * TEMPORARY: Proxies to original individual functions.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

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
    console.error(`[support-service] forwardToFunction(${functionName}) error:`, err);
    return jsonRes({ ok: false, error: `Internal routing error: ${err.message}` }, 502);
  }
}

const ACTION_TO_FUNCTION: Record<string, string> = {
  start:        'support-start',
  chat_bot:     'support-chat-bot',
  notify_agent: 'notify-support-agent',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    console.log(`[support-service] Routing action="${action}" -> ${targetFunction}`);

    const { action: _a, ...payload } = body;
    return forwardToFunction(targetFunction, req, payload);

  } catch (err) {
    console.error('[support-service] Unhandled error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal server error' }, 500);
  }
});
