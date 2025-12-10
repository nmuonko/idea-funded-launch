import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Auth Register Edge Function
 * 
 * Registers a new user with full profile information required for checkout.
 * 
 * Required fields:
 * - email
 * - password
 * - fullName
 * - phoneNumber
 * - addressLine1
 * - city
 * - stateOrProvince
 * - country
 * 
 * Optional fields:
 * - addressLine2
 * - postalCode (not required for African countries)
 */

interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvince: string;
  postalCode?: string;
  country: string;
}

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePhone(phone: string): boolean {
  // Allow various phone formats, minimum 8 digits
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly.length >= 8 && digitsOnly.length <= 15;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RegisterRequest = await req.json();
    const {
      email,
      password,
      fullName,
      phoneNumber,
      addressLine1,
      addressLine2,
      city,
      stateOrProvince,
      postalCode,
      country,
    } = body;

    console.log('[auth-register] Registration attempt for:', email);

    // Validate required fields
    const missingFields: string[] = [];
    
    if (!email || email.trim() === '') missingFields.push('email');
    if (!password || password.trim() === '') missingFields.push('password');
    if (!fullName || fullName.trim() === '') missingFields.push('fullName');
    if (!phoneNumber || phoneNumber.trim() === '') missingFields.push('phoneNumber');
    if (!addressLine1 || addressLine1.trim() === '') missingFields.push('addressLine1');
    if (!city || city.trim() === '') missingFields.push('city');
    if (!stateOrProvince || stateOrProvince.trim() === '') missingFields.push('stateOrProvince');
    // postalCode is NOT required - most African countries don't use them
    if (!country || country.trim() === '') missingFields.push('country');

    if (missingFields.length > 0) {
      console.log('[auth-register] Missing required fields:', missingFields);
      return new Response(
        JSON.stringify({ 
          ok: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
          missingFields,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    if (!validateEmail(email.trim())) {
      return new Response(
        JSON.stringify({ 
          ok: false,
          message: 'Invalid email format',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate phone format
    if (!validatePhone(phoneNumber.trim())) {
      return new Response(
        JSON.stringify({ 
          ok: false,
          message: 'Invalid phone number. Must be between 8 and 15 digits.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate password strength
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ 
          ok: false,
          message: 'Password must be at least 6 characters long',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate field lengths
    if (fullName.trim().length > 100) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Full name must be less than 100 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (addressLine1.trim().length > 200) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Address line 1 must be less than 200 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (addressLine2 && addressLine2.trim().length > 200) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Address line 2 must be less than 200 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (city.trim().length > 100) {
      return new Response(
        JSON.stringify({ ok: false, message: 'City must be less than 100 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create auth user with email auto-confirmed
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        phone: phoneNumber.trim(),
      },
    });

    if (authError) {
      console.error('[auth-register] Auth error:', authError.message);
      
      // Handle specific error cases
      if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
        return new Response(
          JSON.stringify({ 
            ok: false,
            message: 'This email is already registered. Please sign in instead.',
            code: 'USER_EXISTS',
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // For other auth errors, return a generic message but log the actual error
      console.error('[auth-register] Unhandled auth error details:', authError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          message: 'We could not create your account. Please check your information and try again.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = authData.user.id;
    console.log('[auth-register] User created:', userId);

    // Profile data to store - all required fields from signup (postalCode is optional for Africa)
    const profileData = {
      user_id: userId,
      email: email.trim().toLowerCase(),
      full_name: fullName.trim(),
      name: fullName.trim(),
      phone: phoneNumber.trim(),
      address_line1: addressLine1.trim(),
      address_line2: addressLine2?.trim() || null,
      city: city.trim(),
      state_province: stateOrProvince.trim(),
      postal_code: postalCode?.trim() || null,
      country: country.trim(),
    };

    // Use UPSERT to handle both new profiles and updates (prevents duplicates)
    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileData, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('[auth-register] Profile upsert error:', upsertError);
      // Don't fail registration - user can update profile later
    } else {
      console.log('[auth-register] Profile upserted successfully');
    }

    // Verify the profile was saved correctly - use maybeSingle to avoid errors
    const { data: verifyProfile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, phone, address_line1, city, state_province, country')
      .eq('user_id', userId)
      .maybeSingle();
    
    console.log('[auth-register] Profile verification:', verifyProfile ? {
      hasFullName: !!verifyProfile.full_name,
      hasPhone: !!verifyProfile.phone,
      hasAddress: !!verifyProfile.address_line1,
      hasCity: !!verifyProfile.city,
      hasState: !!verifyProfile.state_province,
      hasCountry: !!verifyProfile.country,
    } : 'PROFILE NOT FOUND');

    // Sign in to get session token
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    // Registration succeeded even if sign-in fails (user can sign in manually)
    if (signInError || !sessionData?.session) {
      console.warn('[auth-register] Sign in after registration failed:', signInError?.message || 'No session returned');
      
      // Registration successful, but requires manual sign-in
      return new Response(
        JSON.stringify({
          ok: true,
          userId,
          requiresEmailConfirmation: false,
          message: 'Account created successfully. Please sign in.',
          user: {
            id: userId,
            email: email.trim(),
            fullName: fullName.trim(),
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-register] Registration complete for:', email);

    return new Response(
      JSON.stringify({
        ok: true,
        userId: sessionData.user.id,
        requiresEmailConfirmation: false,
        user: {
          id: sessionData.user.id,
          email: sessionData.user.email,
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim(),
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2?.trim() || null,
          city: city.trim(),
          stateOrProvince: stateOrProvince.trim(),
          postalCode: postalCode?.trim() || null,
          country: country.trim(),
        },
        token: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[auth-register] Unexpected error:', error.message, error.stack);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        message: 'We could not create your account right now. Please try again later.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
