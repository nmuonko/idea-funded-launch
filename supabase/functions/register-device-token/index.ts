import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { deviceToken, platform } = await req.json();

    if (!deviceToken || !platform) {
      return new Response(JSON.stringify({ error: 'Missing deviceToken or platform' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (platform !== 'ios' && platform !== 'android') {
      return new Response(JSON.stringify({ error: 'Platform must be ios or android' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[register-device-token] Registering token for user:', user.id, 'platform:', platform);

    // Upsert device token
    const { data, error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: user.id,
        device_token: deviceToken,
        platform: platform,
        last_used_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,device_token'
      })
      .select()
      .single();

    if (error) {
      console.error('[register-device-token] Error upserting token:', error);
      throw error;
    }

    console.log('[register-device-token] Token registered successfully:', data.id);

    return new Response(JSON.stringify({ 
      success: true,
      tokenId: data.id
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[register-device-token] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
