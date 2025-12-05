import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Update Profile Endpoint
 * 
 * Updates the authenticated user's profile information.
 * Only provided fields will be updated.
 * 
 * POST /update-profile
 * 
 * Body (all fields optional):
 * {
 *   "fullName": "...",
 *   "firstName": "...",
 *   "lastName": "...",
 *   "phoneNumber": "...",
 *   "phone": "...",
 *   "addressLine1": "...",
 *   "address": "...",
 *   "addressLine2": "...",
 *   "city": "...",
 *   "stateOrProvince": "...",
 *   "country": "...",
 *   "language": "fr" | "en" | "sw" | "ln"
 * }
 */

interface UpdateProfileRequest {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  phone?: string;
  addressLine1?: string;
  address?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  country?: string;
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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
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
      console.log('[update-profile] Empty or invalid JSON body, proceeding with empty update');
    }

    const {
      fullName,
      firstName,
      lastName,
      phoneNumber,
      phone,
      addressLine1,
      address,
      addressLine2,
      city,
      stateOrProvince,
      country,
      language,
    } = body;

    console.log('[update-profile] Received body:', JSON.stringify(body, null, 2));

    // Build update object - handle multiple field name conventions
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // Handle full_name - accept various formats
    const computedFullName = fullName || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName);
    if (computedFullName) {
      updateData.full_name = computedFullName.trim();
    }

    // Handle phone - accept both phoneNumber and phone
    const computedPhone = phoneNumber || phone;
    if (computedPhone) {
      updateData.phone = computedPhone.trim();
    }

    // Handle address - accept both addressLine1 and address
    const computedAddress = addressLine1 || address;
    if (computedAddress) {
      updateData.address_line1 = computedAddress.trim();
    }

    if (addressLine2) {
      updateData.address_line2 = addressLine2.trim();
    }

    if (city) {
      updateData.city = city.trim();
    }

    if (stateOrProvince) {
      updateData.state_province = stateOrProvince.trim();
    }

    if (country) {
      updateData.country = country.trim();
    }

    if (language && ['fr', 'en', 'sw', 'ln'].includes(language)) {
      updateData.language = language;
    }

    console.log('[update-profile] Fields to update:', Object.keys(updateData));

    // Use admin client for upsert
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
      // Create new profile
      console.log('[update-profile] Creating new profile');
      const { data: newProfile, error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert({
          user_id: user.id,
          email: user.email,
          ...updateData,
        })
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

    // Check if profile is complete
    const hasCompleteProfile = !!(
      profile.full_name &&
      profile.phone &&
      profile.address_line1 &&
      profile.city &&
      profile.country
    );

    console.log('[update-profile] Profile updated successfully, complete:', hasCompleteProfile);

    // Return profile in a format the mobile app expects
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Profile updated successfully',
        profile: {
          id: profile.id,
          userId: profile.user_id,
          email: profile.email || user.email || '',
          fullName: profile.full_name || profile.name || '',
          firstName: profile.full_name?.split(' ')[0] || '',
          lastName: profile.full_name?.split(' ').slice(1).join(' ') || '',
          phoneNumber: profile.phone || '',
          phone: profile.phone || '',
          addressLine1: profile.address_line1 || '',
          address: profile.address_line1 || '',
          addressLine2: profile.address_line2 || '',
          city: profile.city || '',
          stateOrProvince: profile.state_province || '',
          country: profile.country || '',
          language: profile.language || 'fr',
        },
        hasCompleteProfile,
      }),
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
