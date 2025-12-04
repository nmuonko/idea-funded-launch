import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

/**
 * Mobile Checkout Edge Function
 * 
 * Creates an order from cart items and returns a redirect URL for payment.
 * 
 * IMPORTANT: This function does NOT call MaishaPay directly.
 * Instead, it creates the order and returns a redirectUrl to our
 * /maishapay/checkout frontend page, which handles the MaishaPay form POST.
 * 
 * Flow:
 * 1. Mobile app calls this endpoint with cart_item_ids
 * 2. This function creates an order with PENDING_PAYMENT status
 * 3. Returns { success: true, orderId, redirectUrl }
 * 4. Mobile app opens redirectUrl in WebView
 * 5. /maishapay/checkout page renders auto-submit form to MaishaPay
 * 6. MaishaPay redirects user to /maishapay/result
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

    // Parse request body
    const body = await req.json();
    const { cart_item_ids, phone, email } = body;

    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      return jsonResponse({ success: false, error: 'cart_item_ids array is required and must not be empty' }, 400);
    }

    console.log('[mobile-checkout] Checkout requested for items:', cart_item_ids);

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

    // Check for items requiring manual quote
    const manualQuoteItems = requestedItems.filter(item => item.requires_manual_quote);
    if (manualQuoteItems.length > 0) {
      return jsonResponse({ 
        success: false,
        error: 'Some items require a custom shipping quote. Please contact us.'
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

    // Create payment record
    await supabase
      .from('maisha_payments')
      .insert({
        order_id: checkoutOrder.id,
        maisha_reference: reference,
        amount_usd: grandTotalUsd,
        amount_cdf: grandTotalCdf,
        currency: 'USD',
        status: 'pending',
        raw_request: {
          amount: grandTotalUsd,
          email: email || user.email,
          phone: phone,
        },
      });

    // Build redirect URL to our checkout page (NOT MaishaPay directly)
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const redirectUrl = `${frontendBaseUrl}/maishapay/checkout?orderId=${checkoutOrder.id}`;

    console.log('[mobile-checkout] Order created successfully:', {
      orderId: checkoutOrder.id,
      reference,
      redirectUrl,
      grandTotalUsd,
    });

    // Build the response body
    const responseBody = {
      // Required fields for mobile app
      success: true,
      orderId: checkoutOrder.id,
      redirectUrl,
      
      // Additional fields for backwards compatibility
      order_id: checkoutOrder.id,
      redirect_url: redirectUrl,
      reference,
      maishapay_reference: reference,
      
      // Order summary
      order: {
        id: checkoutOrder.id,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
      },
    };

    console.log('[mobile-checkout] Response:', JSON.stringify(responseBody));

    return jsonResponse(responseBody);

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
