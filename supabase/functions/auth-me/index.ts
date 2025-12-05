import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // 4. Verify JWT and get user
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    
    if (userError) {
      const errorMsg = userError.message?.toLowerCase() || '';
      if (errorMsg.includes('expired') || errorMsg.includes('exp claim')) {
        return new Response(
          JSON.stringify({ code: 401, message: 'Token expired', error: 'TOKEN_EXPIRED' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ code: 401, message: 'Invalid JWT', error: 'INVALID_TOKEN' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!user) {
      return new Response(
        JSON.stringify({ code: 401, message: 'User not found', error: 'USER_NOT_FOUND' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[auth-me] Profile fetch error:', profileError);
    }

    // 6. If no profile exists, create one with defaults
    let finalProfile = profile;
    if (!profile) {
      console.log('[auth-me] No profile found, creating default profile for user:', user.id);
      
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

      const { data: createdProfile, error: createError } = await supabase
        .from('profiles')
        .upsert(newProfile, { onConflict: 'user_id' })
        .select()
        .single();

      if (createError) {
        console.error('[auth-me] Failed to create profile:', createError);
        // Return a default response even if creation fails
        finalProfile = newProfile;
      } else {
        finalProfile = createdProfile;
        console.log('[auth-me] Created default profile successfully');
      }
    }

    // 7. Return complete profile object (never null fields in response)
    const response = {
      id: finalProfile.user_id || user.id,
      email: finalProfile.email || user.email || '',
      full_name: finalProfile.full_name || '',
      phone: finalProfile.phone || '',
      address: finalProfile.address || finalProfile.address_line1 || '',
      country: finalProfile.country || 'DR Congo',
      province: finalProfile.province || finalProfile.state_province || 'Kinshasa',
      language: finalProfile.language || 'fr',
    };

    console.log('[auth-me] Returning profile for user:', user.id);

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
