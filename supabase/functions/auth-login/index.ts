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
    const { email, password } = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'Email and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('[auth-login] Auth error:', error.message);
      
      // Return clean, user-friendly error messages
      let errorMessage = 'Invalid email or password.';
      let errorCode = 'INVALID_CREDENTIALS';
      
      if (error.message.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password.';
        errorCode = 'INVALID_CREDENTIALS';
      } else if (error.message.includes('Email not confirmed')) {
        errorMessage = 'Please verify your email address before logging in.';
        errorCode = 'EMAIL_NOT_VERIFIED';
      } else if (error.message.includes('Too many requests')) {
        errorMessage = 'Too many login attempts. Please try again later.';
        errorCode = 'RATE_LIMITED';
      }
      
      return new Response(
        JSON.stringify({ 
          success: false,
          error: errorMessage,
          code: errorCode,
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get profile - use maybeSingle to avoid errors if no profile or duplicates
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, phone, full_name')
      .eq('user_id', data.user.id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        user: {
          id: data.user.id,
          email: data.user.email,
          name: profile?.name || profile?.full_name || null,
          phone: profile?.phone || null,
        },
        token: data.session.access_token,
        // Session object for Quick Login (Face ID / fingerprint + PIN)
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
