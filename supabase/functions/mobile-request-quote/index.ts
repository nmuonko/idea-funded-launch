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
 * Creates quote requests for cart items that require manual shipping quotes.
 * This is triggered when mobile checkout encounters items with requires_manual_quote=true.
 * 
 * POST /mobile-request-quote
 * Body: { cartItemIds: string[] }
 * 
 * Returns:
 * - { success: true, quoteRequests: [...], message: "Quote requested" }
 * - { success: false, error: "..." }
 */

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    console.log('[mobile-request-quote] Request received');

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-request-quote] User authenticated:', user.id);

    // Parse request body
    const body = await req.json();
    const { cartItemIds } = body;

    if (!cartItemIds || !Array.isArray(cartItemIds) || cartItemIds.length === 0) {
      return jsonResponse({ 
        success: false, 
        error: 'cartItemIds array is required and must not be empty' 
      }, 400);
    }

    console.log('[mobile-request-quote] Requesting quotes for items:', cartItemIds);

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
        error: 'Failed to fetch cart data.' 
      }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ 
        success: false,
        error: 'Your cart is empty.' 
      }, 400);
    }

    // Get the requested items - validate they belong to user's cart and require manual quote
    const { data: requestedItems, error: itemsError } = await supabase
      .from('order_items')
      .select('id, title, product_url, store, requires_manual_quote, base_price_usd')
      .in('id', cartItemIds)
      .eq('order_id', existingOrder.id);

    if (itemsError) {
      console.error('[mobile-request-quote] Error fetching items:', itemsError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to fetch cart items.' 
      }, 500);
    }

    if (!requestedItems || requestedItems.length === 0) {
      return jsonResponse({ 
        success: false,
        error: 'No valid cart items found.'
      }, 400);
    }

    // Filter to only items that actually require quotes
    const quoteRequiredItems = requestedItems.filter(item => item.requires_manual_quote);
    
    if (quoteRequiredItems.length === 0) {
      return jsonResponse({ 
        success: false,
        error: 'None of the specified items require a quote.'
      }, 400);
    }

    // Check for existing quote requests to avoid duplicates
    const itemIds = quoteRequiredItems.map(item => item.id);
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

    for (const item of quoteRequiredItems) {
      const existingQuote = existingQuoteMap.get(item.id);
      
      if (existingQuote) {
        // Return existing quote info
        existingQuoteResponses.push({
          quoteRequestId: existingQuote.id,
          orderItemId: item.id,
          title: item.title,
          status: existingQuote.status,
          isExisting: true,
        });
      } else {
        // Create new quote request
        newQuoteRequests.push({
          user_id: user.id,
          order_item_id: item.id,
          title: item.title,
          product_url: item.product_url,
          store_name: item.store,
          status: 'PENDING',
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
          <p><a href="https://afrishop-usa.com/admin/quote-requests">View in Admin Panel</a></p>
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

    return jsonResponse({
      success: true,
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
      return jsonResponse({ success: false, error: error.message }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    }, 500);
  }
});
