import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateRefCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 7; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { full_name, email, phone } = await req.json();

    if (!full_name || !email || !phone) {
      return new Response(JSON.stringify({ ok: false, message: 'full_name, email, and phone are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if email already exists
    const { data: existing } = await supabaseAdmin
      .from('referrers')
      .select('ref_code')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      const share_url = `https://afrishop-usa.com/get?ref=${existing.ref_code}`;
      return new Response(JSON.stringify({ ok: true, ref_code: existing.ref_code, share_url, existing: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate unique ref_code with retry
    let ref_code = generateRefCode();
    let attempts = 0;
    while (attempts < 5) {
      const { data: clash } = await supabaseAdmin
        .from('referrers')
        .select('id')
        .eq('ref_code', ref_code)
        .maybeSingle();
      if (!clash) break;
      ref_code = generateRefCode();
      attempts++;
    }

    const { data: created, error } = await supabaseAdmin
      .from('referrers')
      .insert({
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        ref_code,
      })
      .select('ref_code')
      .single();

    if (error) {
      console.error('[create-referrer] Insert error:', error);
      return new Response(JSON.stringify({ ok: false, message: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const share_url = `https://afrishop-usa.com/get?ref=${created.ref_code}`;
    console.log('[create-referrer] Created referrer:', created.ref_code);

    return new Response(JSON.stringify({ ok: true, ref_code: created.ref_code, share_url, existing: false }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[create-referrer] Error:', error.message);
    return new Response(JSON.stringify({ ok: false, message: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
