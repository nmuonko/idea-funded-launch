import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-forwarded-for, cf-connecting-ip',
};

// Rate limiting configuration
const MAX_ATTEMPTS_PER_IP = 10;
const RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_TOKEN_ATTEMPTS = 5; // Max attempts per specific token

// Input validation constants
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_FULLNAME_LENGTH = 100;
const TOKEN_LENGTH = 64; // Expected hex token length (32 bytes = 64 hex chars)

// Hash token for storage (don't store raw tokens in logs)
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

// Extract client IP from headers
function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

// Validate token format (should be 64 hex characters)
function isValidTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  if (token.length !== TOKEN_LENGTH) return false;
  return /^[a-f0-9]+$/i.test(token);
}

// Validate password strength
function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be less than ${MAX_PASSWORD_LENGTH} characters` };
  }
  // Check for at least one letter and one number
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter and one number' };
  }
  return { valid: true };
}

// Sanitize full name input
function sanitizeFullName(name: string | undefined | null): string {
  if (!name || typeof name !== 'string') return '';
  // Remove any HTML/script tags and trim
  return name
    .replace(/<[^>]*>/g, '')
    .replace(/[<>\"']/g, '')
    .trim()
    .substring(0, MAX_FULLNAME_LENGTH);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);
  
  // Use service role to bypass RLS
  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const body = await req.json();
    const { token, password, fullName } = body;

    // ============================================
    // INPUT VALIDATION
    // ============================================
    
    // Validate token format before any DB operations
    if (!token || !isValidTokenFormat(token)) {
      console.log('[accept-invitation] Invalid token format from IP:', clientIp);
      return new Response(JSON.stringify({ error: 'Invalid invitation link format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return new Response(JSON.stringify({ error: passwordValidation.error }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sanitize fullName
    const sanitizedFullName = sanitizeFullName(fullName);

    // Hash the token for logging/tracking (never log raw tokens)
    const tokenHash = await hashToken(token);

    // ============================================
    // RATE LIMITING CHECK
    // ============================================
    
    // Check IP-based rate limit
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    
    const { count: ipAttemptCount } = await serviceSupabase
      .from('invitation_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('ip_address', clientIp)
      .gte('attempted_at', windowStart);

    if (ipAttemptCount !== null && ipAttemptCount >= MAX_ATTEMPTS_PER_IP) {
      console.log('[accept-invitation] Rate limit exceeded for IP:', clientIp, 'attempts:', ipAttemptCount);
      return new Response(JSON.stringify({ 
        error: 'Too many attempts. Please try again later.',
        retry_after_minutes: RATE_LIMIT_WINDOW_MINUTES
      }), {
        status: 429,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Retry-After': String(RATE_LIMIT_WINDOW_MINUTES * 60)
        },
      });
    }

    // Check token-specific attempts (prevent brute-forcing a specific token)
    const { count: tokenAttemptCount } = await serviceSupabase
      .from('invitation_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('token_hash', tokenHash)
      .eq('success', false)
      .gte('attempted_at', windowStart);

    if (tokenAttemptCount !== null && tokenAttemptCount >= MAX_TOKEN_ATTEMPTS) {
      console.log('[accept-invitation] Token attempt limit exceeded, hash:', tokenHash);
      return new Response(JSON.stringify({ 
        error: 'This invitation link has too many failed attempts. Please request a new invitation.' 
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log this attempt (before validation)
    await serviceSupabase
      .from('invitation_attempts')
      .insert({
        ip_address: clientIp,
        token_hash: tokenHash,
        success: false, // Will update to true if successful
      });

    // ============================================
    // INVITATION VALIDATION
    // ============================================
    
    const { data: invitation, error: invError } = await serviceSupabase
      .from('admin_invitations')
      .select('id, email, role, status, expires_at')
      .eq('token', token)
      .single();

    if (invError || !invitation) {
      console.log('[accept-invitation] Invalid token, hash:', tokenHash, 'IP:', clientIp);
      return new Response(JSON.stringify({ error: 'Invalid or expired invitation link' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (invitation.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'This invitation has already been used' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'This invitation has expired. Please request a new one.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[accept-invitation] Valid invitation for:', invitation.email, 'role:', invitation.role);

    // ============================================
    // USER CREATION/UPDATE
    // ============================================
    
    // Check if user already exists
    let existingUserId: string | null = null;
    let page = 1;
    const perPage = 100;
    
    while (true) {
      const { data: usersData } = await serviceSupabase.auth.admin.listUsers({ page, perPage });
      if (!usersData?.users || usersData.users.length === 0) break;
      
      const found = usersData.users.find((u: any) => u.email?.toLowerCase() === invitation.email.toLowerCase());
      if (found) {
        existingUserId = found.id;
        break;
      }
      if (usersData.users.length < perPage) break;
      page++;
    }

    let userId: string;

    if (existingUserId) {
      // User exists - update their password
      console.log('[accept-invitation] Existing user found, updating password');
      const { error: updateError } = await serviceSupabase.auth.admin.updateUserById(existingUserId, {
        password,
        email_confirm: true,
      });

      if (updateError) {
        console.error('[accept-invitation] Failed to update user:', updateError);
        throw updateError;
      }
      userId = existingUserId;
    } else {
      // Create new user account
      const { data: newUser, error: createError } = await serviceSupabase.auth.admin.createUser({
        email: invitation.email,
        password,
        email_confirm: true,
        user_metadata: { 
          full_name: sanitizedFullName || invitation.email.split('@')[0], 
          invited_admin: true 
        }
      });

      if (createError) {
        console.error('[accept-invitation] Failed to create user:', createError);
        
        if (createError.message.includes('already registered') || createError.message.includes('already been registered')) {
          return new Response(JSON.stringify({ 
            error: 'Account already exists. Please login with your existing credentials.',
            redirect: '/auth'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        throw createError;
      }

      userId = newUser.user.id;
      console.log('[accept-invitation] Created new user:', userId);
    }

    // ============================================
    // PROFILE & ROLE SETUP
    // ============================================
    
    // Upsert profile
    const { error: profileError } = await serviceSupabase
      .from('profiles')
      .upsert({
        user_id: userId,
        email: invitation.email,
        full_name: sanitizedFullName || invitation.email.split('@')[0],
        name: sanitizedFullName || invitation.email.split('@')[0],
      }, { onConflict: 'user_id' });

    if (profileError) {
      console.error('[accept-invitation] Profile upsert error:', profileError);
    }

    // Add admin role
    const { error: roleError } = await serviceSupabase
      .from('user_roles')
      .upsert({ 
        user_id: userId, 
        role: 'admin', 
        admin_role: invitation.role 
      }, { onConflict: 'user_id,role' });

    if (roleError) {
      console.error('[accept-invitation] Role assignment error:', roleError);
      throw new Error('Failed to assign admin role');
    }

    console.log('[accept-invitation] Assigned role:', invitation.role, 'to user:', userId);

    // Set up permissions based on role
    const defaultPermissions: Record<string, any> = {
      super_admin: {
        can_view_dashboard: true,
        can_view_orders: true,
        can_view_active_carts: true,
        can_view_saved_carts: true,
        can_view_ab_results: true,
        can_view_analytics: true,
        can_view_payments: true,
        can_view_shipping: true,
        can_manage_shipping_types: true,
        can_view_tickets: true,
        can_view_ticket_analytics: true,
        can_view_knowledge_base: true,
        can_manage_users: true,
        can_view_settings: true,
        can_view_theme_settings: true,
        can_view_customers: true,
      },
      operations: {
        can_view_dashboard: true,
        can_view_orders: true,
        can_view_active_carts: true,
        can_view_saved_carts: true,
        can_view_shipping: true,
        can_view_customers: true,
      },
      finance: {
        can_view_dashboard: true,
        can_view_ab_results: true,
        can_view_analytics: true,
        can_view_payments: true,
        can_view_customers: true,
      },
      support: {
        can_view_dashboard: true,
        can_view_orders: true,
        can_view_tickets: true,
        can_view_ticket_analytics: true,
        can_view_knowledge_base: true,
        can_view_customers: true,
      },
    };

    const permissions = defaultPermissions[invitation.role] || defaultPermissions.support;

    await serviceSupabase
      .from('admin_user_permissions')
      .upsert({
        user_id: userId,
        ...permissions,
      }, { onConflict: 'user_id' });

    // Mark invitation as accepted
    await serviceSupabase
      .from('admin_invitations')
      .update({ 
        status: 'accepted', 
        accepted_at: new Date().toISOString() 
      })
      .eq('id', invitation.id);

    // Update the attempt record to mark as successful
    await serviceSupabase
      .from('invitation_attempts')
      .update({ success: true })
      .eq('token_hash', tokenHash)
      .eq('ip_address', clientIp)
      .order('attempted_at', { ascending: false })
      .limit(1);

    console.log('[accept-invitation] Successfully completed invitation acceptance for:', invitation.email);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Account created successfully! You can now login.',
      email: invitation.email,
      role: invitation.role
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[accept-invitation] Error:', error);
    // Don't expose internal error details
    return new Response(JSON.stringify({ error: 'Failed to accept invitation. Please try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
