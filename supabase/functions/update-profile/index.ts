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

    // Validate auth header format
    const token = authHeader.replace('Bearer ', '');
    if (!token || token === authHeader || token.length < 10) {
      console.error('[update-profile] Invalid authorization header format');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authorization header format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify the JWT token using admin client
    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !userData?.user) {
      console.error('[update-profile] Auth verification error:', authError?.message || 'No user returned');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const userId = userData.user.id;
    const userEmail = userData.user.email || '';

    console.log('[update-profile] User authenticated:', userId);

    // Parse request body
    let body: UpdateProfileRequest = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
      console.log('[update-profile] Received body:', JSON.stringify(body, null, 2));
    } catch (parseError: any) {
      console.log('[update-profile] JSON parse warning:', parseError.message);
      // Continue with empty body - language-only updates might have minimal body
    }

    // Normalize input fields (accept multiple naming conventions)
    const fullName = body.full_name || body.fullName;
    const phone = body.phone || body.phoneNumber;
    const address = body.address || body.addressLine1;
    const province = body.province || body.stateOrProvince;
    const country = body.country;
    let language = body.language;

    // Validate language if provided
    if (language && !['fr', 'en', 'sw', 'ln'].includes(language)) {
      console.log('[update-profile] Invalid language value:', language, '- defaulting to fr');
      language = 'fr';
    }

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
    if (language) updateData.language = language;

    console.log('[update-profile] Fields to update:', Object.keys(updateData));

    // Check if profile exists
    const { data: existingProfile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('[update-profile] Error fetching profile:', fetchError);
    }

    let profile;

    if (existingProfile) {
      // Update existing profile
      console.log('[update-profile] Updating existing profile for user:', userId);
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from('profiles')
        .update(updateData)
        .eq('user_id', userId)
        .select()
        .single();

      if (updateError) {
        console.error('[update-profile] Update error:', updateError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update profile: ' + updateError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      profile = updatedProfile;
      console.log('[update-profile] Profile updated successfully');
    } else {
      // Create new profile with defaults
      console.log('[update-profile] Creating new profile for user:', userId);
      const defaultCountry = country || 'DR Congo';
      const defaultProvince = province || 'Kinshasa';
      const defaultLanguage = language || getLanguageForCountry(defaultCountry);

      const newProfileData = {
        user_id: userId,
        email: userEmail,
        full_name: fullName || userEmail.split('@')[0] || 'User',
        phone: phone || '',
        address: address || '',
        country: defaultCountry,
        province: defaultProvince,
        language: defaultLanguage,
      };

      const { data: newProfile, error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert(newProfileData)
        .select()
        .single();

      if (insertError) {
        console.error('[update-profile] Insert error:', insertError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create profile: ' + insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      profile = newProfile;
      console.log('[update-profile] Profile created successfully');
    }

    // Return complete profile object (same format as auth-me)
    const response = {
      id: profile.user_id,
      email: profile.email || userEmail,
      full_name: profile.full_name || '',
      phone: profile.phone || '',
      address: profile.address || profile.address_line1 || '',
      country: profile.country || 'DR Congo',
      province: profile.province || profile.state_province || 'Kinshasa',
      language: profile.language || 'fr',
    };

    console.log('[update-profile] Returning profile:', response.id, 'language:', response.language);

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[update-profile] Unexpected error:', error.message, error.stack);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to update profile',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
