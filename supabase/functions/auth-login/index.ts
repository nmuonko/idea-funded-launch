import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-afrishop-platform, x-afrishop-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Get platform info from headers for debugging
  const platform = req.headers.get('x-afrishop-platform') || 'unknown';
  const version = req.headers.get('x-afrishop-version') || 'unknown';
  const traceId = crypto.randomUUID().slice(0, 8);

  try {
    const body = await req.json();
    
    // Accept multiple field names for compatibility
    // Mobile may send: email, emailAddress, or username
    const rawEmail = body.email || body.emailAddress || body.username || '';
    const rawPassword = body.password || '';
    
    // IMPORTANT: Only trim and lowercase email, NEVER modify password
    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword; // Keep password exactly as-is (case-sensitive)

    console.log(`[auth-login][${traceId}] platform=${platform} version=${version} email=${email.substring(0, 3)}***`);

    if (!email || !password) {
      console.log(`[auth-login][${traceId}] FAIL: missing_fields email=${!!email} password=${!!password}`);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Email and password are required',
          error_fr: 'Email et mot de passe requis',
          code: 'MISSING_FIELDS',
          trace_id: traceId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log(`[auth-login][${traceId}] FAIL: invalid_email_format`);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Invalid email format',
          error_fr: 'Format d\'email invalide',
          code: 'INVALID_EMAIL_FORMAT',
          trace_id: traceId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error(`[auth-login][${traceId}] FATAL: missing_supabase_config`);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Server configuration error',
          error_fr: 'Erreur de configuration serveur',
          code: 'CONFIG_ERROR',
          trace_id: traceId,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log Supabase project info for debugging (first 8 chars of URL hash)
    const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
    console.log(`[auth-login][${traceId}] supabase_project=${projectRef.substring(0, 8)}...`);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    console.log(`[auth-login][${traceId}] calling signInWithPassword...`);
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error(`[auth-login][${traceId}] AUTH_FAIL: ${error.message} status=${error.status}`);
      
      // Map error messages to user-friendly versions
      let errorMessage = 'Invalid email or password.';
      let errorMessageFr = 'Email ou mot de passe incorrect.';
      let errorCode = 'INVALID_CREDENTIALS';
      
      if (error.message.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password.';
        errorMessageFr = 'Email ou mot de passe incorrect.';
        errorCode = 'INVALID_CREDENTIALS';
      } else if (error.message.includes('Email not confirmed')) {
        errorMessage = 'Please verify your email address before logging in.';
        errorMessageFr = 'Veuillez vérifier votre adresse email avant de vous connecter.';
        errorCode = 'EMAIL_NOT_VERIFIED';
      } else if (error.message.includes('Too many requests')) {
        errorMessage = 'Too many login attempts. Please try again later.';
        errorMessageFr = 'Trop de tentatives. Réessayez plus tard.';
        errorCode = 'RATE_LIMITED';
      } else if (error.message.includes('User not found')) {
        errorMessage = 'No account found with this email.';
        errorMessageFr = 'Aucun compte trouvé avec cet email.';
        errorCode = 'USER_NOT_FOUND';
      }
      
      return new Response(
        JSON.stringify({ 
          success: false,
          error: errorMessage,
          error_fr: errorMessageFr,
          code: errorCode,
          trace_id: traceId,
          // Include debug info for mobile team
          debug: {
            supabase_error: error.message,
            supabase_status: error.status,
            email_received: email.substring(0, 3) + '***@' + email.split('@')[1],
          }
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[auth-login][${traceId}] SUCCESS: userId=${data.user.id}`);

    // Get profile data
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, phone, full_name, avatar_url, country, city, language')
      .eq('user_id', data.user.id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: data.user.id,
          email: data.user.email,
          name: profile?.name || profile?.full_name || null,
          full_name: profile?.full_name || profile?.name || null,
          phone: profile?.phone || null,
          avatar_url: profile?.avatar_url || null,
          country: profile?.country || null,
          city: profile?.city || null,
          language: profile?.language || 'fr',
          email_verified: !!data.user.email_confirmed_at,
        },
        token: data.session.access_token,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in,
          token_type: data.session.token_type,
        },
        trace_id: traceId,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error(`[auth-login][${traceId}] EXCEPTION: ${error.message}`);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'An unexpected error occurred',
        error_fr: 'Une erreur inattendue s\'est produite',
        code: 'SERVER_ERROR',
        trace_id: traceId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
