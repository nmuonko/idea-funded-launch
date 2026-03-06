import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify admin auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin');

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { item_id, order_id, shipping_status, send_email } = body;

    if (!item_id && !order_id) {
      return new Response(JSON.stringify({ error: 'item_id or order_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!shipping_status || !['pending', 'shipped', 'delivered'].includes(shipping_status)) {
      return new Response(JSON.stringify({ error: 'Valid shipping_status required (pending, shipped, delivered)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let updatedItems: any[] = [];
    let targetOrderId = order_id;

    if (item_id) {
      // Update single item
      const { data: item, error: itemError } = await supabase
        .from('order_items')
        .update({ shipping_status })
        .eq('id', item_id)
        .select('*, orders(id, user_id, status, profiles(name, email))')
        .single();

      if (itemError) throw itemError;
      updatedItems = [item];
      targetOrderId = item.order_id;
    } else if (order_id) {
      // Update all items in order
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .update({ shipping_status })
        .eq('order_id', order_id)
        .select('*');

      if (itemsError) throw itemsError;
      updatedItems = items || [];
    }

    // Get order details for email
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        profiles(name, email),
        order_items(id, shipping_status)
      `)
      .eq('id', targetOrderId)
      .single();

    if (orderError) throw orderError;

    // Check if all items have the same status to update order status
    const allItemStatuses = order.order_items.map((i: any) => i.shipping_status);
    const allShipped = allItemStatuses.every((s: string) => s === 'shipped' || s === 'delivered');
    const allDelivered = allItemStatuses.every((s: string) => s === 'delivered');

    let newOrderStatus = order.status;
    if (allDelivered && order.status !== 'COMPLETED') {
      newOrderStatus = 'COMPLETED';
    } else if (allShipped && order.status !== 'SHIPPED' && order.status !== 'COMPLETED') {
      newOrderStatus = 'SHIPPED';
    }

    // Update order status if needed
    if (newOrderStatus !== order.status) {
      const updateData: any = { status: newOrderStatus };
      if (newOrderStatus === 'SHIPPED') {
        updateData.shipped_at = new Date().toISOString();
      } else if (newOrderStatus === 'COMPLETED') {
        updateData.delivered_at = new Date().toISOString();
      }

      await supabase
        .from('orders')
        .update(updateData)
        .eq('id', targetOrderId);
    }

    // Send email notification if requested
    if (send_email && order.profiles?.email) {
      const emailType = shipping_status === 'shipped' ? 'shipped' : shipping_status === 'delivered' ? 'delivered' : null;
      
      if (emailType) {
        try {
          await supabase.functions.invoke(`send-order-${emailType}-email`, {
            body: {
              orderId: targetOrderId,
              customerEmail: order.profiles.email,
              customerName: order.profiles.name || 'Customer',
              items: updatedItems.map(i => ({
                title: i.title,
                quantity: i.quantity,
              })),
            },
          });
          console.log(`[admin-update-item-status] ${emailType} email sent to ${order.profiles.email}`);
        } catch (emailError: any) {
          console.error('[admin-update-item-status] Email error:', emailError.message);
          // Don't fail the whole request if email fails
        }
      }
    }

    // Log the action
    await supabase.from('order_actions').insert({
      order_id: targetOrderId,
      actor_id: user.id,
      action_type: 'ITEM_STATUS_UPDATE',
      action_message: `Updated ${item_id ? '1 item' : 'all items'} to ${shipping_status}`,
      metadata: {
        item_id,
        shipping_status,
        send_email,
        updated_count: updatedItems.length,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      updatedCount: updatedItems.length,
      orderStatus: newOrderStatus,
      message: `Updated ${updatedItems.length} item(s) to ${shipping_status}`,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[admin-update-item-status] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
