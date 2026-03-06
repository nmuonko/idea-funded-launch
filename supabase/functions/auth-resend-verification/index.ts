import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Validate redirectBaseUrl against allowed origins */
function resolveRedirectBase(requestedUrl: string | undefined, fallback: string): string {
  if (!requestedUrl) return fallback;
  try {
    const url = new URL(requestedUrl);
    const origin = url.origin;
    if (
      origin === 'https://afrishop-usa.com' ||
      origin === 'https://www.afrishop-usa.com' ||
      origin === 'https://idea-funded-launch.lovable.app' ||
      /^https:\/\/id-preview--[a-z0-9-]+\.lovable\.app$/.test(origin) ||
      origin === fallback
    ) {
      return origin;
    }
  } catch { /* invalid URL */ }
  return fallback;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { email, redirectBaseUrl } = body;

    if (!email || email.trim() === '') {
      return new Response(
        JSON.stringify({ ok: false, message: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-resend-verification] Request for:', email);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if user exists and is not yet verified
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (userError) {
      console.error('[auth-resend-verification] Error listing users:', userError.message);
      return new Response(
        JSON.stringify({ ok: false, message: 'Unable to process request' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const users = userData?.users || [];
    const user = users.find((u: any) => u.email?.toLowerCase() === email.trim().toLowerCase());

    if (!user) {
      // Don't reveal if user exists or not
      console.log('[auth-resend-verification] User not found:', email);
      return new Response(
        JSON.stringify({ ok: true, message: 'If an account exists, a verification email has been sent.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (user.email_confirmed_at) {
      console.log('[auth-resend-verification] Email already confirmed for:', email);
      return new Response(
        JSON.stringify({ 
          ok: true, 
          alreadyVerified: true,
          message: 'Your email is already verified. You can sign in.' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate a new verification link - resolve redirect URL dynamically
    const defaultBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const frontendBaseUrl = resolveRedirectBase(redirectBaseUrl, defaultBaseUrl);
    console.log('[auth-resend-verification] Resolved redirect base URL:', frontendBaseUrl);
    
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email.trim(),
      options: {
        redirectTo: `${frontendBaseUrl}/email-confirmed`,
      },
    });

    if (linkError) {
      console.error('[auth-resend-verification] Error generating link:', linkError.message);
      return new Response(
        JSON.stringify({ ok: false, message: 'Unable to send verification email' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send the verification email via Resend
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const verificationLink = linkData.properties?.action_link;
    const fullName = user.user_metadata?.full_name || 'there';
    const isFrench = req.headers.get('Accept-Language')?.includes('fr');

    const subject = isFrench 
      ? 'Vérifiez votre compte AfriShop USA' 
      : 'Verify your AfriShop USA account';
    
    const htmlContent = isFrench
      ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #2563eb;">Vérifiez votre compte AfriShop USA</h1>
          <p>Bonjour ${fullName},</p>
          <p>Veuillez vérifier votre adresse e-mail en cliquant sur le bouton ci-dessous :</p>
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
          <h1 style="color: #2563eb;">Verify your AfriShop USA account</h1>
          <p>Hello ${fullName},</p>
          <p>Please verify your email address by clicking the button below:</p>
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
      console.error('[auth-resend-verification] Resend error:', resendError);
      return new Response(
        JSON.stringify({ ok: false, message: 'Failed to send verification email' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-resend-verification] Verification email resent to:', email);

    return new Response(
      JSON.stringify({ 
        ok: true, 
        success: true,
        message: 'Verification email sent. Please check your inbox.' 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[auth-resend-verification] Error:', error.message);
    return new Response(
      JSON.stringify({ ok: false, message: 'Unable to process request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
