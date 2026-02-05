import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Auth Register Edge Function
 * 
 * Registers a new user with profile information.
 * Simplified for African markets where detailed addresses are uncommon.
 * 
 * Required fields:
 * - email
 * - password
 * - fullName
 * - phoneNumber
 * - country
 * 
 * Optional fields (for African addresses):
 * - addressLine1 (optional - reduces friction)
 * - addressLine2
 * - city (optional - reduces friction for African markets)
 * - stateOrProvince (optional)
 * - postalCode (not used in most African countries)
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
  // Allow various phone formats including international with + prefix
  // E.164 format: +[country code][number] - total 8-15 digits after removing +
  const trimmed = phone.trim();
  
  // Remove + prefix if present, then remove any remaining non-digits
  const digitsOnly = trimmed.startsWith('+') 
    ? trimmed.substring(1).replace(/\D/g, '')
    : trimmed.replace(/\D/g, '');
  
  console.log('[auth-register] Phone validation:', { 
    original: phone, 
    trimmed, 
    digitsOnly, 
    length: digitsOnly.length 
  });
  
  // Valid if between 8 and 15 digits (E.164 standard)
  return digitsOnly.length >= 8 && digitsOnly.length <= 15;
}

function isJustCountryCode(phone: string): boolean {
  // Check if phone is just a country calling code (1-4 digits with optional +)
  const trimmed = phone.trim();
  const digitsOnly = trimmed.startsWith('+') 
    ? trimmed.substring(1).replace(/\D/g, '')
    : trimmed.replace(/\D/g, '');
  
  // Country codes are 1-4 digits, real phone numbers are 8+ digits total
  return digitsOnly.length >= 1 && digitsOnly.length <= 4;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Log the full request body for debugging phone issues
    console.log('[auth-register] Full request body:', JSON.stringify({
      hasEmail: !!body.email,
      hasPassword: !!body.password,
      fullName: body.fullName || body.full_name || body.name,
      phoneNumber: body.phoneNumber,
      phone: body.phone,
      phone_number: body.phone_number,
      countryCode: body.countryCode,
      country: body.country,
      city: body.city,
    }));
    
    // Support both phoneNumber and phone field names for mobile compatibility
    const email = body.email;
    const password = body.password;
    const fullName = body.fullName || body.full_name || body.name;
    let phoneNumber = body.phoneNumber || body.phone || body.phone_number;
    const addressLine1 = body.addressLine1 || body.address_line1 || body.address;
    const addressLine2 = body.addressLine2 || body.address_line2;
    const city = body.city;
    const stateOrProvince = body.stateOrProvince || body.state_province || body.province;
    const postalCode = body.postalCode || body.postal_code;
    const country = body.country;
    
    // Also capture nationalPhoneNumber if mobile sends it separately
    const nationalPhoneNumber = body.nationalPhoneNumber || body.national_phone_number || body.localPhoneNumber;
    
    // If phoneNumber looks like just a country code (short) and we have nationalPhoneNumber, combine them
    if (phoneNumber && nationalPhoneNumber) {
      const phoneDigits = phoneNumber.replace(/\D/g, '');
      if (phoneDigits.length <= 4 && nationalPhoneNumber.length >= 6) {
        console.log('[auth-register] Combining country code with national number:', {
          countryCodePart: phoneNumber,
          nationalPart: nationalPhoneNumber,
        });
        phoneNumber = phoneNumber.startsWith('+') 
          ? `${phoneNumber}${nationalPhoneNumber.replace(/\D/g, '')}`
          : `+${phoneNumber}${nationalPhoneNumber.replace(/\D/g, '')}`;
      }
    }

    console.log('[auth-register] Registration attempt for:', email, 'Phone:', phoneNumber);

    // Check if phone is just a country code (mobile app bug workaround)
    const phoneIsOnlyCountryCode = phoneNumber && isJustCountryCode(phoneNumber);
    if (phoneIsOnlyCountryCode) {
      console.log('[auth-register] Phone appears to be just a country code, treating as empty:', phoneNumber);
      // Clear it so we don't store an incomplete phone number
      phoneNumber = null;
    }

    // Validate required fields - simplified for African markets
    // Phone is now OPTIONAL to work around mobile app bug where only country code is sent
    // Users can add their full phone number in their profile later
    const missingFields: string[] = [];
    
    if (!email || email.trim() === '') missingFields.push('email');
    if (!password || password.trim() === '') missingFields.push('password');
    if (!fullName || fullName.trim() === '') missingFields.push('fullName');
    // phoneNumber is now OPTIONAL - mobile app has a bug sending only country code
    // addressLine1, city, stateOrProvince are also OPTIONAL for African addresses
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

    // Validate phone format ONLY if a full phone was provided (not just country code)
    if (phoneNumber && !validatePhone(phoneNumber.trim())) {
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
    if (addressLine1 && addressLine1.trim().length > 200) {
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
    if (city && city.trim().length > 100) {
      return new Response(
        JSON.stringify({ ok: false, message: 'City must be less than 100 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    // Extract project reference for debugging - CRITICAL for env mismatch detection
    const projectHost = supabaseUrl.replace('https://', '').split('.')[0];
    console.log(`[AUTH_REGISTER] email=${email.substring(0, 3)}*** projectHost=${projectHost}`);
    
    // Verify expected project
    const EXPECTED_PROJECT = 'igmkhxffnyzoogcqvdab';
    if (projectHost !== EXPECTED_PROJECT) {
      console.error(`[AUTH_REGISTER] ⚠️ PROJECT_MISMATCH expected=${EXPECTED_PROJECT} actual=${projectHost}`);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Create auth user - email verification required
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: false, // Triggers email verification
      user_metadata: {
        full_name: fullName.trim(),
        phone: phoneNumber?.trim() || null,
      },
    });

    // Send verification email using magiclink type
    if (authData?.user) {
      const { data: linkData, error: emailError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: email.trim(),
        options: {
          redirectTo: `${frontendBaseUrl}/email-confirmed`,
        },
      });
      
      if (emailError) {
        console.warn('[auth-register] Failed to generate verification link:', emailError.message);
      } else if (linkData?.properties?.action_link) {
        // Send the verification email via Resend
        try {
          const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
          const verificationLink = linkData.properties.action_link;
          const isFrench = req.headers.get('Accept-Language')?.includes('fr');

          const subject = isFrench 
            ? 'Vérifiez votre compte AfriShop USA' 
            : 'Verify your AfriShop USA account';
          
          const htmlContent = isFrench
            ? `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #2563eb;">Bienvenue chez AfriShop USA!</h1>
                <p>Bonjour ${fullName.trim()},</p>
                <p>Merci d'avoir créé un compte. Veuillez vérifier votre adresse e-mail en cliquant sur le bouton ci-dessous :</p>
                <a href="${verificationLink}"
                   style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">
                  Vérifier l'adresse e-mail
                </a>
                <p style="color: #6b7280; font-size: 14px;">
                  Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br/>
                  <a href="${verificationLink}" style="color: #2563eb;">${verificationLink}</a>
                </p>
                <p>Ce lien expirera dans 24 heures.</p>
                <p>Cordialement,<br/>L'équipe AfriShop USA</p>
              </div>
            `
            : `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #2563eb;">Welcome to AfriShop USA!</h1>
                <p>Hello ${fullName.trim()},</p>
                <p>Thank you for creating an account. Please verify your email address by clicking the button below:</p>
                <a href="${verificationLink}"
                   style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">
                  Verify Email Address
                </a>
                <p style="color: #6b7280; font-size: 14px;">
                  If the button doesn't work, copy and paste this link into your browser:<br/>
                  <a href="${verificationLink}" style="color: #2563eb;">${verificationLink}</a>
                </p>
                <p>This link will expire in 24 hours.</p>
                <p>Best regards,<br/>The AfriShop USA Team</p>
              </div>
            `;

          const { error: resendError } = await resend.emails.send({
            from: 'AfriShop USA <nkadimisha@afrishop-usa.com>',
            to: [email.trim()],
            subject: subject,
            html: htmlContent,
          });

          if (resendError) {
            console.error('[auth-register] Resend email error:', resendError);
          } else {
            console.log('[auth-register] Verification email sent to:', email);
          }
        } catch (resendErr: any) {
          console.error('[auth-register] Failed to send verification email:', resendErr.message);
        }
      }
    }

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
    console.log(`[AUTH_REGISTER] created userId=${userId} email=${email.substring(0,3)}*** projectHost=${projectHost}`);

    // Profile data to store - all required fields from signup (postalCode is optional for Africa)
    const profileData = {
      user_id: userId,
      email: email.trim().toLowerCase(),
      full_name: fullName.trim(),
      name: fullName.trim(),
      phone: phoneNumber?.trim() || null,
      address_line1: addressLine1?.trim() || null,
      address_line2: addressLine2?.trim() || null,
      city: city?.trim() || null,
      state_province: stateOrProvince?.trim() || null,
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
      
      // Registration successful - MUST return status 200 for mobile app compatibility
      // Mobile app checks: result.needsEmailConfirmation || result.success
      console.log('[auth-register] Returning success response for email:', email.trim());
      return new Response(
        JSON.stringify({
          success: true,
          needsEmailConfirmation: true,
          ok: true,
          requiresEmailConfirmation: true,
          emailVerificationRequired: true,
          status: 'email_verification_required',
          action: 'verify_email',
          userId,
          message: 'Account created successfully. Please check your email to verify your account.',
          message_fr: 'Compte créé avec succès. Veuillez vérifier votre email pour confirmer votre compte.',
          email: email.trim(),
          user: {
            id: userId,
            email: email.trim(),
            fullName: fullName.trim(),
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-register] Registration complete with session for:', email);

    // Full success with session tokens - MUST return status 200 for mobile app compatibility
    return new Response(
      JSON.stringify({
        success: true,
        needsEmailConfirmation: true,
        ok: true,
        requiresEmailConfirmation: true,
        emailVerificationRequired: true,
        status: 'email_verification_required',
        action: 'verify_email',
        userId: sessionData.user.id,
        message: 'Account created successfully. Please check your email to verify your account.',
        message_fr: 'Compte créé avec succès. Veuillez vérifier votre email pour confirmer votre compte.',
        email: sessionData.user.email,
        user: {
          id: sessionData.user.id,
          email: sessionData.user.email,
          fullName: fullName.trim(),
          phoneNumber: phoneNumber?.trim() || null,
          addressLine1: addressLine1?.trim() || null,
          addressLine2: addressLine2?.trim() || null,
          city: city?.trim() || null,
          stateOrProvince: stateOrProvince?.trim() || null,
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
