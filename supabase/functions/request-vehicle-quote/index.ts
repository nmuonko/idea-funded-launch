import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";
import { notifyAdmin } from "../_shared/email.ts";

/**
 * Request Vehicle Quote Edge Function
 * 
 * Creates quote requests for VEHICLE cart items that require manual shipping quotes.
 * This is triggered when the mobile app user taps "Demander un devis" in the cart.
 * 
 * IMPORTANT: Only processes items where is_vehicle = true.
 * Non-vehicle items should never require a quote and go through normal checkout.
 * 
 * POST /request-vehicle-quote
 * Body: { 
 *   cartId?: string,         // Optional - the cart/order ID (uses DRAFT order if not provided)
 *   cartItemIds?: string[],  // Optional - if not provided, auto-detects vehicle items
 *   locale?: string          // Optional - user's preferred language (fr/en)
 * }
 * 
 * Returns:
 * - { success: true, quoteId: "uuid", status: "pending", items_count: N }
 * - { success: false, error: "NO_VEHICLE_ITEMS", code: "NO_VEHICLE_ITEMS" }
 */

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    console.log('[request-vehicle-quote] Request received');

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[request-vehicle-quote] User authenticated:', user.id);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { cartId, cartItemIds, locale = 'fr' } = body;

    console.log('[request-vehicle-quote] Request body:', { cartId, cartItemIds, locale });

    // Get user's profile for email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, language')
      .eq('user_id', user.id)
      .maybeSingle();

    const userEmail = profile?.email || user.email;
    const userLocale = locale || profile?.language || 'fr';

    // Get user's DRAFT order (cart) - either by cartId or find existing DRAFT
    let orderId = cartId;
    
    if (!orderId) {
      const { data: existingOrder, error: orderFetchError } = await supabase
        .from('orders')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'DRAFT')
        .maybeSingle();

      if (orderFetchError) {
        console.error('[request-vehicle-quote] Error fetching draft order:', orderFetchError);
        return jsonResponse({ 
          success: false,
          error: 'Failed to fetch cart data.',
          code: 'CART_FETCH_ERROR'
        }, 500);
      }

      if (!existingOrder) {
        console.log('[request-vehicle-quote] No DRAFT order found for user:', user.id);
        return jsonResponse({ 
          success: false,
          error: 'Your cart is empty or not synced. Please sync your cart first.',
          code: 'EMPTY_CART'
        }, 400);
      }

      orderId = existingOrder.id;
    } else {
      // Verify the provided cartId belongs to this user
      const { data: orderCheck, error: checkError } = await supabase
        .from('orders')
        .select('id, user_id')
        .eq('id', cartId)
        .maybeSingle();

      if (checkError || !orderCheck) {
        console.error('[request-vehicle-quote] Cart not found:', cartId);
        return jsonResponse({ 
          success: false,
          error: 'Cart not found.',
          code: 'INVALID_CART_ID'
        }, 400);
      }

      if (orderCheck.user_id !== user.id) {
        console.error('[request-vehicle-quote] Cart does not belong to user');
        return jsonResponse({ 
          success: false,
          error: 'You do not have access to this cart.',
          code: 'FORBIDDEN'
        }, 403);
      }
    }

    // Get cart items - either specified ones or auto-detect vehicle items
    let itemsQuery = supabase
      .from('order_items')
      .select('id, title, product_url, store, requires_manual_quote, base_price_usd, is_vehicle, vehicle_quote_applied')
      .eq('order_id', orderId)
      .eq('is_saved_for_later', false);

    // If specific cart item IDs provided, filter to those
    if (cartItemIds && Array.isArray(cartItemIds) && cartItemIds.length > 0) {
      itemsQuery = itemsQuery.in('id', cartItemIds);
    }

    const { data: requestedItems, error: itemsError } = await itemsQuery;

    if (itemsError) {
      console.error('[request-vehicle-quote] Error fetching items:', itemsError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to fetch cart items.',
        code: 'ITEMS_FETCH_ERROR'
      }, 500);
    }

    if (!requestedItems || requestedItems.length === 0) {
      return jsonResponse({ 
        success: false,
        error: 'No cart items found.',
        code: 'NO_ITEMS'
      }, 400);
    }

    // CRITICAL: Filter to only VEHICLE items (is_vehicle = true)
    // Non-vehicle items should NEVER require a quote
    const vehicleItems = requestedItems.filter(item => 
      item.is_vehicle === true && item.vehicle_quote_applied !== true
    );
    
    if (vehicleItems.length === 0) {
      console.log('[request-vehicle-quote] No vehicle items found in cart');
      return jsonResponse({ 
        success: false,
        error: 'No vehicle items requiring a quote were found in your cart.',
        code: 'NO_VEHICLE_ITEMS'
      }, 400);
    }

    console.log('[request-vehicle-quote] Found', vehicleItems.length, 'vehicle items requiring quote');

    // Check for existing quote requests to build a lookup map
    const itemIds = vehicleItems.map(item => item.id);
    const { data: priorQuotes, error: priorError } = await supabase
      .from('quote_requests')
      .select('id, order_item_id, status')
      .in('order_item_id', itemIds);

    if (priorError) {
      console.error('[request-vehicle-quote] Error checking existing quotes:', priorError);
    }

    const existingQuoteMap = new Map(
      (priorQuotes || []).map(q => [q.order_item_id, q])
    );

    // UPSERT quote requests - prevents duplicates due to unique constraint on order_item_id
    const quoteResponses: any[] = [];

    for (const item of vehicleItems) {
      const existingQuote = existingQuoteMap.get(item.id);
      
      // Use upsert to handle both new and existing quotes safely
      const quoteData = {
        user_id: user.id,
        order_item_id: item.id,
        title: item.title,
        product_url: item.product_url,
        store_name: item.store,
        status: existingQuote?.status || 'PENDING', // Preserve existing status
        locale: userLocale,
        customer_email: userEmail,
        updated_at: new Date().toISOString(),
      };

      const { data: upsertedQuote, error: upsertError } = await supabase
        .from('quote_requests')
        .upsert(quoteData, { 
          onConflict: 'order_item_id',
          ignoreDuplicates: false 
        })
        .select('id, order_item_id, status')
        .single();

      if (upsertError) {
        console.error('[request-vehicle-quote] Error upserting quote for item:', item.id, upsertError);
        // Continue with other items, don't fail entire request
        continue;
      }

      quoteResponses.push({
        quoteRequestId: upsertedQuote.id,
        orderItemId: upsertedQuote.order_item_id,
        title: item.title,
        status: upsertedQuote.status,
        isExisting: !!existingQuote,
      });
    }

    // Count new vs existing for admin notification
    const newQuotes = quoteResponses.filter(q => !q.isExisting);
    const updatedQuotes = quoteResponses.filter(q => q.isExisting);

    // Send admin notification only for NEW quote requests
    if (newQuotes.length > 0) {

      try {
        const itemsList = newQuotes.map(q => 
          `<li><strong>${q.title || 'Item'}</strong><br/></li>`
        ).join('');

        const emailHtml = `
          <h2>🚗 New Vehicle Quote Request</h2>
          <p>A customer has requested a quote for the following vehicle(s):</p>
          <ul>${itemsList}</ul>
          <p>Customer Email: ${userEmail}</p>
          <p><a href="https://afrishop-usa.com/admin/quote-requests">View in Admin Panel</a></p>
        `;

        await notifyAdmin(
          `New Vehicle Quote Request (${newQuotes.length} item${newQuotes.length > 1 ? 's' : ''})`,
          emailHtml,
          'quote_request'
        );
        console.log('[request-vehicle-quote] Admin notification sent for', newQuotes.length, 'new quotes');
      } catch (emailErr) {
        console.error('[request-vehicle-quote] Failed to send admin notification:', emailErr);
        // Don't fail the request if email fails
      }
    }
    
    console.log('[request-vehicle-quote] Quote requests processed:', {
      total: quoteResponses.length,
      new: newQuotes.length,
      existing: updatedQuotes.length,
    });

    // Return success response with clear structure
    const primaryQuoteId = quoteResponses[0]?.quoteRequestId;
    
    return jsonResponse({
      success: true,
      quoteId: primaryQuoteId,
      quote_id: primaryQuoteId, // Alias for compatibility
      status: newQuotes.length > 0 ? 'pending' : (quoteResponses[0]?.status || 'pending'),
      items_count: quoteResponses.length,
      message: newQuotes.length > 0 
        ? 'Quote request submitted. We will contact you with pricing.'
        : 'Quote request already exists.',
      quoteRequests: quoteResponses,
      cartId: orderId,
      newRequestsCreated: newQuotes.length,
      existingRequestsFound: updatedQuotes.length,
    });

  } catch (error: any) {
    console.error('[request-vehicle-quote] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ success: false, error: error.message, code: 'AUTH_ERROR' }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      error: 'An unexpected error occurred. Please try again.',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
});
