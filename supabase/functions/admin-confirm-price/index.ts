import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { 
  handleCors, 
  errorResponse, 
  jsonResponse,
  verifyAndGetUser,
} from "../_shared/auth.ts";

// Input validation schema
const confirmPriceSchema = z.object({
  cart_item_id: z.string().uuid("Invalid cart item ID"),
  approved_price: z.number().positive("Approved price must be positive"),
  currency: z.string().optional().default('USD'),
});

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify admin authentication
    const { user, supabase } = await verifyAndGetUser(req);

    // Check if user is an admin
    const { data: userRole, error: roleError } = await supabase
      .from('user_roles')
      .select('role, admin_role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError) {
      console.error('[admin-confirm-price] Role check error:', roleError);
      return errorResponse('Failed to verify admin status', 500);
    }

    if (!userRole) {
      console.warn('[admin-confirm-price] Unauthorized access attempt by:', user.id);
      return errorResponse('Unauthorized: Admin access required', 403);
    }

    console.log('[admin-confirm-price] Admin verified:', user.id, 'role:', userRole.admin_role || 'admin');

    // Parse and validate input
    const body = await req.json();
    const parseResult = confirmPriceSchema.safeParse(body);
    
    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors.map(e => e.message).join(', ');
      console.log('[admin-confirm-price] Validation error:', errorMessage);
      return errorResponse(errorMessage, 400);
    }

    const { cart_item_id, approved_price, currency } = parseResult.data;

    console.log('[admin-confirm-price] Processing:', { cart_item_id, approved_price, currency });

    // Fetch cart item to get user_id and product info
    const { data: cartItem, error: itemError } = await supabase
      .from('order_items')
      .select('id, title, store, product_url, base_price_usd, captured_price, orders!inner(user_id)')
      .eq('id', cart_item_id)
      .single();

    if (itemError || !cartItem) {
      console.error('[admin-confirm-price] Cart item not found:', itemError);
      return errorResponse('Cart item not found', 404);
    }

    // Access joined order data
    const orderData = cartItem.orders as unknown as { user_id: string };
    const userId = orderData.user_id;

    console.log('[admin-confirm-price] Cart item found:', {
      itemId: cartItem.id,
      title: cartItem.title,
      userId,
      originalPrice: cartItem.base_price_usd,
      capturedPrice: cartItem.captured_price,
      approvedPrice: approved_price,
    });

    // Update cart item with approved price
    const { error: updateError } = await supabase
      .from('order_items')
      .update({
        base_price_usd: approved_price,
        unit_price_usd: approved_price,
        price_confirmation_status: 'APPROVED',
        price_source: 'admin_confirmed',
        admin_adjusted_price: approved_price,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cart_item_id);

    if (updateError) {
      console.error('[admin-confirm-price] Update error:', updateError);
      return errorResponse('Failed to update cart item', 500);
    }

    console.log('[admin-confirm-price] Cart item updated successfully');

    // Create user notification
    const productName = cartItem.title || cartItem.store || 'your item';
    const { error: notifError } = await supabase
      .from('user_notifications')
      .insert({
        user_id: userId,
        type: 'PRICE_CONFIRMED',
        title: 'Price confirmed',
        body: `Your edited price for "${productName}" has been confirmed. You can now proceed to checkout.`,
        payload: {
          cart_item_id,
          approved_price,
          currency,
          original_price: cartItem.base_price_usd,
          captured_price: cartItem.captured_price,
        },
      });

    if (notifError) {
      console.error('[admin-confirm-price] Failed to create user notification:', notifError);
      // Don't fail the operation - the main task succeeded
    } else {
      console.log('[admin-confirm-price] User notification created for:', userId);
    }

    // Mark any related admin notifications as read
    const { error: adminNotifError } = await supabase
      .from('admin_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('type', 'PRICE_REVIEW')
      .contains('payload', { cart_item_id });

    if (adminNotifError) {
      console.warn('[admin-confirm-price] Failed to mark admin notification as read:', adminNotifError);
    }

    return jsonResponse({
      success: true,
      message: 'Price confirmed successfully',
      data: {
        cart_item_id,
        approved_price,
        currency,
        user_notified: !notifError,
      },
    });

  } catch (error: any) {
    console.error('[admin-confirm-price] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse('Authentication required', 401);
    }
    
    return errorResponse(error.message || 'An error occurred', 500);
  }
});
