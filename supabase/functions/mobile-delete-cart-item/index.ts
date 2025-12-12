import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
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

    // Get cached pricing settings
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

    // UPDATE ORDER TOTALS after deletion using shared helper
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
