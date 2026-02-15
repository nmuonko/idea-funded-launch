import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { createErrorResponse } from "../_shared/errorSanitizer.ts";

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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has admin role
    const { data: roleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      console.log('[Bulk Delete Orders] Access denied - user is not admin:', user.email);
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderIds } = await req.json();

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'orderIds array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (orderIds.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Maximum 100 orders per batch' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Bulk Delete Orders] Admin: ${user.email} deleting ${orderIds.length} orders`);

    // 1. Get order details for audit log
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, status, user_id, total_usd, created_at')
      .in('id', orderIds);

    if (ordersError) {
      console.error('[Bulk Delete Orders] Error fetching orders:', ordersError);
      throw ordersError;
    }

    const foundIds = (orders || []).map(o => o.id);
    if (foundIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No orders found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get order item IDs for quote_requests cleanup
    const { data: items } = await supabaseAdmin
      .from('order_items')
      .select('id')
      .in('order_id', foundIds);

    // 3. Get manual transfer session IDs for proofs cleanup
    const { data: sessions } = await supabaseAdmin
      .from('manual_transfer_sessions')
      .select('id')
      .in('order_id', foundIds);

    // 4. Bulk delete from all child tables (order matters for FK deps)
    // Delete quote_requests via item IDs
    if (items && items.length > 0) {
      await supabaseAdmin
        .from('quote_requests')
        .delete()
        .in('order_item_id', items.map(i => i.id));
    }

    // Delete manual_transfer_proofs via session IDs
    if (sessions && sessions.length > 0) {
      await supabaseAdmin
        .from('manual_transfer_proofs')
        .delete()
        .in('session_id', sessions.map(s => s.id));
    }

    // Delete all direct child tables in parallel
    await Promise.all([
      supabaseAdmin.from('order_actions').delete().in('order_id', foundIds),
      supabaseAdmin.from('order_items').delete().in('order_id', foundIds),
      supabaseAdmin.from('payments').delete().in('order_id', foundIds),
      supabaseAdmin.from('maisha_payments').delete().in('order_id', foundIds),
      supabaseAdmin.from('checkout_sessions').delete().in('order_id', foundIds),
      supabaseAdmin.from('payment_attempts').delete().in('order_id', foundIds),
      supabaseAdmin.from('manual_transfer_sessions').delete().in('order_id', foundIds),
      supabaseAdmin.from('bank_transfer_view_tokens').delete().in('order_id', foundIds),
      supabaseAdmin.from('payment_links').delete().in('order_id', foundIds),
      supabaseAdmin.from('cart_recovery_ab_tests').delete().in('order_id', foundIds),
      supabaseAdmin.from('cart_recovery_predictions').delete().in('order_id', foundIds),
    ]);

    // 5. Delete the orders themselves
    const { error: deleteError } = await supabaseAdmin
      .from('orders')
      .delete()
      .in('id', foundIds);

    if (deleteError) {
      console.error('[Bulk Delete Orders] Error deleting orders:', deleteError);
      throw deleteError;
    }

    // 6. Batch insert audit logs
    const auditLogs = (orders || []).map(order => ({
      admin_id: user.id,
      admin_email: user.email,
      action_type: 'DELETE_ORDER',
      target_id: order.id,
      target_section: 'orders',
      details: {
        order_status: order.status,
        order_total_usd: order.total_usd,
        order_created_at: order.created_at,
        order_user_id: order.user_id,
        bulk_delete: true,
        batch_size: foundIds.length,
      }
    }));

    await supabaseAdmin.from('admin_audit_logs').insert(auditLogs);

    console.log(`[Bulk Delete Orders] Successfully deleted ${foundIds.length} orders`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        deleted: foundIds.length,
        notFound: orderIds.length - foundIds.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return createErrorResponse(error, 'admin-bulk-delete-orders', corsHeaders);
  }
});
