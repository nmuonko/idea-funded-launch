import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    if (!email || email.trim() === '') {
      return new Response(
        JSON.stringify({ ok: false, verified: false, message: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-check-verified] Checking verification for:', email);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if user exists and email is verified
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (userError) {
      console.error('[auth-check-verified] Error listing users:', userError.message);
      return new Response(
        JSON.stringify({ ok: false, verified: false, message: 'Unable to check verification status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const users = userData?.users || [];
    const user = users.find((u: any) => u.email?.toLowerCase() === email.trim().toLowerCase());

    if (!user) {
      console.log('[auth-check-verified] User not found:', email);
      return new Response(
        JSON.stringify({ ok: false, verified: false, message: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isVerified = !!user.email_confirmed_at;
    console.log('[auth-check-verified] Verification status for', email, ':', isVerified);

    if (!isVerified) {
      return new Response(
        JSON.stringify({ 
          ok: true, 
          verified: false, 
          message: 'Email not yet verified. Please check your inbox and click the verification link.' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Email is verified - if password provided, attempt sign in
    if (password) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      );

      const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError || !sessionData?.session) {
        console.warn('[auth-check-verified] Sign in failed after verification:', signInError?.message);
        return new Response(
          JSON.stringify({ 
            ok: true, 
            verified: true, 
            signedIn: false,
            message: 'Email verified! Please sign in with your password.' 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch profile data
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('user_id', sessionData.user.id)
        .single();

      console.log('[auth-check-verified] User signed in:', email);

      return new Response(
        JSON.stringify({ 
          ok: true, 
          verified: true,
          signedIn: true,
          message: 'Email verified and signed in successfully!',
          user: {
            id: sessionData.user.id,
            email: sessionData.user.email,
            fullName: profile?.full_name || sessionData.user.user_metadata?.full_name,
            phoneNumber: profile?.phone,
            addressLine1: profile?.address_line1,
            addressLine2: profile?.address_line2,
            city: profile?.city,
            stateOrProvince: profile?.state_province || profile?.province,
            postalCode: profile?.postal_code,
            country: profile?.country,
          },
          token: sessionData.session.access_token,
          refreshToken: sessionData.session.refresh_token,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Just return verification status without sign in
    return new Response(
      JSON.stringify({ 
        ok: true, 
        verified: true,
        signedIn: false,
        message: 'Email verified! You can now sign in.' 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[auth-check-verified] Error:', error.message);
    return new Response(
      JSON.stringify({ ok: false, verified: false, message: 'Unable to check verification status' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
