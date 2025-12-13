import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Cleanup Expired Carts
 * 
 * Removes DRAFT orders older than 30 days, EXCEPT:
 * - Orders with vehicle items (is_vehicle = true)
 * - Orders with pending quote requests
 * 
 * This ensures vehicle quotes are never lost due to automatic cleanup.
 */
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

    // First, find order IDs that have vehicle items - these are EXEMPT from cleanup
    const { data: vehicleOrders, error: vehicleError } = await supabase
      .from('order_items')
      .select('order_id')
      .eq('is_vehicle', true);

    if (vehicleError) {
      console.error('[cleanup-expired-carts] Error fetching vehicle orders:', vehicleError);
    }

    const vehicleOrderIds = new Set((vehicleOrders || []).map(o => o.order_id));
    console.log('[cleanup-expired-carts] Orders with vehicles (EXEMPT):', vehicleOrderIds.size);

    // Also find orders with pending quote requests - these are EXEMPT
    const { data: quoteOrders, error: quoteError } = await supabase
      .from('quote_requests')
      .select('order_item_id, order_items!inner(order_id)')
      .in('status', ['PENDING', 'SENT']);

    if (quoteError) {
      console.error('[cleanup-expired-carts] Error fetching quote orders:', quoteError);
    }

    const quoteOrderIds = new Set(
      (quoteOrders || [])
        .map(q => (q.order_items as any)?.order_id)
        .filter(Boolean)
    );
    console.log('[cleanup-expired-carts] Orders with pending quotes (EXEMPT):', quoteOrderIds.size);

    // Combine exempt orders
    const exemptOrderIds = new Set([...vehicleOrderIds, ...quoteOrderIds]);
    console.log('[cleanup-expired-carts] Total exempt orders:', exemptOrderIds.size);

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
        ok: true,
        message: 'No expired carts to clean up',
        deletedCount: 0,
        exemptCount: exemptOrderIds.size
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter out exempt orders (those with vehicles or pending quotes)
    const ordersToDelete = expiredOrders
      .filter(o => !exemptOrderIds.has(o.id))
      .map(o => o.id);

    const exemptedCount = expiredOrders.length - ordersToDelete.length;

    console.log('[cleanup-expired-carts] Found', expiredOrders.length, 'expired carts');
    console.log('[cleanup-expired-carts] Exempted', exemptedCount, 'carts with vehicles/quotes');
    console.log('[cleanup-expired-carts] Will delete', ordersToDelete.length, 'carts');

    if (ordersToDelete.length === 0) {
      console.log('[cleanup-expired-carts] All expired carts are exempt');
      return new Response(JSON.stringify({ 
        ok: true,
        message: 'All expired carts are exempt (have vehicles or pending quotes)',
        deletedCount: 0,
        exemptCount: exemptedCount,
        totalExpired: expiredOrders.length
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delete order items first (due to foreign key constraint)
    const { error: itemsDeleteError } = await supabase
      .from('order_items')
      .delete()
      .in('order_id', ordersToDelete);

    if (itemsDeleteError) {
      console.error('[cleanup-expired-carts] Error deleting order items:', itemsDeleteError);
      throw itemsDeleteError;
    }

    // Delete the orders
    const { error: ordersDeleteError } = await supabase
      .from('orders')
      .delete()
      .in('id', ordersToDelete);

    if (ordersDeleteError) {
      console.error('[cleanup-expired-carts] Error deleting orders:', ordersDeleteError);
      throw ordersDeleteError;
    }

    console.log('[cleanup-expired-carts] Successfully deleted', ordersToDelete.length, 'expired carts');

    return new Response(JSON.stringify({ 
      ok: true,
      message: 'Cleanup successful',
      deletedCount: ordersToDelete.length,
      exemptCount: exemptedCount,
      totalExpired: expiredOrders.length,
      deletedOrderIds: ordersToDelete
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[cleanup-expired-carts] Error:', error);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});