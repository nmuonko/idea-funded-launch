import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

/**
 * Update Profile Endpoint
 * 
 * Updates the authenticated user's profile information.
 * Creates profile if it doesn't exist.
 * Auto-detects language from country if not explicitly provided.
 * 
 * POST /update-profile
 * 
 * Body (all fields optional):
 * {
 *   "full_name": "...",
 *   "fullName": "...",
 *   "phone": "...",
 *   "phoneNumber": "...",
 *   "address": "...",
 *   "country": "...",
 *   "province": "...",
 *   "language": "fr" | "en" | "sw" | "ln"
 * }
 */

interface UpdateProfileRequest {
  full_name?: string;
  fullName?: string;
  phone?: string;
  phoneNumber?: string;
  address?: string;
  addressLine1?: string;
  country?: string;
  province?: string;
  stateOrProvince?: string;
  language?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'PUT') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('[update-profile] Processing profile update request');

    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[update-profile] No authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError || !user) {
      console.error('[update-profile] Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[update-profile] User authenticated:', user.id);

    // Parse request body
    let body: UpdateProfileRequest = {};
    try {
      body = await req.json();
    } catch {
      console.log('[update-profile] Empty or invalid JSON body');
    }

    console.log('[update-profile] Received body:', JSON.stringify(body, null, 2));

    // Use admin client for database operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Normalize input fields (accept multiple naming conventions)
    const fullName = body.full_name || body.fullName;
    const phone = body.phone || body.phoneNumber;
    const address = body.address || body.addressLine1;
    const province = body.province || body.stateOrProvince;
    const country = body.country;
    let language = body.language;

    // Auto-detect language from country if not explicitly provided
    if (!language && country) {
      language = getLanguageForCountry(country);
      console.log('[update-profile] Auto-detected language:', language, 'for country:', country);
    }

    // Build update object
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (fullName) updateData.full_name = fullName.trim();
    if (phone) updateData.phone = phone.trim();
    if (address) updateData.address = address.trim();
    if (country) updateData.country = country.trim();
    if (province) updateData.province = province.trim();
    if (language && ['fr', 'en', 'sw', 'ln'].includes(language)) {
      updateData.language = language;
    }

    console.log('[update-profile] Fields to update:', Object.keys(updateData));

    // Check if profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    let profile;

    if (existingProfile) {
      // Update existing profile
      console.log('[update-profile] Updating existing profile');
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from('profiles')
        .update(updateData)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) {
        console.error('[update-profile] Update error:', updateError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update profile' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      profile = updatedProfile;
    } else {
      // Create new profile with defaults
      console.log('[update-profile] Creating new profile');
      const defaultCountry = country || 'DR Congo';
      const defaultProvince = province || 'Kinshasa';
      const defaultLanguage = language || getLanguageForCountry(defaultCountry);

      const newProfileData = {
        user_id: user.id,
        email: user.email || '',
        full_name: fullName || user.email?.split('@')[0] || 'User',
        phone: phone || '',
        address: address || '',
        country: defaultCountry,
        province: defaultProvince,
        language: defaultLanguage,
        ...updateData,
      };

      const { data: newProfile, error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert(newProfileData)
        .select()
        .single();

      if (insertError) {
        console.error('[update-profile] Insert error:', insertError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create profile' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      profile = newProfile;
    }

    console.log('[update-profile] Profile saved successfully');

    // Return complete profile object (same format as auth-me)
    const response = {
      id: profile.user_id,
      email: profile.email || user.email || '',
      full_name: profile.full_name || '',
      phone: profile.phone || '',
      address: profile.address || profile.address_line1 || '',
      country: profile.country || 'DR Congo',
      province: profile.province || profile.state_province || 'Kinshasa',
      language: profile.language || 'fr',
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[update-profile] Error:', error.message);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to update profile',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
