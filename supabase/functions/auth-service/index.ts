/**
 * auth-service — Consolidated Auth & Profile Router
 * 
 * All business logic INLINED (no forwardToFunction proxy).
 * 
 * Routes by `action` field in POST body:
 *   register, login, me, check_verified, resend_verification,
 *   get_profile, update_profile, update_profile_web
 * 
 * AUTH: Most actions require a valid JWT.
 * Exceptions: register and login are public.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

const PUBLIC_ACTIONS = new Set(['register', 'login', 'confirm_all_users']);

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function createServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function createAnonClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );
}

async function getAuthUser(req: Request): Promise<{ userId: string; user: any } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonRes({ ok: false, error: 'Unauthorized: missing Bearer token' }, 401);
  }
  const token = authHeader.replace('Bearer ', '');
  if (!token || token.length < 10) {
    return jsonRes({ ok: false, error: 'Invalid token' }, 401);
  }
  const admin = createServiceClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error) {
    const msg = error.message?.toLowerCase() || '';
    if (msg.includes('expired') || msg.includes('exp claim')) {
      return jsonRes({ ok: false, error: 'Token expired', code: 'TOKEN_EXPIRED' }, 401);
    }
    return jsonRes({ ok: false, error: 'Invalid token', code: 'INVALID_TOKEN' }, 401);
  }
  if (!user) return jsonRes({ ok: false, error: 'User not found' }, 401);
  return { userId: user.id, user };
}

// ─── Country/Language helpers ───
const FRENCH_COUNTRIES = [
  'DR Congo','Congo-Brazzaville','Central African Republic','Cameroon',
  'Burundi','Rwanda','Benin','Ivory Coast','Senegal','Mali',
  'Chad','Niger','Gabon','Togo','Burkina Faso','Madagascar',
  'Guinea','Mauritius','Comoros','Djibouti','Seychelles'
];
const ENGLISH_COUNTRIES = [
  'Kenya','Uganda','Tanzania','Nigeria','Ghana','South Africa',
  'Zambia','Zimbabwe','Botswana','Namibia','Malawi','Liberia',
  'Sierra Leone','Gambia','Lesotho','Eswatini'
];
function langForCountry(c: string) {
  if (FRENCH_COUNTRIES.includes(c)) return 'fr';
  if (ENGLISH_COUNTRIES.includes(c)) return 'en';
  return 'fr';
}

// ─── Validation helpers ───
function validateEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validatePhone(p: string) {
  if (!p || !p.trim()) return true;
  const d = p.startsWith('+') ? p.substring(1).replace(/\D/g,'') : p.replace(/\D/g,'');
  return d.length >= 8 && d.length <= 15;
}
function isJustCountryCode(p: string) {
  const d = p.startsWith('+') ? p.substring(1).replace(/\D/g,'') : p.replace(/\D/g,'');
  return d.length >= 1 && d.length <= 4;
}

/** Validate redirectBaseUrl against allowed origins */
function resolveRedirectBase(requestedUrl: string | undefined, fallback: string): string {
  if (!requestedUrl) return fallback;
  try {
    const origin = new URL(requestedUrl).origin;
    if (
      origin === 'https://afrishop-usa.com' ||
      origin === 'https://www.afrishop-usa.com' ||
      origin === 'https://idea-funded-launch.lovable.app' ||
      /^https:\/\/id-preview--[a-z0-9-]+\.lovable\.app$/.test(origin) ||
      origin === fallback
    ) return origin;
  } catch { /* invalid */ }
  return fallback;
}

function normalizeField(body: Record<string, any>, ...keys: string[]) {
  for (const k of keys) if (body[k] !== undefined) return body[k];
  return undefined;
}

// ═══════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════

async function handleRegister(body: any, req: Request) {
  const email = body.email;
  const password = body.password;
  const fullName = body.fullName || body.full_name || body.name;
  let phoneNumber = body.phoneNumber || body.phone || body.phone_number;
  const addressLine1 = body.addressLine1 || body.address_line1 || body.address;
  const addressLine2 = body.addressLine2 || body.address_line2;
  const city = body.city;
  const stateOrProvince = body.stateOrProvince || body.state_province || body.province;
  const postalCode = body.postalCode || body.postal_code;
  const country = body.country || body.countryName || body.country_name || body.locationCountry || body.location_country;
  const normalizedCountry = (country && String(country).trim()) ? String(country).trim() : 'DR Congo';
  let signupPlatform = body.signup_platform || body.signupPlatform || null;
  if (!signupPlatform || signupPlatform === 'web') {
    const ua = req.headers.get('user-agent') || '';
    signupPlatform = /dart|okhttp|android|iphone|mobile|afrishop/i.test(ua) ? 'mobile' : 'web';
  }
  const referredByCode = body.referred_by_code || body.referredByCode || null;
  const nationalPhoneNumber = body.nationalPhoneNumber || body.national_phone_number || body.localPhoneNumber;

  if (phoneNumber && nationalPhoneNumber) {
    const pd = phoneNumber.replace(/\D/g, '');
    if (pd.length <= 4 && nationalPhoneNumber.length >= 6) {
      phoneNumber = phoneNumber.startsWith('+')
        ? `${phoneNumber}${nationalPhoneNumber.replace(/\D/g, '')}`
        : `+${phoneNumber}${nationalPhoneNumber.replace(/\D/g, '')}`;
    }
  }

  if (phoneNumber && isJustCountryCode(phoneNumber)) phoneNumber = null;

  const missing: string[] = [];
  if (!email || !email.trim()) missing.push('email');
  if (!password || !password.trim()) missing.push('password');
  if (!fullName || !fullName.trim()) missing.push('fullName');
  if (missing.length) return jsonRes({ ok: false, message: `Missing required fields: ${missing.join(', ')}`, missingFields: missing }, 400);
  if (!country) console.log('[auth-service:register] country missing in payload, defaulting to DR Congo for mobile compatibility');

  if (!validateEmail(email.trim())) return jsonRes({ ok: false, message: 'Invalid email format' }, 400);
  if (phoneNumber && !validatePhone(phoneNumber.trim())) return jsonRes({ ok: false, message: 'Invalid phone number. Must be between 8 and 15 digits.' }, 400);
  if (password.length < 6) return jsonRes({ ok: false, message: 'Password must be at least 6 characters long' }, 400);
  if (fullName.trim().length > 100) return jsonRes({ ok: false, message: 'Full name must be less than 100 characters' }, 400);
  if (addressLine1 && addressLine1.trim().length > 200) return jsonRes({ ok: false, message: 'Address line 1 must be less than 200 characters' }, 400);
  if (addressLine2 && addressLine2.trim().length > 200) return jsonRes({ ok: false, message: 'Address line 2 must be less than 200 characters' }, 400);
  if (city && city.trim().length > 100) return jsonRes({ ok: false, message: 'City must be less than 100 characters' }, 400);

  const supabaseAdmin = createServiceClient();
  const defaultBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
  const frontendBaseUrl = resolveRedirectBase(body.redirectBaseUrl, defaultBaseUrl);

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim(), phone: phoneNumber?.trim() || null },
  });

  if (authError) {
    console.log('[auth-service:register] createUser error:', authError.message, 'status:', (authError as any).status);
    const errMsg = (authError.message || '').toLowerCase();
    if (errMsg.includes('already') || errMsg.includes('exists') || errMsg.includes('email_exists') || errMsg.includes('registered') || (authError as any).status === 422) {
      // User already exists — try to sign them in instead of failing
      console.log('[auth-service:register] User already exists, attempting sign-in for:', email.trim());
      const supabase = createAnonClient();
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      
      if (!signInErr && signInData?.session) {
        console.log('[auth-service:register] Existing user sign-in SUCCESS for:', email.trim());
        // Ensure profile exists
        const { data: existingProfile } = await supabaseAdmin.from('profiles').select('user_id').eq('user_id', signInData.user.id).maybeSingle();
        if (!existingProfile) {
          await supabaseAdmin.from('profiles').upsert({
            user_id: signInData.user.id, email: email.trim().toLowerCase(), full_name: fullName.trim(), name: fullName.trim(),
            phone: phoneNumber?.trim() || null, address_line1: addressLine1?.trim() || null,
            address_line2: addressLine2?.trim() || null, city: city?.trim() || null,
            state_province: stateOrProvince?.trim() || null, postal_code: postalCode?.trim() || null,
            country: country.trim(), signup_platform: signupPlatform,
          }, { onConflict: 'user_id' });
        }
        return jsonRes({
          success: true, ok: true,
          userId: signInData.user.id,
          message: 'Welcome back! Signed in successfully.',
          message_fr: 'Bienvenue ! Connexion réussie.',
          email: signInData.user.email,
          user: {
            id: signInData.user.id, email: signInData.user.email, fullName: fullName.trim(),
            phoneNumber: phoneNumber?.trim() || null, addressLine1: addressLine1?.trim() || null,
            addressLine2: addressLine2?.trim() || null, city: city?.trim() || null,
            stateOrProvince: stateOrProvince?.trim() || null, postalCode: postalCode?.trim() || null, country: country.trim(),
          },
          token: signInData.session.access_token, refreshToken: signInData.session.refresh_token,
        });
      }
      
      console.log('[auth-service:register] Existing user sign-in FAILED:', signInErr?.message || 'no session');
      return jsonRes({ 
        success: false, ok: false, 
        message: 'This email is already registered. Please sign in instead, or check your password.', 
        message_fr: 'Cet email est déjà enregistré. Veuillez vous connecter ou vérifier votre mot de passe.',
        code: 'USER_EXISTS' 
      }, 409);
    }
    console.error('[auth-service:register] Unhandled createUser error:', authError.message);
    return jsonRes({ ok: false, success: false, message: 'We could not create your account. Please check your information and try again.' }, 400);
  }

  // Verification email skipped — auto-confirm is enabled

  const userId = authData.user.id;

  // Upsert profile
  await supabaseAdmin.from('profiles').upsert({
    user_id: userId, email: email.trim().toLowerCase(), full_name: fullName.trim(), name: fullName.trim(),
    phone: phoneNumber?.trim() || null, address_line1: addressLine1?.trim() || null,
    address_line2: addressLine2?.trim() || null, city: city?.trim() || null,
    state_province: stateOrProvince?.trim() || null, postal_code: postalCode?.trim() || null,
    country: country.trim(), signup_platform: signupPlatform, referred_by_code: referredByCode || null,
  }, { onConflict: 'user_id' });

  // Log referral event (non-blocking)
  if (referredByCode) {
    supabaseAdmin.from('referral_events').insert({
      ref_code: referredByCode, event_type: 'signup', referred_user_id: userId,
      metadata: { email: email.trim(), signup_platform: signupPlatform },
    }).then(({ error: e }) => { if (e) console.warn('[auth-service:register] Referral insert error:', e); });
  }

  // Try sign in for session
  console.log('[auth-service:register] START signIn for email:', email.trim(), 'userId:', userId);
  const supabase = createAnonClient();
  let { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  console.log('[auth-service:register] signIn result — error:', signInError?.message || 'none', 'hasSession:', !!sessionData?.session);

  // Auto-confirm retry: if GoTrue rejects with "Email not confirmed", force-confirm and retry
  if (signInError?.message?.includes('Email not confirmed') || signInError?.message?.includes('email_not_confirmed')) {
    console.log('[auth-service:register] DETECTED "Email not confirmed" — force-confirming userId:', userId);
    const confirmResult = await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    console.log('[auth-service:register] force-confirm result — error:', confirmResult.error?.message || 'none');
    const retry = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    console.log('[auth-service:register] retry signIn result — error:', retry.error?.message || 'none', 'hasSession:', !!retry.data?.session);
    sessionData = retry.data;
    signInError = retry.error;
  }

  if (signInError || !sessionData?.session) {
    // NEVER return success:true without a real session — mobile app depends on token
    console.error('[auth-service:register] FINAL FAILURE — no session obtained. Error:', signInError?.message || 'no session');
    return jsonRes({
      success: false, ok: false,
      error: signInError?.message || 'Account created but session could not be established. Please try logging in.',
      error_fr: 'Compte créé mais la session n\'a pas pu être établie. Veuillez essayer de vous connecter.',
      code: 'SESSION_FAILED',
      userId,
    }, 500);
  }

  return jsonRes({
    success: true, ok: true,
    userId: sessionData.user.id,
    message: 'Account created successfully.',
    message_fr: 'Compte créé avec succès.',
    email: sessionData.user.email,
    user: {
      id: sessionData.user.id, email: sessionData.user.email, fullName: fullName.trim(),
      phoneNumber: phoneNumber?.trim() || null, addressLine1: addressLine1?.trim() || null,
      addressLine2: addressLine2?.trim() || null, city: city?.trim() || null,
      stateOrProvince: stateOrProvince?.trim() || null, postalCode: postalCode?.trim() || null, country: country.trim(),
    },
    token: sessionData.session.access_token, refreshToken: sessionData.session.refresh_token,
  });
}

async function handleLogin(body: any) {
  const email = (body.email || body.emailAddress || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return jsonRes({ success: false, error: 'Email and password are required', code: 'MISSING_FIELDS' }, 400);

  console.log('[auth-service:login] START signIn for email:', email);
  const supabase = createAnonClient();
  let { data, error } = await supabase.auth.signInWithPassword({ email, password });
  console.log('[auth-service:login] signIn result — error:', error?.message || 'none', 'hasSession:', !!data?.session);

  if (error) {
    // Auto-confirm retry: if user exists but email not confirmed, force-confirm and retry
    if (error.message?.includes('Email not confirmed') || error.message?.includes('email_not_confirmed')) {
      console.log('[auth-service:login] DETECTED "Email not confirmed" for:', email, '— looking up user to force-confirm');
      const admin = createServiceClient();
      const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const target = users?.find((u: any) => u.email?.toLowerCase() === email);
      console.log('[auth-service:login] user lookup — found:', !!target, 'userId:', target?.id || 'N/A');
      if (target) {
        const confirmResult = await admin.auth.admin.updateUserById(target.id, { email_confirm: true });
        console.log('[auth-service:login] force-confirm result — error:', confirmResult.error?.message || 'none');
        const retry = await supabase.auth.signInWithPassword({ email, password });
        console.log('[auth-service:login] retry signIn result — error:', retry.error?.message || 'none', 'hasSession:', !!retry.data?.session);
        if (!retry.error && retry.data?.session) {
          data = retry.data;
          error = null as any;
        } else {
          console.error('[auth-service:login] retry FAILED even after force-confirm:', retry.error?.message);
        }
      }
    }
  }

  if (error) {
    let errorMessage = 'Invalid email or password.';
    let errorCode = 'INVALID_CREDENTIALS';
    if (error.message?.includes('Too many requests')) { errorMessage = 'Too many login attempts. Please try again later.'; errorCode = 'RATE_LIMITED'; }
    return jsonRes({ success: false, error: errorMessage, code: errorCode }, 401);
  }

  const { data: profile } = await supabase.from('profiles').select('name, phone, full_name').eq('user_id', data.user.id).maybeSingle();

  return jsonRes({
    success: true,
    user: { id: data.user.id, email: data.user.email, name: profile?.name || profile?.full_name || null, phone: profile?.phone || null },
    token: data.session.access_token,
    session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at, expires_in: data.session.expires_in },
  });
}

async function handleMe(req: Request) {
  const authResult = await getAuthUser(req);
  if (authResult instanceof Response) return authResult;
  const { userId, user } = authResult;
  const admin = createServiceClient();

  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('user_id, email, full_name, phone, address, address_line1, country, province, state_province, language')
    .eq('user_id', userId).maybeSingle();
  if (profileError) console.error('[auth-service:me] Profile fetch error:', profileError);

  if (!profile) {
    const defaultCountry = 'DR Congo';
    const newProfile = {
      user_id: userId, email: user.email || '', full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
      phone: user.user_metadata?.phone || '', address: '', country: defaultCountry, province: 'Kinshasa', language: langForCountry(defaultCountry),
    };
    admin.from('profiles').upsert(newProfile, { onConflict: 'user_id' }).then(({ error }) => { if (error) console.error('[auth-service:me] Profile create failed:', error); });
    return jsonRes({ id: userId, email: newProfile.email, full_name: newProfile.full_name, phone: newProfile.phone, address: '', country: newProfile.country, province: newProfile.province, language: newProfile.language });
  }

  return jsonRes({
    id: profile.user_id || userId, email: profile.email || user.email || '', full_name: profile.full_name || '',
    phone: profile.phone || '', address: profile.address || profile.address_line1 || '',
    country: profile.country || 'DR Congo', province: profile.province || profile.state_province || 'Kinshasa',
    language: profile.language || 'fr',
  });
}

async function handleCheckVerified(body: any) {
  const email = body.email;
  const password = body.password;
  if (!email || !email.trim()) return jsonRes({ ok: false, verified: false, message: 'Email is required' }, 400);

  const admin = createServiceClient();
  const { data: userData, error: userError } = await admin.auth.admin.listUsers();
  if (userError) return jsonRes({ ok: false, verified: false, message: 'Unable to check verification status' }, 500);

  const user = (userData?.users || []).find((u: any) => u.email?.toLowerCase() === email.trim().toLowerCase());
  if (!user) return jsonRes({ ok: false, verified: false, message: 'User not found' }, 404);

  const isVerified = !!user.email_confirmed_at;

  // If verified, trigger referral reward (non-blocking)
  if (isVerified) {
    try {
      const url = Deno.env.get('SUPABASE_URL')!;
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      fetch(`${url}/functions/v1/referral-on-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'apikey': anonKey },
        body: JSON.stringify({ userId: user.id }),
      }).catch(() => {});
    } catch { /* non-blocking */ }
  }

  if (!isVerified) return jsonRes({ ok: true, verified: false, message: 'Email not yet verified. Please check your inbox and click the verification link.' });

  if (password) {
    const supabase = createAnonClient();
    const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError || !sessionData?.session) return jsonRes({ ok: true, verified: true, signedIn: false, message: 'Email verified! Please sign in with your password.' });

    const { data: profile } = await admin.from('profiles').select('*').eq('user_id', sessionData.user.id).single();
    return jsonRes({
      ok: true, verified: true, signedIn: true, message: 'Email verified and signed in successfully!',
      user: {
        id: sessionData.user.id, email: sessionData.user.email,
        fullName: profile?.full_name || sessionData.user.user_metadata?.full_name,
        phoneNumber: profile?.phone, addressLine1: profile?.address_line1, addressLine2: profile?.address_line2,
        city: profile?.city, stateOrProvince: profile?.state_province || profile?.province,
        postalCode: profile?.postal_code, country: profile?.country,
      },
      token: sessionData.session.access_token, refreshToken: sessionData.session.refresh_token,
    });
  }

  return jsonRes({ ok: true, verified: true, signedIn: false, message: 'Email verified! You can now sign in.' });
}

async function handleResendVerification(body: any, req: Request) {
  const email = body.email;
  const redirectBaseUrl = body.redirectBaseUrl;
  if (!email || !email.trim()) return jsonRes({ ok: false, message: 'Email is required' }, 400);

  const admin = createServiceClient();
  const { data: userData, error: userError } = await admin.auth.admin.listUsers();
  if (userError) return jsonRes({ ok: false, message: 'Unable to process request' }, 500);

  const user = (userData?.users || []).find((u: any) => u.email?.toLowerCase() === email.trim().toLowerCase());
  if (!user) return jsonRes({ ok: true, message: 'If an account exists, a verification email has been sent.' });
  if (user.email_confirmed_at) return jsonRes({ ok: true, alreadyVerified: true, message: 'Your email is already verified. You can sign in.' });

  const defaultBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
  const frontendBaseUrl = resolveRedirectBase(redirectBaseUrl, defaultBaseUrl);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: email.trim(), options: { redirectTo: `${frontendBaseUrl}/email-confirmed` },
  });
  if (linkError) return jsonRes({ ok: false, message: 'Unable to send verification email' }, 500);

  const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
  const link = linkData.properties?.action_link;
  const fullName = user.user_metadata?.full_name || 'there';
  const isFr = req.headers.get('Accept-Language')?.includes('fr');
  const subject = isFr ? 'Vérifiez votre compte AfriShop USA' : 'Verify your AfriShop USA account';
  const html = isFr
    ? `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#2563eb">Vérifiez votre compte AfriShop USA</h1><p>Bonjour ${fullName},</p><p>Veuillez vérifier votre adresse e-mail en cliquant sur le bouton ci-dessous :</p><a href="${link}" style="display:inline-block;background-color:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;margin:20px 0">Vérifier l'adresse e-mail</a><p style="color:#6b7280;font-size:14px">Si le bouton ne fonctionne pas :<br/><a href="${link}" style="color:#2563eb">${link}</a></p><p>Ce lien expirera dans 24 heures.</p><p>Cordialement,<br/>L'équipe AfriShop USA</p></div>`
    : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#2563eb">Verify your AfriShop USA account</h1><p>Hello ${fullName},</p><p>Please verify your email address by clicking the button below:</p><a href="${link}" style="display:inline-block;background-color:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;margin:20px 0">Verify Email Address</a><p style="color:#6b7280;font-size:14px">If the button doesn't work:<br/><a href="${link}" style="color:#2563eb">${link}</a></p><p>This link will expire in 24 hours.</p><p>Best regards,<br/>The AfriShop USA Team</p></div>`;

  const { error: resendError } = await resend.emails.send({ from: 'AfriShop USA <nkadimisha@afrishop-usa.com>', to: [email.trim()], subject, html });
  if (resendError) return jsonRes({ ok: false, message: 'Failed to send verification email' }, 500);

  return jsonRes({ ok: true, success: true, message: 'Verification email sent. Please check your inbox.' });
}

async function handleGetProfile(req: Request) {
  const authResult = await getAuthUser(req);
  if (authResult instanceof Response) return authResult;
  const { userId, user } = authResult;
  const admin = createServiceClient();

  let { data: profile, error: profileError } = await admin.from('profiles')
    .select('user_id, email, full_name, name, phone, address, address_line1, address_line2, city, country, province, state_province, postal_code, language')
    .eq('user_id', userId).maybeSingle();
  if (profileError) console.error('[auth-service:get_profile] Error:', profileError);

  if (!profile) {
    const defaultCountry = 'DR Congo';
    const newProfile = {
      user_id: userId, email: user.email || '', full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
      phone: user.user_metadata?.phone || '', address: '', address_line1: '', address_line2: '', city: '',
      country: defaultCountry, province: 'Kinshasa', state_province: 'Kinshasa', language: langForCountry(defaultCountry),
    };
    const { data: created, error: createError } = await admin.from('profiles').upsert(newProfile, { onConflict: 'user_id' })
      .select('user_id, email, full_name, name, phone, address, address_line1, address_line2, city, country, province, state_province, postal_code, language').single();
    profile = createError ? newProfile as any : created;
  }

  const REQUIRED = ['full_name', 'phone', 'country'];
  const complete = profile && REQUIRED.every((f: string) => { const v = (profile as any)[f]; return v !== null && v !== undefined && String(v).trim() !== ''; });
  const missingMap: Record<string, string> = { full_name: 'fullName', phone: 'phone', country: 'country' };
  const missingFields = complete ? [] : REQUIRED.filter((f: string) => { const v = (profile as any)?.[f]; return !v || !String(v).trim(); }).map((f: string) => missingMap[f] || f);

  return jsonRes({
    ok: true, success: true, id: profile?.user_id || userId,
    email: profile?.email || user.email || '', full_name: profile?.full_name || profile?.name || '', fullName: profile?.full_name || profile?.name || '',
    phone: profile?.phone || '', phoneNumber: profile?.phone || '',
    addressLine1: profile?.address_line1 || profile?.address || '', addressLine2: profile?.address_line2 || '', city: profile?.city || '',
    stateOrProvince: profile?.state_province || profile?.province || '',
    address: profile?.address || profile?.address_line1 || '', address_line1: profile?.address_line1 || '', address_line2: profile?.address_line2 || '',
    state_province: profile?.state_province || profile?.province || '', province: profile?.province || profile?.state_province || 'Kinshasa',
    country: profile?.country || 'DR Congo', language: profile?.language || 'fr',
    hasCompleteProfile: complete, missingFields,
  });
}

async function handleUpdateProfile(body: any, req: Request) {
  const authResult = await getAuthUser(req);
  if (authResult instanceof Response) return authResult;
  const { userId, user } = authResult;
  const admin = createServiceClient();

  const fullName = normalizeField(body, 'fullName', 'full_name', 'name');
  const phoneNumber = normalizeField(body, 'phoneNumber', 'phone_number', 'phone');
  const addressLine1 = normalizeField(body, 'addressLine1', 'address_line1', 'address_line_1');
  const addressLine2 = normalizeField(body, 'addressLine2', 'address_line2', 'address_line_2');
  const city = normalizeField(body, 'city');
  const stateOrProvince = normalizeField(body, 'stateOrProvince', 'state_or_province', 'stateProvince', 'state_province', 'province');
  const country = normalizeField(body, 'country');
  const language = normalizeField(body, 'language');

  if (phoneNumber && !validatePhone(phoneNumber)) return jsonRes({ success: false, error: 'Invalid phone number format. Must be between 8 and 15 digits.' }, 400);
  if (language && !['fr', 'en', 'sw', 'ln'].includes(language)) return jsonRes({ success: false, error: 'Invalid language. Must be one of: fr, en, sw, ln' }, 400);
  if (fullName && fullName.trim().length > 100) return jsonRes({ success: false, error: 'Full name must be less than 100 characters' }, 400);
  if (addressLine1 && addressLine1.trim().length > 200) return jsonRes({ success: false, error: 'Address line 1 must be less than 200 characters' }, 400);

  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
  if (fullName !== undefined) { updateData.full_name = fullName.trim(); updateData.name = fullName.trim(); }
  if (phoneNumber !== undefined) updateData.phone = phoneNumber.trim();
  if (addressLine1 !== undefined) { updateData.address_line1 = addressLine1.trim(); updateData.address = addressLine1.trim(); }
  if (addressLine2 !== undefined) updateData.address_line2 = addressLine2?.trim() || null;
  if (city !== undefined) updateData.city = city.trim();
  if (stateOrProvince !== undefined) { updateData.state_province = stateOrProvince.trim(); updateData.province = stateOrProvince.trim(); }
  if (country !== undefined) updateData.country = country.trim();
  if (language !== undefined) updateData.language = language;

  if (Object.keys(updateData).length === 1) return jsonRes({ success: false, error: 'No fields provided to update' }, 400);

  const { data: existing } = await admin.from('profiles').select('id').eq('user_id', userId).maybeSingle();
  let profile;

  if (existing) {
    const { data, error } = await admin.from('profiles').update(updateData).eq('user_id', userId).select().single();
    if (error) return jsonRes({ success: false, error: 'Failed to update profile' }, 500);
    profile = data;
  } else {
    const { data, error } = await admin.from('profiles').insert({ user_id: userId, email: user.email, ...updateData }).select().single();
    if (error) return jsonRes({ success: false, error: 'Failed to create profile' }, 500);
    profile = data;
  }

  const hasCompleteProfile = !!(profile.full_name && profile.phone && profile.address_line1 && profile.city && profile.country);

  return jsonRes({
    success: true, message: 'Profile updated successfully',
    profile: {
      email: profile.email || user.email || '', fullName: profile.full_name || profile.name || '',
      phoneNumber: profile.phone || '', addressLine1: profile.address_line1 || '', addressLine2: profile.address_line2 || '',
      city: profile.city || '', stateOrProvince: profile.state_province || '', country: profile.country || '', language: profile.language || 'fr',
    },
    hasCompleteProfile,
  });
}

async function handleUpdateProfileWeb(body: any, req: Request) {
  const authResult = await getAuthUser(req);
  if (authResult instanceof Response) return authResult;
  const { userId, user } = authResult;
  const admin = createServiceClient();

  const fullName = body.full_name || body.fullName;
  const phone = body.phone || body.phoneNumber;
  const address = body.address || body.addressLine1;
  const province = body.province || body.stateOrProvince;
  const country = body.country;
  let language = body.language;

  if (language && !['fr', 'en', 'sw', 'ln'].includes(language)) language = 'fr';
  if (!language && country) language = langForCountry(country);

  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
  if (fullName) updateData.full_name = fullName.trim();
  if (phone) updateData.phone = phone.trim();
  if (address) updateData.address = address.trim();
  if (country) updateData.country = country.trim();
  if (province) updateData.province = province.trim();
  if (language) updateData.language = language;

  const { data: existing } = await admin.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  let profile;

  if (existing) {
    const { data, error } = await admin.from('profiles').update(updateData).eq('user_id', userId).select().single();
    if (error) return jsonRes({ success: false, error: 'Failed to update profile: ' + error.message }, 500);
    profile = data;
  } else {
    const defaultCountry = country || 'DR Congo';
    const { data, error } = await admin.from('profiles').insert({
      user_id: userId, email: user.email || '', full_name: fullName || user.email?.split('@')[0] || 'User',
      phone: phone || '', address: address || '', country: defaultCountry,
      province: province || 'Kinshasa', language: language || langForCountry(defaultCountry),
    }).select().single();
    if (error) return jsonRes({ success: false, error: 'Failed to create profile: ' + error.message }, 500);
    profile = data;
  }

  return jsonRes({
    id: profile.user_id, email: profile.email || user.email || '', full_name: profile.full_name || '',
    phone: profile.phone || '', address: profile.address || profile.address_line1 || '',
    country: profile.country || 'DR Congo', province: profile.province || profile.state_province || 'Kinshasa',
    language: profile.language || 'fr',
  });
}

// ─── Proxy Helper ──────────────────────────────────────

async function proxyAuthToFunction(functionName: string, req: Request, body: any): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) headers.set('Authorization', authHeader);
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', Deno.env.get('SUPABASE_ANON_KEY') || '');
  const { action: _a, ...payload } = body;
  const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ═══════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════

const SUPPORTED_ACTIONS = ['register', 'login', 'me', 'check_verified', 'resend_verification', 'get_profile', 'update_profile', 'update_profile_web', 'create_referrer', 'confirm_all_users'];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // GET requests default to 'me'
    if (req.method === 'GET') {
      return handleMe(req);
    }

    const body = await req.json();
    const action = body.action;

    if (!action || typeof action !== 'string') {
      return jsonRes({ ok: false, error: `Missing or invalid "action" field. Supported: ${SUPPORTED_ACTIONS.join(', ')}` }, 400);
    }

    if (!SUPPORTED_ACTIONS.includes(action)) {
      return jsonRes({ ok: false, error: `Unknown action "${action}". Supported: ${SUPPORTED_ACTIONS.join(', ')}` }, 400);
    }

    // Auth gate for non-public actions
    if (!PUBLIC_ACTIONS.has(action)) {
      const authResult = await getAuthUser(req);
      if (authResult instanceof Response) return authResult;
    }

    console.log(`[auth-service] action="${action}"`);
    const { action: _a, ...payload } = body;

    switch (action) {
      case 'register': return handleRegister(payload, req);
      case 'login': return handleLogin(payload);
      case 'me': return handleMe(req);
      case 'check_verified': return handleCheckVerified(payload);
      case 'resend_verification': return handleResendVerification(payload, req);
      case 'get_profile': return handleGetProfile(req);
      case 'update_profile': return handleUpdateProfile(payload, req);
      case 'update_profile_web': return handleUpdateProfileWeb(payload, req);
      case 'create_referrer': return proxyAuthToFunction('create-referrer', req, body);
      case 'confirm_all_users': {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const headers = { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey, 'Content-Type': 'application/json' };
        
        // Fetch all users via GoTrue admin API
        let confirmed = 0;
        let page = 1;
        while (true) {
          const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`, { headers });
          if (!res.ok) return jsonRes({ ok: false, error: `List failed: ${res.status}` }, 500);
          const data = await res.json();
          const users = data.users || [];
          if (users.length === 0) break;
          for (const u of users) {
            if (!u.email_confirmed_at) {
              const upd = await fetch(`${supabaseUrl}/auth/v1/admin/users/${u.id}`, {
                method: 'PUT', headers,
                body: JSON.stringify({ email_confirm: true }),
              });
              if (upd.ok) confirmed++;
            }
          }
          if (users.length < 100) break;
          page++;
        }
        return jsonRes({ ok: true, confirmed });
      }
      default: return jsonRes({ ok: false, error: 'Unknown action' }, 400);
    }
  } catch (err: any) {
    console.error('[auth-service] Unhandled error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal server error' }, 500);
  }
});
