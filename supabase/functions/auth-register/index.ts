/**
 * auth-register — Compatibility endpoint for mobile app
 * 
 * The mobile app calls POST /functions/v1/auth-register
 * This function proxies to auth-service with action=register,
 * preserving the exact response shape the mobile app expects.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('[auth-register] Proxying to auth-service action=register, email:', body.email);

    // Forward to auth-service with action=register
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const proxyBody = { ...body, action: 'register' };

    const resp = await fetch(`${supabaseUrl}/functions/v1/auth-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': req.headers.get('Authorization') || `Bearer ${anonKey}`,
        'User-Agent': req.headers.get('User-Agent') || '',
      },
      body: JSON.stringify(proxyBody),
    });

    const data = await resp.json();
    console.log('[auth-register] auth-service responded:', resp.status, 'success:', data.success ?? data.ok);

    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[auth-register] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      ok: false,
      error: 'Internal server error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
