import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

/**
 * POST /functions/v1/claim-guest-confirmations
 * 
 * Claims guest price confirmations after user login.
 * Updates price_confirmations and order_items where device_id matches
 * and user_id is null.
 * 
 * Input: { device_id: string }
 * Output: { success: true, claimed: { confirmations: number, order_items: number } }
 */

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Auth required for claiming
    const { user, supabase } = await verifyAndGetUser(req);

    const body = await req.json();
    const deviceId = body.device_id ?? body.deviceId;

    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 10) {
      return errorResponse('Valid device_id is required (min 10 characters)', 400);
    }

    console.log('[claim-guest-confirmations] Claiming for user:', user.id, 'device:', deviceId.substring(0, 8) + '...');

    // 1. Claim price_confirmations - update user_id where device_id matches and user_id is null
    const { data: claimedConfirmations, error: pcError } = await supabase
      .from('price_confirmations')
      .update({ 
        user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('device_id', deviceId)
      .is('user_id', null)
      .select('id, cart_item_id, product_url, status');

    if (pcError) {
      console.error('[claim-guest-confirmations] Error claiming confirmations:', pcError);
      return errorResponse('Failed to claim price confirmations', 500);
    }

    const confirmationsCount = claimedConfirmations?.length ?? 0;
    console.log('[claim-guest-confirmations] Claimed confirmations:', confirmationsCount);

    // 2. Claim order_items with matching device_id (guest cart items)
    // This links any guest cart items to the now-authenticated user
    const { data: claimedItems, error: itemsError } = await supabase
      .from('order_items')
      .update({
        // Note: order_items doesn't have user_id directly, but we can track the device linkage
        updated_at: new Date().toISOString(),
      })
      .eq('device_id', deviceId)
      .select('id, order_id');

    if (itemsError) {
      console.error('[claim-guest-confirmations] Error updating order items:', itemsError);
      // Don't fail - confirmations were claimed successfully
    }

    const itemsCount = claimedItems?.length ?? 0;
    console.log('[claim-guest-confirmations] Updated order items:', itemsCount);

    // 3. For any claimed confirmations with cart_item_id, link the confirmation_id back to the order_item
    if (claimedConfirmations && claimedConfirmations.length > 0) {
      for (const conf of claimedConfirmations) {
        if (conf.cart_item_id) {
          await supabase
            .from('order_items')
            .update({ price_confirmation_id: conf.id })
            .eq('id', conf.cart_item_id);
        }
      }
    }

    return jsonResponse({
      success: true,
      claimed: {
        confirmations: confirmationsCount,
        order_items: itemsCount,
      },
      details: {
        confirmation_ids: claimedConfirmations?.map(c => c.id) ?? [],
        statuses: claimedConfirmations?.map(c => c.status) ?? [],
      },
    });

  } catch (error: any) {
    console.error('[claim-guest-confirmations] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false, 
        code: 'AUTH_REQUIRED', 
        message: 'Authentication required to claim guest confirmations' 
      }, 401);
    }
    
    return errorResponse(error.message || 'An error occurred', 500);
  }
});
