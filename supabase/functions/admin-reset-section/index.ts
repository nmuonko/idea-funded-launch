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
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create user client for auth
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user is super_admin
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('admin_role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (roleError || !roleData || roleData.admin_role !== 'super_admin') {
      console.log('[Reset Section] Access denied - not super admin:', user.email);
      return new Response(
        JSON.stringify({ error: 'Access denied. Only super admins can reset sections.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { section, confirmationText } = await req.json();

    console.log('[Reset Section] Request:', { section, user: user.email });

    // Validate section name
    const validSections = ['orders', 'payments', 'carts', 'tickets', 'order_actions'];
    if (!validSections.includes(section)) {
      return new Response(
        JSON.stringify({ error: `Invalid section: ${section}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate confirmation text
    const expectedConfirmation = `DELETE ALL ${section.toUpperCase()}`;
    if (confirmationText !== expectedConfirmation) {
      return new Response(
        JSON.stringify({ error: `Confirmation text must be: ${expectedConfirmation}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let deletedCount = 0;

    switch (section) {
      case 'orders': {
        // Delete order_items first (foreign key constraint)
        const { error: itemsError } = await supabaseAdmin
          .from('order_items')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (itemsError) {
          console.error('[Reset Section] Error deleting order_items:', itemsError);
        }

        // Delete order_actions
        const { error: actionsError } = await supabaseAdmin
          .from('order_actions')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (actionsError) {
          console.error('[Reset Section] Error deleting order_actions:', actionsError);
        }

        // Delete maisha_payments
        const { error: paymentsError } = await supabaseAdmin
          .from('maisha_payments')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (paymentsError) {
          console.error('[Reset Section] Error deleting maisha_payments:', paymentsError);
        }

        // Delete orders
        const { data: ordersData, error: ordersError } = await supabaseAdmin
          .from('orders')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000')
          .select('id');

        if (ordersError) throw ordersError;
        deletedCount = ordersData?.length || 0;
        break;
      }

      case 'payments': {
        const { data: paymentsData, error: paymentsError } = await supabaseAdmin
          .from('maisha_payments')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000')
          .select('id');

        if (paymentsError) throw paymentsError;
        deletedCount = paymentsData?.length || 0;
        break;
      }

      case 'carts': {
        // Delete only DRAFT orders (active carts)
        const { data: cartsData, error: itemsError } = await supabaseAdmin
          .from('order_items')
          .delete()
          .eq('is_saved_for_later', false)
          .select('id');

        if (itemsError) throw itemsError;
        deletedCount = cartsData?.length || 0;

        // Delete DRAFT orders
        await supabaseAdmin
          .from('orders')
          .delete()
          .eq('status', 'DRAFT');
        break;
      }

      case 'tickets': {
        // Delete ticket_messages first
        const { error: messagesError } = await supabaseAdmin
          .from('ticket_messages')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (messagesError) {
          console.error('[Reset Section] Error deleting ticket_messages:', messagesError);
        }

        // Delete support_tickets
        const { data: ticketsData, error: ticketsError } = await supabaseAdmin
          .from('support_tickets')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000')
          .select('id');

        if (ticketsError) throw ticketsError;
        deletedCount = ticketsData?.length || 0;
        break;
      }

      case 'order_actions': {
        const { data: actionsData, error: actionsError } = await supabaseAdmin
          .from('order_actions')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000')
          .select('id');

        if (actionsError) throw actionsError;
        deletedCount = actionsData?.length || 0;
        break;
      }
    }

    console.log('[Reset Section] Success:', { section, deletedCount, by: user.email });

    // Log this action to admin_audit_logs
    await supabaseAdmin
      .from('admin_audit_logs')
      .insert({
        admin_id: user.id,
        admin_email: user.email,
        action_type: 'reset_section',
        target_section: section,
        details: { deleted_count: deletedCount }
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        section, 
        deletedCount,
        message: `Successfully deleted ${deletedCount} ${section} records` 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[Reset Section Error]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
