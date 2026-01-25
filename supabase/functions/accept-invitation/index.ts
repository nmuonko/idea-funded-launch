import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, password, fullName } = await req.json();

    if (!token || !password) {
      return new Response(JSON.stringify({ error: 'Token and password are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role to bypass RLS
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Validate the invitation token
    const { data: invitation, error: invError } = await serviceSupabase
      .from('admin_invitations')
      .select('id, email, role, status, expires_at')
      .eq('token', token)
      .single();

    if (invError || !invitation) {
      console.log('[accept-invitation] Invalid token:', token?.substring(0, 10) + '...');
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

    // 2. Check if user already exists
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
      // 3. Create the user account using admin API
      const { data: newUser, error: createError } = await serviceSupabase.auth.admin.createUser({
        email: invitation.email,
        password,
        email_confirm: true, // Auto-confirm since they clicked the invitation link
        user_metadata: { 
          full_name: fullName || invitation.email.split('@')[0], 
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

    // 4. Upsert profile
    const { error: profileError } = await serviceSupabase
      .from('profiles')
      .upsert({
        user_id: userId,
        email: invitation.email,
        full_name: fullName || invitation.email.split('@')[0],
        name: fullName || invitation.email.split('@')[0],
      }, { onConflict: 'user_id' });

    if (profileError) {
      console.error('[accept-invitation] Profile upsert error:', profileError);
      // Don't fail - profile might already exist from trigger
    }

    // 5. Add admin role (upsert to handle existing)
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

    // 6. Get default permissions for the role
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

    // 7. Add permissions
    await serviceSupabase
      .from('admin_user_permissions')
      .upsert({
        user_id: userId,
        ...permissions,
      }, { onConflict: 'user_id' });

    // 8. Mark invitation as accepted
    await serviceSupabase
      .from('admin_invitations')
      .update({ 
        status: 'accepted', 
        accepted_at: new Date().toISOString() 
      })
      .eq('id', invitation.id);

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
    return new Response(JSON.stringify({ error: error.message || 'Failed to accept invitation' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
