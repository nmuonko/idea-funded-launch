import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";
import { getCachedSettings } from "../_shared/settings-cache.ts";
import { updateOrderTotals } from "../_shared/cartHelpers.ts";

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
      return jsonResponse({ success: false, code: 'INVALID_REQUEST', message: 'Item ID is required' }, 400);
    }

    console.log('[mobile-delete-cart-item] Deleting item:', itemId);

    // Get cached pricing settings FIRST - we'll need this for any response
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

    // Find user's current DRAFT order
    const { data: draftOrder, error: draftError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftError) {
      console.error('[mobile-delete-cart-item] Error finding draft order:', draftError);
      return jsonResponse({ success: false, code: 'DB_ERROR', message: 'Failed to find cart' }, 500);
    }

    // If no DRAFT order exists, item is effectively "already deleted"
    if (!draftOrder) {
      console.log('[mobile-delete-cart-item] No DRAFT order found, returning empty cart');
      return jsonResponse({ 
        success: true, 
        itemId,
        status: 'already_deleted',
        message: 'Item already removed (no active cart)',
        summary: {
          itemsTotal: 0,
          markupFeeUsd: 0,
          shippingFeeUsd: 0,
          totalUsd: 0,
          totalCdf: 0,
          exchangeRate,
          itemCount: 0
        }
      });
    }

    const orderId = draftOrder.id;

    // Check if item exists in THIS order
    const { data: item, error: itemError } = await supabase
      .from('order_items')
      .select('id')
      .eq('id', itemId)
      .eq('order_id', orderId)
      .maybeSingle();

    if (itemError) {
      console.error('[mobile-delete-cart-item] Error checking item:', itemError);
      return jsonResponse({ success: false, code: 'DB_ERROR', message: 'Failed to check item' }, 500);
    }

    // IDEMPOTENT: If item not found in this order, return success with current summary
    if (!item) {
      console.log('[mobile-delete-cart-item] Item not found in order, returning current summary');
      
      // Still recalculate and return current cart state
      const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);
      
      return jsonResponse({ 
        success: true, 
        itemId,
        status: 'already_deleted',
        message: 'Item already removed',
        summary: {
          itemsTotal: summary?.itemTotalUsd ?? 0,
          markupFeeUsd: summary?.serviceFeeUsd ?? 0,
          shippingFeeUsd: summary?.shippingFeeUsd ?? 0,
          totalUsd: summary?.totalUsd ?? 0,
          totalCdf: summary?.totalCdf ?? 0,
          exchangeRate: summary?.exchangeRate ?? exchangeRate,
          itemCount: summary?.activeItemCount ?? 0
        }
      });
    }

    // Delete the item
    const { error: deleteError } = await supabase
      .from('order_items')
      .delete()
      .eq('id', itemId)
      .eq('order_id', orderId);

    if (deleteError) {
      console.error('[mobile-delete-cart-item] Delete error:', deleteError);
      return jsonResponse({ success: false, code: 'DB_ERROR', message: 'Failed to delete item' }, 500);
    }

    // UPDATE ORDER TOTALS after deletion using shared helper
    const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

    console.log('[mobile-delete-cart-item] Deleted item, updated summary:', summary);

    return jsonResponse({ 
      success: true, 
      itemId,
      status: 'deleted',
      summary: {
        itemsTotal: summary?.itemTotalUsd ?? 0,
        markupFeeUsd: summary?.serviceFeeUsd ?? 0,
        shippingFeeUsd: summary?.shippingFeeUsd ?? 0,
        totalUsd: summary?.totalUsd ?? 0,
        totalCdf: summary?.totalCdf ?? 0,
        exchangeRate: summary?.exchangeRate ?? exchangeRate,
        itemCount: summary?.activeItemCount ?? 0
      }
    });

  } catch (error: any) {
    console.error('[mobile-delete-cart-item] Error:', error.message);
    
    // Return structured error with success: false (not ok: false)
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        success: false, 
        code: 'AUTH_ERROR', 
        message: error.message 
      }, error.status || 401);
    }
    
    return jsonResponse({ 
      success: false, 
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem. Please try again.' 
    }, 500);
  }
});
