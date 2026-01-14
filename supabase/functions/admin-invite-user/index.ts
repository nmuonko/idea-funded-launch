import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schemas
const adminRoles = ['super_admin', 'operations', 'finance', 'support'] as const;

const inviteUserSchema = z.object({
  email: z.string().email("Invalid email format").max(255, "Email too long"),
  role: z.enum(adminRoles, { errorMap: () => ({ message: "Invalid role" }) }),
  permissions: z.record(z.boolean()).optional(),
  setPassword: z.string().min(8, "Password must be at least 8 characters").max(128).optional(),
  resend: z.boolean().optional(),
  invitationId: z.string().uuid().optional(),
});

const resendInviteSchema = z.object({
  resend: z.literal(true),
  invitationId: z.string().uuid("Invalid invitation ID"),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role, admin_role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();

    // Validate input based on operation type
    if (body.resend && body.invitationId) {
      const resendResult = resendInviteSchema.safeParse(body);
      if (!resendResult.success) {
        const errorMessage = (resendResult as any).error?.errors?.map((e: any) => e.message).join(', ') || 'Validation failed';
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { email, role, permissions, setPassword, resend, invitationId } = body;

    // Default permissions based on role if not provided
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
      },
      operations: {
        can_view_dashboard: true,
        can_view_orders: true,
        can_view_active_carts: true,
        can_view_saved_carts: true,
        can_view_ab_results: false,
        can_view_analytics: false,
        can_view_payments: false,
        can_view_shipping: true,
        can_manage_shipping_types: false,
        can_view_tickets: false,
        can_view_ticket_analytics: false,
        can_view_knowledge_base: false,
        can_manage_users: false,
        can_view_settings: false,
        can_view_theme_settings: false,
      },
      finance: {
        can_view_dashboard: true,
        can_view_orders: false,
        can_view_active_carts: false,
        can_view_saved_carts: false,
        can_view_ab_results: true,
        can_view_analytics: true,
        can_view_payments: true,
        can_view_shipping: false,
        can_manage_shipping_types: false,
        can_view_tickets: false,
        can_view_ticket_analytics: false,
        can_view_knowledge_base: false,
        can_manage_users: false,
        can_view_settings: false,
        can_view_theme_settings: false,
      },
      support: {
        can_view_dashboard: true,
        can_view_orders: true,
        can_view_active_carts: false,
        can_view_saved_carts: false,
        can_view_ab_results: false,
        can_view_analytics: false,
        can_view_payments: false,
        can_view_shipping: false,
        can_manage_shipping_types: false,
        can_view_tickets: true,
        can_view_ticket_analytics: true,
        can_view_knowledge_base: true,
        can_manage_users: false,
        can_view_settings: false,
        can_view_theme_settings: false,
      },
    };

    const userPermissions = permissions || defaultPermissions[role] || defaultPermissions.support;

    // Handle resend invitation
    if (resend && invitationId) {
      console.log('[admin-invite-user] Resending invitation:', invitationId);
      
      // Use service client to bypass RLS
      const { data: invitation, error: invErr } = await serviceSupabase
        .from('admin_invitations')
        .select('*')
        .eq('id', invitationId)
        .single();

      if (invErr || !invitation) {
        return new Response(JSON.stringify({ error: 'Invitation not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update expiration
      const newExpires = new Date();
      newExpires.setDate(newExpires.getDate() + 7);
      const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
      const inviteUrl = `${frontendUrl}/accept-invite?token=${invitation.token}`;

      // Send email
      const emailResult = await sendInvitationEmail(invitation.email, invitation.role, invitation.token);
      
      // Update invitation with new expiration and email status (use service client)
      await serviceSupabase
        .from('admin_invitations')
        .update({ 
          expires_at: newExpires.toISOString(),
          email_sent: emailResult.sent,
          invite_url: inviteUrl
        })
        .eq('id', invitationId);
      
      return new Response(JSON.stringify({ 
        success: true,
        message: emailResult.sent ? 'Invitation resent successfully' : 'Invitation updated (email service unavailable)',
        emailSent: emailResult.sent,
        emailError: emailResult.error,
        inviteUrl: inviteUrl
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate new invitation input
    const inviteResult = inviteUserSchema.safeParse(body);
    if (!inviteResult.success) {
      const errorMessage = (inviteResult as any).error?.errors?.map((e: any) => e.message).join(', ') || 'Validation failed';
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[admin-invite-user] Inviting:', email, 'as', role);

    // Check if user already exists by listing users with pagination
    let existingUser = null;
    let page = 1;
    const perPage = 100;
    
    while (true) {
      const { data: usersData } = await serviceSupabase.auth.admin.listUsers({ page, perPage });
      if (!usersData?.users || usersData.users.length === 0) break;
      
      existingUser = usersData.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser) break;
      if (usersData.users.length < perPage) break;
      page++;
    }

    if (existingUser) {
      // User exists - check if already admin (use service client to bypass RLS)
      const { data: existingRole } = await serviceSupabase
        .from('user_roles')
        .select('*')
        .eq('user_id', existingUser.id)
        .eq('role', 'admin')
        .single();

      if (existingRole) {
        return new Response(JSON.stringify({ 
          error: 'User is already an admin',
          existingRole: existingRole.admin_role 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Add admin role to existing user (use service client)
      const { error: roleError } = await serviceSupabase
        .from('user_roles')
        .insert({ user_id: existingUser.id, role: 'admin', admin_role: role });

      if (roleError) throw roleError;

      // Add permissions for the user
      await serviceSupabase
        .from('admin_user_permissions')
        .upsert({
          user_id: existingUser.id,
          ...userPermissions,
        });

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Existing user promoted to admin',
        userId: existingUser.id
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create invitation for new user (use service client to bypass RLS)
    const { data: invitation, error: inviteError } = await serviceSupabase
      .from('admin_invitations')
      .insert({
        email,
        role,
        invited_by: user.id,
      })
      .select()
      .single();

    if (inviteError) throw inviteError;

    // If setPassword is provided, create the user with that password
    if (setPassword) {
      const { data: newUser, error: createError } = await serviceSupabase.auth.admin.createUser({
        email,
        password: setPassword,
        email_confirm: true,
        user_metadata: { full_name: email.split('@')[0], invited_admin: true }
      });

      if (createError) throw createError;

      // Create profile for new user
      await serviceSupabase
        .from('profiles')
        .insert({
          user_id: newUser.user.id,
          full_name: email.split('@')[0],
        });

      // Add admin role
      await serviceSupabase
        .from('user_roles')
        .insert({ user_id: newUser.user.id, role: 'admin', admin_role: role });

      // Add permissions for the user
      await serviceSupabase
        .from('admin_user_permissions')
        .upsert({
          user_id: newUser.user.id,
          ...userPermissions,
        });

      // Mark invitation as accepted (use service client)
      await serviceSupabase
        .from('admin_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Admin user created with password',
        userId: newUser.user.id
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send invitation email
    const emailResult = await sendInvitationEmail(email, role, invitation.token);
    const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://igmkhxffnyzoogcqvdab.lovableproject.com';
    const inviteUrl = `${frontendUrl}/accept-invite?token=${invitation.token}`;

    // Update invitation with email status and URL (use service client)
    await serviceSupabase
      .from('admin_invitations')
      .update({ 
        email_sent: emailResult.sent,
        invite_url: inviteUrl
      })
      .eq('id', invitation.id);

    return new Response(JSON.stringify({ 
      success: true,
      message: emailResult.sent ? 'Invitation sent' : 'Invitation created (email service unavailable - share link manually)',
      invitationId: invitation.id,
      emailSent: emailResult.sent,
      emailError: emailResult.error,
      inviteUrl: inviteUrl
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[admin-invite-user] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function sendInvitationEmail(email: string, role: string, token: string): Promise<{ sent: boolean; error?: string }> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://igmkhxffnyzoogcqvdab.lovableproject.com';
  const inviteUrl = `${frontendUrl}/accept-invite?token=${token}`;

  if (!RESEND_API_KEY) {
    console.log('[admin-invite-user] RESEND_API_KEY not configured, skipping email');
    return { sent: false, error: 'Email service not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop <noreply@afrishop.com>',
        to: [email],
        subject: 'You have been invited to AfriShop Admin',
        html: `
          <h2>Welcome to AfriShop Admin!</h2>
          <p>You have been invited to join the AfriShop admin team as a <strong>${role}</strong>.</p>
          <p><a href="${inviteUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Accept Invitation</a></p>
          <p>This invitation expires in 7 days.</p>
          <p>If you did not expect this invitation, you can safely ignore this email.</p>
        `,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[admin-invite-user] Resend API error:', errorText);
      return { sent: false, error: `Email failed: ${errorText}` };
    }

    console.log('[admin-invite-user] Email sent successfully to:', email);
    return { sent: true };
  } catch (err: any) {
    console.error('[admin-invite-user] Email send error:', err);
    return { sent: false, error: err.message };
  }
}