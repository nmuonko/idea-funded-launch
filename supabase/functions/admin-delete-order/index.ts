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
      console.log('[Delete Order] Access denied - user is not admin:', user.email);
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Delete Order] Admin:', user.email, 'deleting order:', orderId);

    // Get order details before deletion for audit log
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, status, user_id, total_usd, created_at')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('[Delete Order] Error fetching order:', orderError);
      throw orderError;
    }

    if (!order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete related records first (in order of dependencies)
    // 1. Delete order_actions
    await supabaseAdmin
      .from('order_actions')
      .delete()
      .eq('order_id', orderId);

    // 2. Delete order_items
    await supabaseAdmin
      .from('order_items')
      .delete()
      .eq('order_id', orderId);

    // 3. Delete payments related to this order
    await supabaseAdmin
      .from('payments')
      .delete()
      .eq('order_id', orderId);

    // 4. Delete maisha_payments
    await supabaseAdmin
      .from('maisha_payments')
      .delete()
      .eq('order_id', orderId);

    // 5. Delete checkout_sessions
    await supabaseAdmin
      .from('checkout_sessions')
      .delete()
      .eq('order_id', orderId);

    // 6. Delete payment_attempts
    await supabaseAdmin
      .from('payment_attempts')
      .delete()
      .eq('order_id', orderId);

    // 7. Delete manual_transfer_sessions and proofs
    const { data: sessions } = await supabaseAdmin
      .from('manual_transfer_sessions')
      .select('id')
      .eq('order_id', orderId);

    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id);
      await supabaseAdmin
        .from('manual_transfer_proofs')
        .delete()
        .in('session_id', sessionIds);
      
      await supabaseAdmin
        .from('manual_transfer_sessions')
        .delete()
        .eq('order_id', orderId);
    }

    // 8. Delete bank_transfer_view_tokens
    await supabaseAdmin
      .from('bank_transfer_view_tokens')
      .delete()
      .eq('order_id', orderId);

    // 9. Delete payment_links
    await supabaseAdmin
      .from('payment_links')
      .delete()
      .eq('order_id', orderId);

    // 10. Delete cart_recovery related
    await supabaseAdmin
      .from('cart_recovery_ab_tests')
      .delete()
      .eq('order_id', orderId);

    await supabaseAdmin
      .from('cart_recovery_predictions')
      .delete()
      .eq('order_id', orderId);

    // 11. Delete quote_requests for order items
    const { data: items } = await supabaseAdmin
      .from('order_items')
      .select('id')
      .eq('order_id', orderId);

    if (items && items.length > 0) {
      await supabaseAdmin
        .from('quote_requests')
        .delete()
        .in('order_item_id', items.map(i => i.id));
    }

    // Finally delete the order itself
    const { error: deleteError } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (deleteError) {
      console.error('[Delete Order] Error deleting order:', deleteError);
      throw deleteError;
    }

    // Log the deletion in audit log
    await supabaseAdmin
      .from('admin_audit_logs')
      .insert({
        admin_id: user.id,
        admin_email: user.email,
        action_type: 'DELETE_ORDER',
        target_id: orderId,
        target_section: 'orders',
        details: {
          order_status: order.status,
          order_total_usd: order.total_usd,
          order_created_at: order.created_at,
          order_user_id: order.user_id
        }
      });

    console.log('[Delete Order] Successfully deleted order:', orderId);

    return new Response(
      JSON.stringify({ success: true, message: 'Order deleted successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return createErrorResponse(error, 'admin-delete-order', corsHeaders);
  }
});
