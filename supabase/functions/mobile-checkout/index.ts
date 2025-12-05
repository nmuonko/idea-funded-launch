import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

/**
 * Generate MaishaPay checkout HTML form
 * This HTML auto-submits to MaishaPay's checkout endpoint
 */
function generateMaishapayHtml(params: {
  publicKey: string;
  secretKey: string;
  gatewayMode: string;
  amount: string;
  currency: string;
  reference: string;
  callbackUrl: string;
  orderId: string;
  customerName?: string;
  customerPhone?: string;
}): string {
  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';
  
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Paiement MaishaPay</title>
<script>
  window.onload = function() {
    setTimeout(function() {
      document.getElementById('paymentForm').submit();
    }, 500);
  };
</script>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#1a1a2e;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">

<div style="text-align:center;width:100%;max-width:350px;">
  <div style="font-size:48px;margin-bottom:16px;">💳</div>
  <h1 style="font-size:20px;margin:0 0 8px 0;">Paiement Sécurisé</h1>
  <p style="margin:0 0 24px 0;opacity:0.7;font-size:14px;">AfriShop - MaishaPay</p>
  
  <div style="background:#16213e;border-radius:12px;padding:20px;margin-bottom:24px;">
    <p style="margin:0 0 8px 0;font-size:12px;opacity:0.6;">Montant à payer</p>
    <p style="margin:0;font-size:32px;font-weight:bold;color:#00d4ff;">$${params.amount}</p>
    <p style="margin:8px 0 0 0;font-size:11px;opacity:0.5;">Réf: ${params.reference.slice(0, 20)}...</p>
    ${params.customerName ? `<p style="margin:8px 0 0 0;font-size:12px;opacity:0.7;">Client: ${params.customerName}</p>` : ''}
  </div>
  
  <p style="margin:0 0 16px 0;font-size:14px;opacity:0.8;">Redirection vers MaishaPay...</p>
  
  <form id="paymentForm" action="${checkoutUrl}" method="POST">
    <input type="hidden" name="gatewayMode" value="${params.gatewayMode}">
    <input type="hidden" name="publicApiKey" value="${params.publicKey}">
    <input type="hidden" name="secretApiKey" value="${params.secretKey}">
    <input type="hidden" name="montant" value="${params.amount}">
    <input type="hidden" name="devise" value="${params.currency}">
    <input type="hidden" name="callbackUrl" value="${params.callbackUrl}">
    <input type="hidden" name="reference" value="${params.reference}">
    
    <noscript>
      <button type="submit" style="width:100%;padding:16px;background:#00d4ff;color:#1a1a2e;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;">
        Payer maintenant
      </button>
    </noscript>
  </form>
  
  <p style="margin-top:20px;font-size:11px;opacity:0.4;">🔒 Paiement sécurisé via MaishaPay</p>
</div>

</body>
</html>`;
}

/**
 * Mobile Checkout Edge Function
 * 
 * Creates an order from cart items and returns a redirect URL for payment.
 * AUTO-FILLS user profile data (name, phone, address) - user never re-enters.
 * 
 * IMPORTANT: This function does NOT call MaishaPay directly.
 * Instead, it creates the order and returns a checkoutUrl to our
 * /maishapay/checkout frontend page, which handles the MaishaPay form POST.
 * 
 * Flow:
 * 1. Mobile app calls this endpoint with cart_item_ids
 * 2. This function fetches user profile for auto-fill
 * 3. Creates an order with PENDING_PAYMENT status + shipping address
 * 4. Returns { success: true, orderId, checkoutUrl, profile }
 * 5. Mobile app opens checkoutUrl in WebView
 * 6. /maishapay/checkout page renders auto-submit form to MaishaPay
 * 7. MaishaPay redirects user to /maishapay/result
 */

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Dynamic shipping calculation
function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

// Validate checkout URL
function getValidatedCheckoutUrl(): { url: string | null; error: string | null } {
  const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL');
  
  console.log('[mobile-checkout] FRONTEND_BASE_URL env value:', frontendBaseUrl);
  
  // Check if empty or missing
  if (!frontendBaseUrl || frontendBaseUrl.trim() === '') {
    console.error('[mobile-checkout] [CONFIG ERROR] FRONTEND_BASE_URL is empty or not set');
    return { url: null, error: 'Configuration du paiement invalide. FRONTEND_BASE_URL manquant.' };
  }
  
  // Check if it looks like a placeholder
  if (frontendBaseUrl.includes('dummy') || frontendBaseUrl.includes('placeholder') || frontendBaseUrl.includes('test_key')) {
    console.error('[mobile-checkout] [CONFIG ERROR] FRONTEND_BASE_URL appears to be a placeholder:', frontendBaseUrl);
    return { url: null, error: 'Configuration du paiement invalide. FRONTEND_BASE_URL non configuré.' };
  }
  
  // Check if it starts with https://
  if (!frontendBaseUrl.startsWith('https://')) {
    console.error('[mobile-checkout] [CONFIG ERROR] FRONTEND_BASE_URL must start with https://:', frontendBaseUrl);
    return { url: null, error: 'Configuration du paiement invalide. URL non sécurisée.' };
  }
  
  // Remove trailing slash if present
  const cleanUrl = frontendBaseUrl.replace(/\/$/, '');
  
  console.log('[mobile-checkout] Validated FRONTEND_BASE_URL:', cleanUrl);
  return { url: cleanUrl, error: null };
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

    // FIRST: Validate frontend URL before doing anything else
    const { url: frontendBaseUrl, error: urlError } = getValidatedCheckoutUrl();
    if (!frontendBaseUrl) {
      console.error('[mobile-checkout] Cannot proceed - invalid frontend URL');
      return jsonResponse({ 
        success: false, 
        error: urlError || 'Configuration du paiement invalide. Veuillez contacter l\'administrateur.'
      }, 500);
    }

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
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[mobile-checkout] Error fetching profile:', profileError);
    }

    // Check if profile is complete for checkout
    const hasCompleteProfile = userProfile && !!(
      userProfile.full_name &&
      userProfile.phone &&
      userProfile.address_line1 &&
      userProfile.city &&
      userProfile.state_province &&
      userProfile.postal_code &&
      userProfile.country
    );

    if (!hasCompleteProfile) {
      console.log('[mobile-checkout] User profile incomplete, returning error');
      return jsonResponse({
        success: false,
        code: 'INCOMPLETE_PROFILE',
        error: 'Please complete your profile with shipping address before checkout.',
        missingFields: getMissingProfileFields(userProfile),
      }, 400);
    }

    console.log('[mobile-checkout] Profile complete, auto-filling shipping info');

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
        shipping_city: mapToShippingCity(userProfile.city),
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
          email: userProfile.email || user.email,
          phone: userProfile.phone,
          customerName: userProfile.full_name,
          shippingAddress: {
            addressLine1: userProfile.address_line1,
            addressLine2: userProfile.address_line2,
            city: userProfile.city,
            stateProvince: userProfile.state_province,
            postalCode: userProfile.postal_code,
            country: userProfile.country,
          },
        },
      });

    // Get MaishaPay configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE') || Deno.env.get('MAISHAPAY_MODE') || '1';
    const isLiveMode = gatewayMode === '1' || gatewayMode?.toLowerCase() === 'live';
    
    // Get API keys - check multiple env var names
    let publicKey = Deno.env.get('MAISHAPAY_PUBLIC_API_KEY') || '';
    let secretKey = Deno.env.get('MAISHAPAY_SECRET_API_KEY') || '';
    
    if (isLiveMode) {
      publicKey = publicKey || Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
      secretKey = secretKey || Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || Deno.env.get('MAISHAPAY_SECRET_KEY') || '';
    } else {
      publicKey = publicKey || Deno.env.get('MAISHAPAY_PUBLIC_KEY') || Deno.env.get('MAISHA_PUBLIC_KEY') || '';
      secretKey = secretKey || Deno.env.get('MAISHAPAY_SECRET_KEY') || Deno.env.get('MAISHA_SECRET_KEY') || '';
    }
    
    console.log('[mobile-checkout] MaishaPay config:', {
      mode: isLiveMode ? 'live' : 'sandbox',
      hasPublicKey: !!publicKey,
      hasSecretKey: !!secretKey,
      publicKeyPrefix: publicKey ? publicKey.slice(0, 12) + '...' : 'MISSING',
    });
    
    // Validate keys
    if (!publicKey || !secretKey) {
      console.error('[mobile-checkout] [CONFIG ERROR] Missing MaishaPay API keys');
      return jsonResponse({
        success: false,
        code: 'MAISHAPAY_CONFIG_ERROR',
        error: 'Payment gateway not configured. Please contact support.',
      }, 500);
    }
    
    // CRITICAL: Callback URL must point to our BACKEND edge function, not frontend
    const callbackUrl = `${supabaseUrl}/functions/v1/maishapay-callback`;
    
    // Generate the checkout HTML that auto-submits to MaishaPay
    const checkoutHtml = generateMaishapayHtml({
      publicKey,
      secretKey,
      gatewayMode: isLiveMode ? '1' : '0',
      amount: grandTotalUsd.toFixed(2),
      currency: 'USD',
      reference,
      callbackUrl,
      orderId: checkoutOrder.id,
      customerName: userProfile.full_name,
      customerPhone: userProfile.phone,
    });
    
    // Also provide a URL fallback
    const checkoutUrl = `${supabaseUrl}/functions/v1/maishapay-checkout-page?order_id=${checkoutOrder.id}`;

    console.log('[mobile-checkout] Order created successfully');
    console.log('[mobile-checkout] Order details:', {
      orderId: checkoutOrder.id,
      reference,
      grandTotalUsd,
      callbackUrl,
      customerName: userProfile.full_name,
    });

    // Generate display reference (first 8 chars of UUID, uppercase)
    const orderRef = checkoutOrder.id.substring(0, 8).toUpperCase();

    // Build the response body - INCLUDE html field for direct WebView loading
    // Also include profile info so frontend can display it
    const responseBody = {
      // Primary fields for mobile app
      success: true,
      orderId: checkoutOrder.id,
      orderRef: orderRef,
      displayRef: orderRef,
      order_number: orderRef,
      
      // THE CRITICAL FIELD: HTML for direct WebView loading
      html: checkoutHtml,
      
      // URL fallback (mobile can use either html or checkoutUrl)
      checkoutUrl: checkoutUrl,
      redirectUrl: checkoutUrl,
      redirect_url: checkoutUrl,
      
      // Other fields
      order_id: checkoutOrder.id,
      reference,
      maishapay_reference: reference,
      
      // AUTO-FILLED profile info for display (user never re-enters this)
      profile: {
        fullName: userProfile.full_name,
        phoneNumber: userProfile.phone,
        email: userProfile.email || user.email,
        shippingAddress: {
          addressLine1: userProfile.address_line1,
          addressLine2: userProfile.address_line2,
          city: userProfile.city,
          stateOrProvince: userProfile.state_province,
          postalCode: userProfile.postal_code,
          country: userProfile.country,
        },
      },
      
      // Order summary
      order: {
        id: checkoutOrder.id,
        order_number: orderRef,
        displayRef: orderRef,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
        total_amount_usd: grandTotalUsd,
        total_amount_cdf: grandTotalCdf,
      },
    };

    console.log('[mobile-checkout] Response includes html field:', !!responseBody.html);
    console.log('[mobile-checkout] HTML length:', responseBody.html?.length);

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

/**
 * Helper to determine which profile fields are missing
 */
function getMissingProfileFields(profile: any): string[] {
  const missing: string[] = [];
  if (!profile?.full_name) missing.push('fullName');
  if (!profile?.phone) missing.push('phoneNumber');
  if (!profile?.address_line1) missing.push('addressLine1');
  if (!profile?.city) missing.push('city');
  if (!profile?.state_province) missing.push('stateOrProvince');
  if (!profile?.postal_code) missing.push('postalCode');
  if (!profile?.country) missing.push('country');
  return missing;
}

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
