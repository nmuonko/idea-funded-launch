import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import { isProfileComplete, getMissingProfileFields, formatProfileForResponse } from "../_shared/profileHelper.ts";

/**
 * Mobile Checkout Edge Function - SIMPLIFIED
 * 
 * Creates an order from cart items and returns a SINGLE HTTPS checkout URL.
 * The mobile app opens this URL directly in a WebView - NO HTML is returned.
 * 
 * Response format on success:
 * {
 *   "success": true,
 *   "orderId": "<uuid>",
 *   "confirmationId": "<8-char-ref>",
 *   "checkoutUrl": "https://.../functions/v1/maishapay-checkout-page?order_id=..."
 * }
 * 
 * Response format on error:
 * {
 *   "success": false,
 *   "code": "ERROR_CODE",
 *   "message": "Human readable error message"
 * }
 * 
 * Flow:
 * 1. Mobile app calls POST /mobile-checkout with { cart_item_ids: [...] }
 * 2. This function validates cart, creates order with PENDING_PAYMENT status
 * 3. Returns checkoutUrl pointing to maishapay-checkout-page edge function
 * 4. Mobile opens checkoutUrl in WebView
 * 5. maishapay-checkout-page renders form that auto-submits to MaishaPay
 * 6. User completes payment on MaishaPay
 * 7. MaishaPay calls our callback URL to update order status
 * 8. User is redirected to /maishapay/result
 */

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    console.log('[mobile-checkout] Request received');

    // Verify JWT
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-checkout] User authenticated:', user.id);

    // Parse request body - only needs cart_item_ids and optional notes
    const body = await req.json();
    const { cart_item_ids, notes } = body;

    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      return jsonResponse({ success: false, error: 'cart_item_ids array is required and must not be empty' }, 400);
    }

    console.log('[mobile-checkout] Checkout requested for items:', cart_item_ids);

    // AUTO-FILL: Fetch user profile to get shipping details
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, email, full_name, name, phone, address_line1, address_line2, city, state_province, postal_code, country')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[mobile-checkout] Error fetching profile:', profileError);
    }

    // Log profile data for debugging
    console.log('[mobile-checkout] User profile data:', userProfile ? {
      hasFullName: !!userProfile.full_name,
      hasPhone: !!userProfile.phone,
      hasAddress: !!userProfile.address_line1,
      hasCity: !!userProfile.city,
      hasState: !!userProfile.state_province,
      hasPostal: !!userProfile.postal_code,
      hasCountry: !!userProfile.country,
      full_name: userProfile.full_name,
      phone: userProfile.phone,
      address_line1: userProfile.address_line1,
    } : 'NO PROFILE FOUND');

    // Check if profile is complete for checkout using shared helper
    if (!isProfileComplete(userProfile)) {
      const missingFields = getMissingProfileFields(userProfile);
      console.log('[mobile-checkout] User profile incomplete. Missing fields:', missingFields);
      return jsonResponse({
        success: false,
        code: 'PROFILE_INCOMPLETE',
        error: 'Please complete your profile with shipping address before checkout.',
        missingFields,
      }, 400);
    }

    console.log('[mobile-checkout] Profile complete, auto-filling shipping info');

    // TypeScript: userProfile is guaranteed non-null after isProfileComplete check
    const profile = userProfile!;

    // Get user's DRAFT order
    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error('[mobile-checkout] Error fetching draft order:', orderFetchError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to fetch cart data.' 
      }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ 
        success: false,
        error: 'Your cart is empty. Please add items before checkout.' 
      }, 400);
    }

    // Get the requested items - validate they belong to user, are in DRAFT order, and NOT saved for later
    const { data: requestedItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', cart_item_ids)
      .eq('order_id', existingOrder.id);

    if (itemsError) {
      console.error('[mobile-checkout] Error fetching items:', itemsError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to fetch cart items.' 
      }, 500);
    }

    // Validate all requested items exist and are valid
    if (!requestedItems || requestedItems.length !== cart_item_ids.length) {
      return jsonResponse({ 
        success: false,
        error: 'Some requested items were not found in your cart.'
      }, 400);
    }

    // Check for saved items
    const savedItems = requestedItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ 
        success: false,
        error: 'Cannot checkout items that are saved for later. Please move them to cart first.'
      }, 400);
    }

    // Check for items requiring manual quote - return structured response
    const manualQuoteItems = requestedItems.filter(item => item.requires_manual_quote);
    if (manualQuoteItems.length > 0) {
      // Check if quote requests already exist for these items
      const quoteItemIds = manualQuoteItems.map(item => item.id);
      const { data: existingQuotes } = await supabase
        .from('quote_requests')
        .select('id, order_item_id, status')
        .in('order_item_id', quoteItemIds);
      
      const quoteRequestIds = existingQuotes?.map(q => q.id) || [];
      const pendingQuotes = existingQuotes?.filter(q => q.status === 'PENDING' || q.status === 'SENT') || [];
      
      return jsonResponse({ 
        success: false,
        code: 'QUOTE_REQUIRED',
        message: 'Some items require a custom shipping quote.',
        cartId: existingOrder.id,
        quoteRequiredItems: manualQuoteItems.map(item => ({
          id: item.id,
          title: item.title,
          productUrl: item.product_url,
          store: item.store,
        })),
        existingQuoteRequests: quoteRequestIds.length > 0 ? quoteRequestIds : null,
        hasPendingQuote: pendingQuotes.length > 0,
      }, 400);
    }

    // Get pricing settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      console.error('[mobile-checkout] Error fetching settings:', settingsError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to load pricing configuration.' 
      }, 500);
    }

    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Calculate totals for selected items only
    let itemCount = 0;
    let totalItemsUsd = 0;
    let totalMarginUsd = 0;
    let itemsSubtotalUsd = 0;

    requestedItems.forEach(item => {
      const qty = item.quantity || 1;
      itemCount += qty;
      totalItemsUsd += Number(item.subtotal_usd || 0);
      totalMarginUsd += Number(item.markup_fee_usd || 0);
      itemsSubtotalUsd += Number(item.total_price_usd || 0);
    });

    const shippingFeeUsd = calculateShipping(totalItemsUsd, shippingBaseFeeUsd, shippingPercent);
    const grandTotalUsd = round2(itemsSubtotalUsd + shippingFeeUsd);
    const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

    console.log('[mobile-checkout] Calculated totals:', {
      itemCount,
      totalItemsUsd: round2(totalItemsUsd),
      shippingFeeUsd,
      grandTotalUsd,
    });

    // Generate payment reference
    const timestamp = Date.now().toString(36);
    
    // Create a new order for checkout with only selected items
    // AUTO-FILL shipping address from user profile
    const { data: checkoutOrder, error: createOrderError } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        status: 'PENDING_PAYMENT',
        item_total_usd: round2(totalItemsUsd),
        service_fee_usd: round2(totalMarginUsd),
        shipping_fee_usd: round2(shippingFeeUsd),
        total_usd: grandTotalUsd,
        total_cdf: grandTotalCdf,
        exchange_rate_used: exchangeRate,
        maisha_payment_status: 'PENDING',
        admin_notes: notes || null,
        // Note: shipping_city is an enum, so we map if possible
        shipping_city: mapToShippingCity(profile.city),
      })
      .select()
      .single();

    if (createOrderError) {
      console.error('[mobile-checkout] Error creating checkout order:', createOrderError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to create order. Please try again.' 
      }, 500);
    }

    // Generate reference with order ID
    const reference = `AFRISHOP-${checkoutOrder.id.slice(0, 8)}-${timestamp}`;

    // Update order with reference
    await supabase.from('orders').update({
      maisha_transaction_id: reference,
    }).eq('id', checkoutOrder.id);

    // Move selected items to the new order
    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: checkoutOrder.id })
      .in('id', cart_item_ids);

    if (moveItemsError) {
      console.error('[mobile-checkout] Error moving items to checkout order:', moveItemsError);
      // Rollback: delete the new order
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ 
        success: false,
        error: 'Failed to process checkout. Please try again.' 
      }, 500);
    }

    // Create payment record with user info
    await supabase
      .from('maisha_payments')
      .insert({
        order_id: checkoutOrder.id,
        maisha_reference: reference,
        amount_usd: grandTotalUsd,
        amount_cdf: grandTotalCdf,
        currency: 'USD',
        status: 'pending',
        user_id: user.id,
        raw_request: {
          amount: grandTotalUsd,
          email: profile.email || user.email,
          phone: profile.phone,
          customerName: profile.full_name,
          shippingAddress: {
            addressLine1: profile.address_line1,
            addressLine2: profile.address_line2,
            city: profile.city,
            stateProvince: profile.state_province,
            postalCode: profile.postal_code,
            country: profile.country,
          },
        },
      });

    // Get Supabase URL for building checkout URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    
    if (!supabaseUrl) {
      console.error('[mobile-checkout] [CONFIG ERROR] Missing SUPABASE_URL');
      return jsonResponse({
        success: false,
        code: 'CHECKOUT_URL_ERROR',
        error: 'Unable to create MaishaPay checkout URL. Please try again later.',
      }, 500);
    }
    
    // Build the checkout URL - points to our edge function that renders the MaishaPay form
    const checkoutUrl = `${supabaseUrl}/functions/v1/maishapay-checkout-page?order_id=${checkoutOrder.id}`;
    
    // Validate the URL is valid HTTPS
    if (!checkoutUrl.startsWith('https://')) {
      console.error('[mobile-checkout] [CONFIG ERROR] Checkout URL is not HTTPS:', checkoutUrl);
      return jsonResponse({
        success: false,
        code: 'CHECKOUT_URL_ERROR',
        error: 'Unable to create MaishaPay checkout URL. Please try again later.',
      }, 500);
    }

    // Generate display reference (first 8 chars of UUID, uppercase)
    const confirmationId = checkoutOrder.id.substring(0, 8).toUpperCase();

    console.log('[mobile-checkout] Order created successfully');
    console.log('[mobile-checkout] Order details:', {
      orderId: checkoutOrder.id,
      confirmationId,
      reference,
      grandTotalUsd,
      checkoutUrl,
    });

    // SIMPLIFIED RESPONSE - Only checkoutUrl, no HTML
    return jsonResponse({
      success: true,
      orderId: checkoutOrder.id,
      confirmationId,
      checkoutUrl,
      // Additional fields for backward compatibility
      order: {
        id: checkoutOrder.id,
        confirmationId,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
      },
    });

  } catch (error: any) {
    console.error('[mobile-checkout] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ success: false, error: error.message }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      error: 'An unexpected error occurred. Please try again.',
    }, 500);
  }
});

/**
 * Helper to map city string to shipping_city enum
 * Returns null if city doesn't match known values
 */
function mapToShippingCity(city: string | null): 'KINSHASA' | 'LUBUMBASHI' | 'OTHER' | null {
  if (!city) return null;
  const normalized = city.toUpperCase().trim();
  if (normalized === 'KINSHASA') return 'KINSHASA';
  if (normalized === 'LUBUMBASHI') return 'LUBUMBASHI';
  return 'OTHER';
}
