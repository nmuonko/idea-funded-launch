import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

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
  return 'fr';
}

// Required fields for a complete profile - relaxed for African addresses
// Only full_name, phone, and country are required; address/province optional
const REQUIRED_PROFILE_FIELDS = ['full_name', 'phone', 'country'];

function isProfileComplete(profile: any): boolean {
  if (!profile) return false;
  return REQUIRED_PROFILE_FIELDS.every(field => {
    const value = profile[field];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

function getMissingProfileFields(profile: any): string[] {
  if (!profile) {
    return ['fullName', 'phone', 'country'];
  }
  
  const fieldMap: Record<string, string> = {
    full_name: 'fullName',
    phone: 'phone',
    country: 'country',
  };
  
  const missing: string[] = [];
  for (const field of REQUIRED_PROFILE_FIELDS) {
    const value = profile[field];
    if (value === null || value === undefined || String(value).trim() === '') {
      missing.push(fieldMap[field] || field);
    }
  }
  return missing;
}

/**
 * Mobile Profile GET Endpoint
 * 
 * Returns the authenticated user's profile information.
 * Auto-creates profile with defaults if none exists.
 * 
 * GET /mobile-profile
 * 
 * Response:
 * {
 *   "id": "...",
 *   "email": "...",
 *   "full_name": "...",
 *   "phone": "...",
 *   "address": "...",
 *   "country": "...",
 *   "province": "...",
 *   "language": "fr" | "en" | "sw" | "ln",
 *   "hasCompleteProfile": true/false,
 *   "missingFields": []
 * }
 */

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ ok: false, success: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('[mobile-profile] Fetching user profile');

    // 1. Read Authorization header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      console.log('[mobile-profile] Missing Authorization header');
      return new Response(
        JSON.stringify({ ok: false, success: false, code: 'AUTH_REQUIRED', error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Extract Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      console.log('[mobile-profile] Invalid Authorization header format');
      return new Response(
        JSON.stringify({ ok: false, success: false, code: 'INVALID_AUTH_FORMAT', error: 'Invalid Authorization header format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = parts[1];
    
    if (!accessToken || accessToken.length < 10) {
      console.log('[mobile-profile] Token is empty or too short');
      return new Response(
        JSON.stringify({ ok: false, success: false, code: 'INVALID_TOKEN', error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Create Supabase client with SERVICE_ROLE key
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[mobile-profile] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({ ok: false, success: false, code: 'SERVER_CONFIG_ERROR', error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    });

    // 4. Verify JWT and get user
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
    
    if (userError) {
      console.error('[mobile-profile] Auth error:', userError.message);
      const errorMsg = userError.message?.toLowerCase() || '';
      if (errorMsg.includes('expired') || errorMsg.includes('exp claim')) {
        return new Response(
          JSON.stringify({ ok: false, success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ ok: false, success: false, error: 'Invalid token', code: 'INVALID_TOKEN' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!user) {
      console.log('[mobile-profile] No user found for token');
      return new Response(
        JSON.stringify({ ok: false, success: false, error: 'User not found', code: 'USER_NOT_FOUND' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[mobile-profile] User authenticated:', user.id);

    // 5. Fetch user profile - select ALL address-related columns
    let { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email, full_name, name, phone, address, address_line1, address_line2, city, country, province, state_province, postal_code, language')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[mobile-profile] Error fetching profile:', profileError);
      // Don't fail, just proceed with creating a new profile
    }

    // 6. If no profile exists, create one with defaults
    if (!profile) {
      console.log('[mobile-profile] No profile found, creating default profile');
      
      const defaultCountry = 'DR Congo';
      const defaultProvince = 'Kinshasa';
      const defaultLanguage = getLanguageForCountry(defaultCountry);
      
      const newProfile = {
        user_id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        phone: user.user_metadata?.phone || '',
        address: '',
        address_line1: '',
        address_line2: '',
        city: '',
        country: defaultCountry,
        province: defaultProvince,
        state_province: defaultProvince,
        language: defaultLanguage,
      };

      const { data: createdProfile, error: createError } = await supabaseAdmin
        .from('profiles')
        .upsert(newProfile, { onConflict: 'user_id' })
        .select('user_id, email, full_name, name, phone, address, address_line1, address_line2, city, country, province, state_province, postal_code, language')
        .single();

      if (createError) {
        console.error('[mobile-profile] Failed to create profile:', createError);
        // Return a default profile anyway so the app doesn't break
        profile = newProfile as any;
      } else {
        profile = createdProfile;
        console.log('[mobile-profile] Created default profile successfully');
      }
    }

    // 7. Check if profile is complete
    const hasCompleteProfile = isProfileComplete(profile);
    const missingFields = hasCompleteProfile ? [] : getMissingProfileFields(profile);

    console.log('[mobile-profile] Profile retrieved, complete:', hasCompleteProfile);

    // 8. Return profile in BOTH formats for backwards compatibility
    // camelCase for new mobile app, snake_case for legacy
    const response = {
      ok: true,
      success: true,
      // Primary ID
      id: profile?.user_id || user.id,
      // Email
      email: profile?.email || user.email || '',
      // Full name - both formats
      full_name: profile?.full_name || profile?.name || '',
      fullName: profile?.full_name || profile?.name || '',
      // Phone - both formats
      phone: profile?.phone || '',
      phoneNumber: profile?.phone || '',
      // Address fields - camelCase (new format)
      addressLine1: profile?.address_line1 || profile?.address || '',
      addressLine2: profile?.address_line2 || '',
      city: profile?.city || '',
      stateOrProvince: profile?.state_province || profile?.province || '',
      // Address fields - snake_case (legacy format)
      address: profile?.address || profile?.address_line1 || '',
      address_line1: profile?.address_line1 || '',
      address_line2: profile?.address_line2 || '',
      state_province: profile?.state_province || profile?.province || '',
      province: profile?.province || profile?.state_province || 'Kinshasa',
      // Country
      country: profile?.country || 'DR Congo',
      // Language
      language: profile?.language || 'fr',
      // Completeness
      hasCompleteProfile,
      missingFields,
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    // Never let the function crash - always return structured JSON
    console.error('[mobile-profile] Unexpected error:', error?.message || error);
    return new Response(
      JSON.stringify({ 
        ok: false,
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Internal server error',
        // Return a minimal profile so the app doesn't break completely
        id: '',
        email: '',
        full_name: '',
        phone: '',
        address: '',
        country: 'DR Congo',
        province: 'Kinshasa',
        language: 'fr',
        hasCompleteProfile: false,
        missingFields: ['fullName', 'phone', 'country']
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
