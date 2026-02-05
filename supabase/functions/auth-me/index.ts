import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// French-speaking African countries
const FRENCH_COUNTRIES = [
  'DR Congo', 'Congo-Brazzaville', 'Central African Republic', 'Cameroon',
  'Burundi', 'Rwanda', 'Benin', 'Ivory Coast', 'Senegal', 'Mali',
  'Chad', 'Niger', 'Gabon', 'Togo', 'Burkina Faso', 'Madagascar',
  'Guinea', 'Mauritius', 'Comoros', 'Djibouti', 'Seychelles'
];

// English-speaking African countries
const ENGLISH_COUNTRIES = [
  'Kenya', 'Uganda', 'Tanzania', 'Nigeria', 'Ghana', 'South Africa',
  'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Malawi', 'Liberia',
  'Sierra Leone', 'Gambia', 'Lesotho', 'Eswatini'
];

function getLanguageForCountry(country: string): string {
  if (FRENCH_COUNTRIES.includes(country)) return 'fr';
  if (ENGLISH_COUNTRIES.includes(country)) return 'en';
  return 'fr'; // Default to French
}

serve(async (req) => {
  const startTime = Date.now();
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Read Authorization header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - Missing auth header`);
      return new Response(
        JSON.stringify({ code: 401, message: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Extract Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - Invalid auth format`);
      return new Response(
        JSON.stringify({ code: 401, message: 'Invalid Authorization header format. Expected: Bearer <token>' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = parts[1];
    
    if (!accessToken || accessToken.length < 10) {
      console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - Token too short`);
      return new Response(
        JSON.stringify({ code: 401, message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Create Supabase client with SERVICE_ROLE key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error(`[auth-me] PERF duration=${Date.now() - startTime}ms - Missing env vars`);
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

    // 4. Verify JWT and get user
    const authStart = Date.now();
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    console.log(`[auth-me] Auth verification: ${Date.now() - authStart}ms`);
    
    if (userError) {
      const errorMsg = userError.message?.toLowerCase() || '';
      if (errorMsg.includes('expired') || errorMsg.includes('exp claim')) {
        console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - Token expired`);
        return new Response(
          JSON.stringify({ code: 401, message: 'Token expired', error: 'TOKEN_EXPIRED' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - Invalid JWT`);
      return new Response(
        JSON.stringify({ code: 401, message: 'Invalid JWT', error: 'INVALID_TOKEN' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!user) {
      console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - User not found`);
      return new Response(
        JSON.stringify({ code: 401, message: 'User not found', error: 'USER_NOT_FOUND' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Fetch user profile - SELECT ONLY REQUIRED COLUMNS
    const profileStart = Date.now();
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, email, full_name, phone, address, address_line1, country, province, state_province, language')
      .eq('user_id', user.id)
      .maybeSingle();
    console.log(`[auth-me] Profile fetch: ${Date.now() - profileStart}ms`);

    if (profileError) {
      console.error('[auth-me] Profile fetch error:', profileError);
    }

    // 6. If no profile exists, create one with defaults (non-blocking for response)
    if (!profile) {
      console.log('[auth-me] No profile found, creating default for user:', user.id);
      
      const defaultCountry = 'DR Congo';
      const defaultProvince = 'Kinshasa';
      const defaultLanguage = getLanguageForCountry(defaultCountry);
      
      const newProfile = {
        user_id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        phone: user.user_metadata?.phone || '',
        address: '',
        country: defaultCountry,
        province: defaultProvince,
        language: defaultLanguage,
      };

      // Fire and forget - don't block response
      supabase
        .from('profiles')
        .upsert(newProfile, { onConflict: 'user_id' })
        .then(({ error }) => {
          if (error) console.error('[auth-me] Async profile create failed:', error);
          else console.log('[auth-me] Async profile created');
        });

      // Return immediately with new profile data
      const response = {
        id: user.id,
        email: newProfile.email,
        full_name: newProfile.full_name,
        phone: newProfile.phone,
        address: newProfile.address,
        country: newProfile.country,
        province: newProfile.province,
        language: newProfile.language,
      };

      console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - New profile for user: ${user.id}`);

      return new Response(
        JSON.stringify(response),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Return complete profile object (never null fields in response)
    const response = {
      id: profile.user_id || user.id,
      email: profile.email || user.email || '',
      full_name: profile.full_name || '',
      phone: profile.phone || '',
      address: profile.address || profile.address_line1 || '',
      country: profile.country || 'DR Congo',
      province: profile.province || profile.state_province || 'Kinshasa',
      language: profile.language || 'fr',
    };

    console.log(`[auth-me] PERF duration=${Date.now() - startTime}ms - Success for user: ${user.id}`);

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    // Never leak internal errors - always return structured JSON
    console.error(`[auth-me] PERF duration=${Date.now() - startTime}ms - Error:`, error.message);
    return new Response(
      JSON.stringify({ code: 500, message: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
