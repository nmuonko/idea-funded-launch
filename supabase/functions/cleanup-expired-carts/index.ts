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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[cleanup-expired-carts] Starting cleanup process');

    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find old DRAFT orders
    const { data: expiredOrders, error: fetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('status', 'DRAFT')
      .lt('updated_at', thirtyDaysAgo.toISOString());

    if (fetchError) {
      console.error('[cleanup-expired-carts] Error fetching expired carts:', fetchError);
      throw fetchError;
    }

    if (!expiredOrders || expiredOrders.length === 0) {
      console.log('[cleanup-expired-carts] No expired carts found');
      return new Response(JSON.stringify({ 
        message: 'No expired carts to clean up',
        deletedCount: 0 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const orderIds = expiredOrders.map(o => o.id);
    console.log('[cleanup-expired-carts] Found expired carts:', orderIds.length);

    // Delete order items first (due to foreign key constraint)
    const { error: itemsDeleteError } = await supabase
      .from('order_items')
      .delete()
      .in('order_id', orderIds);

    if (itemsDeleteError) {
      console.error('[cleanup-expired-carts] Error deleting order items:', itemsDeleteError);
      throw itemsDeleteError;
    }

    // Delete the orders
    const { error: ordersDeleteError } = await supabase
      .from('orders')
      .delete()
      .in('id', orderIds);

    if (ordersDeleteError) {
      console.error('[cleanup-expired-carts] Error deleting orders:', ordersDeleteError);
      throw ordersDeleteError;
    }

    console.log('[cleanup-expired-carts] Successfully deleted', orderIds.length, 'expired carts');

    return new Response(JSON.stringify({ 
      message: 'Cleanup successful',
      deletedCount: orderIds.length,
      deletedOrderIds: orderIds
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[cleanup-expired-carts] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
