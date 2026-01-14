import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";
import { notifyAdmin } from "../_shared/email.ts";

/**
 * Mobile Request Quote Edge Function
 * 
 * Creates quote requests for VEHICLE cart items that require manual shipping quotes.
 * This is triggered when the mobile app user taps "Demander un devis" in the cart.
 * 
 * IMPORTANT: Only processes items where is_vehicle = true.
 * Non-vehicle items should never require a quote and go through normal checkout.
 * 
 * POST /mobile-request-quote
 * Body: { 
 *   cartItemIds?: string[],  // Optional - if not provided, auto-detects vehicle items
 *   locale?: string          // Optional - user's preferred language (fr/en)
 * }
 * 
 * Returns:
 * - { success: true, quote_id: "uuid", status: "pending", items_count: N }
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
    console.log('[mobile-request-quote] Request received');

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-request-quote] User authenticated:', user.id);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { cartItemIds, locale = 'fr' } = body;

    console.log('[mobile-request-quote] Request body:', { cartItemIds, locale });

    // Get user's profile for email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, language')
      .eq('user_id', user.id)
      .maybeSingle();

    const userEmail = profile?.email || user.email;
    const userLocale = locale || profile?.language || 'fr';

    // Get user's DRAFT order to validate ownership
    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error('[mobile-request-quote] Error fetching draft order:', orderFetchError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to fetch cart data.',
        code: 'CART_FETCH_ERROR'
      }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ 
        success: false,
        error: 'Your cart is empty.',
        code: 'EMPTY_CART'
      }, 400);
    }

    // Get cart items - either specified ones or auto-detect vehicle items
    let itemsQuery = supabase
      .from('order_items')
      .select('id, title, product_url, store, requires_manual_quote, base_price_usd, is_vehicle, vehicle_quote_applied')
      .eq('order_id', existingOrder.id)
      .eq('is_saved_for_later', false);

    // If specific cart item IDs provided, filter to those
    if (cartItemIds && Array.isArray(cartItemIds) && cartItemIds.length > 0) {
      itemsQuery = itemsQuery.in('id', cartItemIds);
    }

    const { data: requestedItems, error: itemsError } = await itemsQuery;

    if (itemsError) {
      console.error('[mobile-request-quote] Error fetching items:', itemsError);
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
      console.log('[mobile-request-quote] No vehicle items found in cart');
      return jsonResponse({ 
        success: false,
        error: 'No vehicle items requiring a quote were found in your cart.',
        code: 'NO_VEHICLE_ITEMS'
      }, 400);
    }

    console.log('[mobile-request-quote] Found', vehicleItems.length, 'vehicle items requiring quote');

    // Check for existing quote requests to avoid duplicates
    const itemIds = vehicleItems.map(item => item.id);
    const { data: existingQuotes, error: existingError } = await supabase
      .from('quote_requests')
      .select('id, order_item_id, status')
      .in('order_item_id', itemIds);

    if (existingError) {
      console.error('[mobile-request-quote] Error checking existing quotes:', existingError);
    }

    const existingQuoteMap = new Map(
      (existingQuotes || []).map(q => [q.order_item_id, q])
    );

    // Create quote requests for items that don't have one yet
    const newQuoteRequests: any[] = [];
    const existingQuoteResponses: any[] = [];

    for (const item of vehicleItems) {
      const existingQuote = existingQuoteMap.get(item.id);
      
      if (existingQuote) {
        // Update existing quote with latest request info
        await supabase
          .from('quote_requests')
          .update({
            requested_at: new Date().toISOString(),
            locale: userLocale,
            customer_email: userEmail,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingQuote.id);

        existingQuoteResponses.push({
          quoteRequestId: existingQuote.id,
          orderItemId: item.id,
          title: item.title,
          status: existingQuote.status,
          isExisting: true,
        });
      } else {
        // Create new quote request with email and locale
        newQuoteRequests.push({
          user_id: user.id,
          order_item_id: item.id,
          title: item.title,
          product_url: item.product_url,
          store_name: item.store,
          status: 'PENDING',
          locale: userLocale,
          customer_email: userEmail,
        });
      }
    }

    let createdQuotes: any[] = [];
    
    if (newQuoteRequests.length > 0) {
      const { data: insertedQuotes, error: insertError } = await supabase
        .from('quote_requests')
        .insert(newQuoteRequests)
        .select('id, order_item_id, status');

      if (insertError) {
        console.error('[mobile-request-quote] Error creating quote requests:', insertError);
        return jsonResponse({ 
          success: false,
          error: 'Failed to create quote request.' 
        }, 500);
      }

      createdQuotes = (insertedQuotes || []).map(q => ({
        quoteRequestId: q.id,
        orderItemId: q.order_item_id,
        status: q.status,
        isExisting: false,
      }));

      // Send admin notification for new quote requests
      try {
        const itemsList = newQuoteRequests.map(q => 
          `<li><strong>${q.title || 'Item'}</strong> from ${q.store_name || 'Unknown Store'}<br/>
           <a href="${q.product_url}">${q.product_url}</a></li>`
        ).join('');

        const emailHtml = `
          <h2>🚗 New Quote Request</h2>
          <p>A customer has requested a quote for the following item(s):</p>
          <ul>${itemsList}</ul>
          <p><a href="${Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com'}/admin/quote-requests">View in Admin Panel</a></p>
        `;

        await notifyAdmin(
          `New Quote Request (${newQuoteRequests.length} item${newQuoteRequests.length > 1 ? 's' : ''})`,
          emailHtml,
          'quote_request'
        );
        console.log('[mobile-request-quote] Admin notification sent');
      } catch (emailErr) {
        console.error('[mobile-request-quote] Failed to send admin notification:', emailErr);
        // Don't fail the request if email fails
      }
    }

    const allQuoteResponses = [...existingQuoteResponses, ...createdQuotes];
    
    console.log('[mobile-request-quote] Quote requests processed:', {
      created: createdQuotes.length,
      existing: existingQuoteResponses.length,
    });

    // Return success response with clear structure
    const primaryQuoteId = createdQuotes[0]?.quoteRequestId || existingQuoteResponses[0]?.quoteRequestId;
    
    return jsonResponse({
      success: true,
      quote_id: primaryQuoteId,
      status: 'pending',
      items_count: allQuoteResponses.length,
      message: createdQuotes.length > 0 
        ? 'Quote request submitted. We will contact you with pricing.'
        : 'Quote request already exists.',
      quoteRequests: allQuoteResponses,
      cartId: existingOrder.id,
      newRequestsCreated: createdQuotes.length,
      existingRequestsFound: existingQuoteResponses.length,
    });

  } catch (error: any) {
    console.error('[mobile-request-quote] Error:', error.message);
    
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
