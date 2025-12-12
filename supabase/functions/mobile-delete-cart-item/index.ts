import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  corsHeaders, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation: base + (percentage × items subtotal)
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

// Calculate and persist order totals from ACTIVE items only (excluding saved-for-later)
async function updateOrderTotals(
  supabase: any,
  orderId: string,
  shippingBaseFeeUsd: number,
  shippingPercent: number,
  exchangeRate: number
) {
  // CRITICAL FIX: Include is_saved_for_later in query to filter correctly
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('subtotal_usd, markup_fee_usd, total_price_usd, quantity, is_saved_for_later')
    .eq('order_id', orderId);

  if (itemsError) {
    console.error('[updateOrderTotals] Failed to fetch items:', itemsError);
    return null;
  }

  let itemTotalUsd = 0;
  let serviceFeeUsd = 0;
  let itemsWithMarkupUsd = 0;
  let activeItemCount = 0;

  // CRITICAL FIX: Only count ACTIVE items (not saved for later)
  (items || []).forEach((item: any) => {
    if (!item.is_saved_for_later) {
      itemTotalUsd += Number(item.subtotal_usd || 0);
      serviceFeeUsd += Number(item.markup_fee_usd || 0);
      itemsWithMarkupUsd += Number(item.total_price_usd || 0);
      activeItemCount++;
    }
  });

  // Only calculate shipping for active items
  const shippingFeeUsd = activeItemCount > 0 
    ? calculateShipping(itemTotalUsd, shippingBaseFeeUsd, shippingPercent)
    : 0;
  
  const totalUsd = round2(itemsWithMarkupUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);

  console.log('[updateOrderTotals] Calculated totals:', {
    orderId,
    activeItemCount,
    totalItemsInOrder: items?.length || 0,
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
  });

  // REGRESSION GUARD: Log warning if active items exist but total is 0
  if (activeItemCount > 0 && totalUsd === 0) {
    console.warn('[updateOrderTotals] REGRESSION WARNING: Active items exist but totalUsd = 0', {
      orderId,
      activeItemCount,
      itemTotalUsd,
      serviceFeeUsd,
    });
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      item_total_usd: round2(itemTotalUsd),
      service_fee_usd: round2(serviceFeeUsd),
      shipping_fee_usd: round2(shippingFeeUsd),
      total_usd: totalUsd,
      total_cdf: totalCdf,
      exchange_rate_used: exchangeRate,
    })
    .eq('id', orderId);

  if (updateError) {
    console.error('[updateOrderTotals] Failed to update order totals:', updateError);
    return null;
  }

  return {
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
    exchangeRate,
    activeItemCount,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-delete-cart-item] User authenticated:', user.id);

    const url = new URL(req.url);
    const itemId = url.pathname.split('/').pop();

    if (!itemId) {
      return errorResponse('Item ID is required', 400);
    }

    console.log('[mobile-delete-cart-item] Deleting item:', itemId);

    // Verify item belongs to user and is in a DRAFT order
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .select('*, orders!inner(user_id, status, id)')
      .eq('id', itemId)
      .single();

    if (itemError || !item) {
      return errorResponse('Item not found', 404);
    }

    if (item.orders.user_id !== user.id) {
      return errorResponse('Unauthorized', 403);
    }

    if (item.orders.status !== 'DRAFT') {
      return errorResponse('Cannot delete from submitted order', 400);
    }

    const orderId = item.orders.id;

    // Delete the item
    const { error: deleteError } = await supabase
      .from('order_items')
      .delete()
      .eq('id', itemId);

    if (deleteError) {
      console.error('[mobile-delete-cart-item] Delete error:', deleteError);
      return errorResponse('Failed to delete item', 500);
    }

    // Get pricing settings
    const { data: settings } = await supabase.from('settings').select('*').single();
    const exchangeRate = settings?.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings?.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings?.shipping_percent ?? 0.10;

    // UPDATE ORDER TOTALS after deletion
    const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

    console.log('[mobile-delete-cart-item] Updated cart summary:', summary);

    return jsonResponse({ success: true, summary });

  } catch (error: any) {
    console.error('[mobile-delete-cart-item] Error:', error.message);
    
    // Return structured error - NEVER delete other items on transient errors
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false, 
        code: 'AUTH_ERROR', 
        message: error.message 
      }, error.status);
    }
    
    return jsonResponse({ 
      ok: false, 
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem deleting item. Please try again.' 
    }, 500);
  }
});
