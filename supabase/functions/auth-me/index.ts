import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Read Authorization header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      console.log('[auth-me] Missing Authorization header');
      return new Response(
        JSON.stringify({ code: 401, message: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Extract Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      console.log('[auth-me] Invalid Authorization header format');
      return new Response(
        JSON.stringify({ code: 401, message: 'Invalid Authorization header format. Expected: Bearer <token>' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = parts[1];
    
    if (!accessToken || accessToken.length < 10) {
      console.log('[auth-me] Token is empty or too short');
      return new Response(
        JSON.stringify({ code: 401, message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-me] Processing request with token length:', accessToken.length);

    // 3. Create Supabase client with SERVICE_ROLE key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error('[auth-me] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({ code: 500, message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    });

    // 4. Verify JWT and get user using the token
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    
    if (userError) {
      const errorMsg = userError.message?.toLowerCase() || '';
      console.log('[auth-me] JWT verification failed:', userError.message);
      
      // Provide specific error messages to help mobile app handle different cases
      if (errorMsg.includes('expired') || errorMsg.includes('exp claim')) {
        return new Response(
          JSON.stringify({ 
            code: 401, 
            message: 'Token expired', 
            error: 'TOKEN_EXPIRED',
            hint: 'Refresh the token using supabase.auth.refreshSession()' 
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (errorMsg.includes('invalid') || errorMsg.includes('malformed')) {
        return new Response(
          JSON.stringify({ 
            code: 401, 
            message: 'Invalid JWT', 
            error: 'INVALID_TOKEN',
            hint: 'Re-authenticate with supabase.auth.signInWithPassword()' 
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          code: 401, 
          message: 'Invalid JWT', 
          error: 'AUTH_ERROR',
          detail: userError.message 
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!user) {
      console.log('[auth-me] No user found for token');
      return new Response(
        JSON.stringify({ code: 401, message: 'Invalid JWT - no user found', error: 'USER_NOT_FOUND' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-me] User authenticated:', user.email);

    // 5. Fetch user profile using service role (bypasses RLS)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, user_id, name, phone, full_name, created_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.warn('[auth-me] Profile fetch warning:', profileError.message);
      // Don't fail the request if profile doesn't exist
    }

    // 6. Return success response
    const response = {
      user: {
        id: user.id,
        email: user.email,
        email_confirmed_at: user.email_confirmed_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      profile: profile ? {
        id: profile.id,
        user_id: profile.user_id,
        name: profile.name || profile.full_name,
        phone: profile.phone,
        full_name: profile.full_name,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      } : null,
    };

    console.log('[auth-me] Success - returning user data for:', user.email);

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    // Never leak internal errors - always return structured JSON
    console.error('[auth-me] Unexpected error:', error.message);
    return new Response(
      JSON.stringify({ code: 500, message: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
