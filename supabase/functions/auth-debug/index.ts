import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

/**
 * Auth Debug Endpoint
 * 
 * Returns environment configuration info to help diagnose
 * mobile vs web authentication mismatches.
 * 
 * GET /auth-debug - Returns Supabase project info (safe to expose)
 * POST /auth-debug - Tests if an email exists in the system
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-afrishop-platform, x-afrishop-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  
  // Extract project reference from URL
  const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
  const anonKeyPrefix = supabaseAnonKey.substring(0, 20);

  // GET - Return environment info
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        environment: {
          supabase_url_host: supabaseUrl.replace('https://', '').split('/')[0],
          project_ref: projectRef,
          anon_key_prefix: anonKeyPrefix + '...',
          // These should match between web and mobile
          expected_url: 'igmkhxffnyzoogcqvdab.supabase.co',
          matches_expected: projectRef === 'igmkhxffnyzoogcqvdab',
        },
        auth_config: {
          signup_enabled: true,
          email_confirmations: true,
          password_min_length: 6,
        },
        mobile_config: {
          recommended_supabase_url: 'https://igmkhxffnyzoogcqvdab.supabase.co',
          recommended_anon_key_prefix: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          auth_method: 'supabase.auth.signInWithPassword',
          session_storage: 'SecureStore or AsyncStorage',
        },
        endpoints: {
          login: '/functions/v1/auth-login',
          register: '/functions/v1/auth-register',
          verify_session: '/functions/v1/auth-me',
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // POST - Check if email exists (for debugging)
  if (req.method === 'POST') {
    try {
      const { email, check_type } = await req.json();
      
      if (!email) {
        return new Response(
          JSON.stringify({ error: 'Email required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const normalizedEmail = email.trim().toLowerCase();
      
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      
      // Check profiles table for email
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, email, created_at')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (profileError && !profileError.message.includes('No rows')) {
        console.error('[auth-debug] Profile query error:', profileError);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          email_checked: normalizedEmail.substring(0, 3) + '***@' + normalizedEmail.split('@')[1],
          email_normalized: normalizedEmail !== email,
          profile_exists: !!profile,
          profile_created_at: profile?.created_at || null,
          // Guidance for debugging
          if_login_fails: {
            check_1: 'Verify email is entered exactly as registered',
            check_2: 'Password is case-sensitive - check caps lock',
            check_3: 'Try resetting password via forgot password flow',
            check_4: 'Ensure app uses correct Supabase URL/Key',
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
  }

  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
