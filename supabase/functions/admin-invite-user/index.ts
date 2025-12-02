import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { email, role, setPassword } = await req.json();

    if (!email || !role) {
      return new Response(JSON.stringify({ error: 'Email and role are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[admin-invite-user] Inviting:', email, 'as', role);

    // Check if user already exists
    const { data: existingUsers } = await serviceSupabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    if (existingUser) {
      // User exists - check if already admin
      const { data: existingRole } = await supabase
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

      // Add admin role to existing user
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: existingUser.id, role: 'admin', admin_role: role });

      if (roleError) throw roleError;

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Existing user promoted to admin',
        userId: existingUser.id
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create invitation for new user
    const { data: invitation, error: inviteError } = await supabase
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

      // Mark invitation as accepted
      await supabase
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
    const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://igmkhxffnyzoogcqvdab.lovableproject.com';
    const inviteUrl = `${frontendUrl}/accept-invite?token=${invitation.token}`;

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
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
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Invitation sent',
      invitationId: invitation.id,
      inviteUrl: RESEND_API_KEY ? undefined : inviteUrl // Only return URL if email not sent
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
