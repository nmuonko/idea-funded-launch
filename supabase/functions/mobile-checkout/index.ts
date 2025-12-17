import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import { isProfileComplete, getMissingProfileFields, formatProfileForResponse } from "../_shared/profileHelper.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
import { calculateShipping } from "../_shared/cartHelpers.ts";
import { 
  detectVehicleFromItems, 
  getPaymentCurrencyAndAmount, 
  fetchAndValidateVehicleQuotes, 
  VEHICLE_QUOTE_MISSING_ERROR,
  VEHICLE_CARD_NOT_AVAILABLE_ERROR,
  CHECKOUT_METHOD_MISMATCH_ERROR,
} from "../_shared/vehiclePaymentGuard.ts";

// Payment method types
type PaymentMethod = 'MOBILE_MONEY' | 'CARD';
type MaishapayFlow = 'MOBILE_MONEY_SESSION' | 'CARD_SESSION';

/**
 * Mobile Checkout Edge Function
 * 
 * Creates order from cart items and returns checkout data.
 * Returns BOTH checkoutUrl AND html field for maximum compatibility.
 * Uses shared helpers for CONSISTENT totals calculation.
 */

// Parse payment method from payload
function parsePaymentMethod(body: Record<string, any>): PaymentMethod {
  const rawMethod = (body.payment_method || body.method || body.channel || '').toString().toUpperCase();
  
  // Check for card-related keywords
  if (rawMethod.includes('CARD') || rawMethod.includes('VISA') || rawMethod.includes('MASTER') || 
      rawMethod.includes('CREDIT') || rawMethod.includes('DEBIT')) {
    return 'CARD';
  }
  
  // Default to MOBILE_MONEY (safer for DRC)
  return 'MOBILE_MONEY';
}

// Detect buyer country and derive ISO code
function detectBuyerCountry(profile: { country?: string | null }): { isDRC: boolean; isoCode: string; countryCode: string } {
  const profileCountry = (profile?.country || '').toUpperCase();
  
  // Check for DRC variations
  const isDRC = profileCountry.includes('CONGO') || 
                profileCountry === 'CD' || 
                profileCountry === 'DRC' ||
                profileCountry === 'DR CONGO' ||
                profileCountry === 'RDC' ||
                profileCountry === ''; // Default empty to DRC (primary market)
  
  // Derive ISO code
  const isoCode = isDRC ? 'CD' : (profileCountry.slice(0, 2) || 'CD');
  const countryCode = isoCode;
  
  return { isDRC, isoCode, countryCode };
}

// Generate checkout HTML that auto-submits to MaishaPay
function generateCheckoutHtml(params: {
  publicKey: string;
  secretKey: string;
  gatewayMode: string;
  amount: string;
  currency: string;
  displayAmount: string;
  reference: string;
  callbackUrl: string;
  orderId: string;
  isoCode?: string;
  countryCode?: string;
  motif?: string;
  phone?: string;
}): string {
  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';
  
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Paiement AfriShop</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.container{text-align:center;width:100%;max-width:350px}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:20px;margin-bottom:8px}
.subtitle{opacity:0.7;font-size:14px;margin-bottom:24px}
.amount-box{background:rgba(255,255,255,0.1);border-radius:12px;padding:20px;margin-bottom:24px}
.amount-label{font-size:12px;opacity:0.6;margin-bottom:8px}
.amount{font-size:28px;font-weight:bold;color:#00d4ff}
.ref{font-size:11px;opacity:0.5;margin-top:8px}
.btn{width:100%;padding:16px;background:#00d4ff;color:#1a1a2e;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer}
.secure{margin-top:20px;font-size:11px;opacity:0.4}
.status{margin-top:16px;font-size:13px;opacity:0.8}
.spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:#00d4ff;border-radius:50%;animation:spin 1s linear infinite;margin-right:8px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
  <div class="icon">💳</div>
  <h1>Paiement Sécurisé</h1>
  <p class="subtitle">AfriShop via MaishaPay</p>
  
  <div class="amount-box">
    <p class="amount-label">Montant à payer</p>
    <p class="amount">${params.displayAmount}</p>
    <p class="ref">Réf: ${params.reference}</p>
  </div>
  
  <form id="payForm" action="${checkoutUrl}" method="POST">
    <input type="hidden" name="gatewayMode" value="${params.gatewayMode}">
    <input type="hidden" name="publicApiKey" value="${params.publicKey}">
    <input type="hidden" name="secretApiKey" value="${params.secretKey}">
    <input type="hidden" name="montant" value="${params.amount}">
    <input type="hidden" name="devise" value="${params.currency}">
    <input type="hidden" name="callbackUrl" value="${params.callbackUrl}">
    <input type="hidden" name="reference" value="${params.reference}">
    <input type="hidden" name="motif" value="${params.motif || `Paiement AfriShop ${params.reference}`}">
    ${params.isoCode ? `<input type="hidden" name="isoCode" value="${params.isoCode}">` : ''}
    ${params.countryCode ? `<input type="hidden" name="countryCode" value="${params.countryCode}">` : ''}
    ${params.phone ? `<input type="hidden" name="phone" value="${params.phone}">` : ''}
    
    <button type="submit" class="btn" id="payBtn">Payer maintenant</button>
  </form>
  
  <p class="status" id="status"></p>
  <p class="secure">🔒 Paiement sécurisé via MaishaPay</p>
</div>

<script>
(function(){
  var btn = document.getElementById('payBtn');
  var form = document.getElementById('payForm');
  var status = document.getElementById('status');
  var submitted = false;
  
  function submit() {
    if (submitted) return;
    submitted = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Redirection...';
    status.innerHTML = 'Connexion à MaishaPay...';
    setTimeout(function() { form.submit(); }, 500);
  }
  
  // Auto-submit after 2 seconds
  setTimeout(submit, 2000);
  
  btn.onclick = function(e) {
    e.preventDefault();
    submit();
  };
})();
</script>
</body>
</html>`;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    console.log('[mobile-checkout] Request received');

    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-checkout] User authenticated:', user.id);

    const body = await req.json();
    const { cart_item_ids, notes } = body;

    // 🔐 PARSE PAYMENT METHOD FROM PAYLOAD (default to MOBILE_MONEY for DRC safety)
    const REQUESTED_METHOD: PaymentMethod = parsePaymentMethod(body);
    console.log('[mobile-checkout] Payment method detected:', REQUESTED_METHOD);

    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      return jsonResponse({ success: false, error: 'cart_item_ids array is required and must not be empty' }, 400);
    }

    console.log('[mobile-checkout] Checkout requested for items:', cart_item_ids);

    // Fetch user profile for shipping details
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, email, full_name, name, phone, address_line1, address_line2, city, state_province, postal_code, country')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[mobile-checkout] Error fetching profile:', profileError);
    }

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

    if (!isProfileComplete(userProfile)) {
      const missingFields = getMissingProfileFields(userProfile);
      console.log('[mobile-checkout] User profile incomplete. Missing fields:', missingFields);
      
      // Create a user-friendly message based on missing fields
      const fieldNames: Record<string, string> = {
        fullName: 'full name',
        phone: 'phone number',
        country: 'country',
      };
      const missingFieldNames = missingFields.map(f => fieldNames[f] || f).join(', ');
      
      return jsonResponse({
        success: false,
        code: 'PROFILE_INCOMPLETE',
        error: `Please add your ${missingFieldNames} to your profile before checkout.`,
        missingFields,
      }, 400);
    }

    console.log('[mobile-checkout] Profile complete, auto-filling shipping info');
    const profile = userProfile!;

    // 🌍 DETECT BUYER COUNTRY AND DERIVE ISO CODE
    const { isDRC, isoCode, countryCode } = detectBuyerCountry(profile);
    console.log('[mobile-checkout] Buyer country detection:', { country: profile.country, isDRC, isoCode, countryCode });

    // Get user's DRAFT order
    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (orderFetchError) {
      console.error('[mobile-checkout] Error fetching draft order:', orderFetchError);
      return jsonResponse({ success: false, error: 'Failed to fetch cart data.' }, 500);
    }

    if (!existingOrder) {
      return jsonResponse({ success: false, error: 'Your cart is empty. Please add items before checkout.' }, 400);
    }

    // Get requested items
    const { data: requestedItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', cart_item_ids)
      .eq('order_id', existingOrder.id);

    if (itemsError) {
      console.error('[mobile-checkout] Error fetching items:', itemsError);
      return jsonResponse({ success: false, error: 'Failed to fetch cart items.' }, 500);
    }

    if (!requestedItems || requestedItems.length !== cart_item_ids.length) {
      return jsonResponse({ success: false, error: 'Some requested items were not found in your cart.' }, 400);
    }

    // Check for saved items
    const savedItems = requestedItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ success: false, error: 'Cannot checkout items that are saved for later.' }, 400);
    }

    // Check for items requiring manual quote
    const manualQuoteItems = requestedItems.filter(item => item.requires_manual_quote);
    if (manualQuoteItems.length > 0) {
      const quoteItemIds = manualQuoteItems.map(item => item.id);
      const { data: existingQuotes } = await supabase
        .from('quote_requests')
        .select('id, order_item_id, status')
        .in('order_item_id', quoteItemIds);
      
      return jsonResponse({ 
        success: false,
        code: 'QUOTE_REQUIRED',
        message: 'Some items require a custom shipping quote.',
        quoteRequiredItems: manualQuoteItems.map(item => ({
          id: item.id,
          title: item.title,
          productUrl: item.product_url,
        })),
      }, 400);
    }

    // Get pricing settings - USE CACHED SETTINGS (single source of truth)
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;
    
    console.log('[mobile-checkout] Settings loaded:', { exchangeRate, shippingBaseFeeUsd, shippingPercent });

    // 🚗 VEHICLE DETECTION using shared helper
    const vehicleDetection = detectVehicleFromItems(requestedItems);
    const containsVehicle = vehicleDetection.isVehicle;
    
    // Detect vehicle quote items (items with approved quotes)
    const vehicleQuoteItems = requestedItems.filter(item => 
      item.is_vehicle === true && item.vehicle_quote_applied === true
    );
    const hasVehicleQuoteItems = vehicleQuoteItems.length > 0;

    // 🔒 VEHICLE QUOTE VALIDATION: Fetch and validate quotes from database
    let vehicleQuoteValidation: Awaited<ReturnType<typeof fetchAndValidateVehicleQuotes>> | null = null;
    if (hasVehicleQuoteItems) {
      vehicleQuoteValidation = await fetchAndValidateVehicleQuotes(supabase, vehicleQuoteItems);
      
      if (!vehicleQuoteValidation.valid) {
        console.error('[mobile-checkout] VEHICLE QUOTE VALIDATION FAILED:', {
          orderId: existingOrder.id,
          vehicleItemIds: vehicleQuoteItems.map(v => v.id),
          error: vehicleQuoteValidation.error,
        });
        return jsonResponse({
          success: false,
          code: vehicleQuoteValidation.error?.code || VEHICLE_QUOTE_MISSING_ERROR.code,
          message_fr: vehicleQuoteValidation.error?.message_fr || VEHICLE_QUOTE_MISSING_ERROR.message_fr,
          message_en: vehicleQuoteValidation.error?.message_en || VEHICLE_QUOTE_MISSING_ERROR.message_en,
          error: vehicleQuoteValidation.error?.message_en || 'Vehicle quote not available',
        }, 400);
      }
      
      console.log('[mobile-checkout] VEHICLE QUOTE VALIDATION SUCCESS:', {
        orderId: existingOrder.id,
        vehicleQuoteTotal: vehicleQuoteValidation.totalAmount,
        quoteDetails: vehicleQuoteValidation.quoteDetails,
      });
    }

    // Log VEHICLE CURRENCY GUARD diagnostics
    console.log('[mobile-checkout] VEHICLE CURRENCY GUARD:', {
      order_id: existingOrder.id,
      contains_vehicle: containsVehicle,
      contains_vehicle_quote: hasVehicleQuoteItems,
      vehicle_detection_reasons: vehicleDetection.reasons,
      vehicle_items: vehicleDetection.vehicleItems.map(v => ({
        id: v.id,
        title: v.title?.substring(0, 50),
        store: v.store,
        is_vehicle: v.is_vehicle,
        vehicle_quote_applied: v.vehicle_quote_applied,
      })),
      all_items_count: requestedItems.length,
      final_currency: containsVehicle ? 'USD' : 'determined_by_value', // Vehicle orders ALWAYS use USD
    });

    // Calculate totals - SEPARATE vehicle quotes from regular items to prevent double shipping
    let itemCount = 0;
    let regularItemsBase = 0;      // Base prices for regular items (subtotal_usd)
    let regularItemsMargin = 0;    // Margin for regular items
    let vehicleTotal = 0;          // Total for vehicle quote items (already includes quoted shipping)
    let vehicleShipping = 0;       // Shipping already included in vehicle quotes

    requestedItems.forEach(item => {
      const qty = item.quantity || 1;
      itemCount += qty;
      
      if (item.is_vehicle === true && item.vehicle_quote_applied === true) {
        // Vehicle with applied quote - use stored total (shipping already included)
        // DO NOT add calculateShipping() for these items
        vehicleTotal += Number(item.total_price_usd || 0);
        vehicleShipping += Number(item.shipping_fee_usd || 0);
      } else {
        // Regular item - will calculate shipping separately
        regularItemsBase += Number(item.subtotal_usd || 0);
        regularItemsMargin += Number(item.markup_fee_usd || 0);
      }
    });

    // 🔒 CRITICAL: For vehicle quote items, OVERRIDE with DB quote totals (ignore client amounts)
    if (hasVehicleQuoteItems && vehicleQuoteValidation && vehicleQuoteValidation.valid) {
      const dbQuoteTotal = vehicleQuoteValidation.totalAmount;
      console.log('[mobile-checkout] VEHICLE AMOUNT OVERRIDE:', {
        client_vehicle_total: vehicleTotal,
        db_quote_total: dbQuoteTotal,
        difference: Math.abs(vehicleTotal - dbQuoteTotal),
        using: 'db_quote_total',
      });
      // Use the DB quote total instead of client-calculated amount
      vehicleTotal = dbQuoteTotal;
    }

    // Calculate shipping ONLY for regular items (non-vehicle)
    const regularShippingFeeUsd = regularItemsBase > 0 
      ? calculateShipping(regularItemsBase, shippingBaseFeeUsd, shippingPercent) 
      : 0;

    // FINAL TOTALS - no double counting
    // Regular items: base + margin + calculated shipping
    // Vehicle items: use stored total_price_usd directly (already has quoted shipping)
    const regularTotal = round2(regularItemsBase + regularItemsMargin + regularShippingFeeUsd);
    const grandTotalUsd = round2(regularTotal + vehicleTotal);
    const grandTotalCdf = round2(grandTotalUsd * exchangeRate);
    
    // For order record: combined values
    const totalItemsUsd = round2(regularItemsBase + (vehicleTotal - vehicleShipping)); // Base prices only
    const totalMarginUsd = round2(regularItemsMargin); // Regular items margin only
    const shippingFeeUsd = round2(regularShippingFeeUsd + vehicleShipping); // Combined shipping

    // VALIDATION: Reject invalid amounts
    if (!Number.isFinite(grandTotalUsd) || grandTotalUsd <= 0) {
      console.error('[mobile-checkout] INVALID AMOUNT:', { grandTotalUsd, itemCount, regularTotal, vehicleTotal });
      return jsonResponse({
        success: false,
        code: 'INVALID_AMOUNT',
        error: 'Unable to calculate order total. Please refresh and try again.',
      }, 400);
    }

    // 💰 PAYMENT METHOD-AWARE CURRENCY ENFORCEMENT
    let paymentCurrency: 'USD' | 'CDF';
    let paymentAmount: number;
    let amountFormatted: string;
    let displayAmount: string;
    let maishapayFlowUsed: MaishapayFlow;
    let currencyReason: string;

    // 🚗 VEHICLE + CARD: Block with friendly message (user must use Mobile Money)
    if ((hasVehicleQuoteItems || containsVehicle) && REQUESTED_METHOD === 'CARD') {
      console.log('[mobile-checkout] VEHICLE_CARD_BLOCKED:', {
        orderId: existingOrder.id,
        hasVehicleQuoteItems,
        containsVehicle,
        requestedMethod: REQUESTED_METHOD,
      });
      return jsonResponse({
        success: false,
        code: VEHICLE_CARD_NOT_AVAILABLE_ERROR.code,
        message_fr: VEHICLE_CARD_NOT_AVAILABLE_ERROR.message_fr,
        message_en: VEHICLE_CARD_NOT_AVAILABLE_ERROR.message_en,
        error: 'Card payment not available for vehicle orders',
      }, 400);
    }

    // Parse client-requested currency (allows dual currency support for DRC Mobile Money)
    const clientRequestedCurrency = (body.currency || '').toUpperCase();
    
    if (REQUESTED_METHOD === 'MOBILE_MONEY') {
      // A) MOBILE MONEY: DRC supports BOTH CDF and USD; others use USD
      if (isDRC) {
        // Allow client to explicitly request USD for DRC Mobile Money
        if (clientRequestedCurrency === 'USD') {
          paymentCurrency = 'USD';
          paymentAmount = round2(grandTotalUsd);
          amountFormatted = grandTotalUsd.toFixed(2);
          displayAmount = `$${grandTotalUsd.toFixed(2)} USD`;
          maishapayFlowUsed = 'MOBILE_MONEY_SESSION';
          currencyReason = 'mobile_money_drc_usd_client_requested';
        } else {
          // Default to CDF for DRC Mobile Money (most common)
          paymentCurrency = 'CDF';
          paymentAmount = Math.round(grandTotalCdf); // CDF has no decimals
          amountFormatted = paymentAmount.toString();
          displayAmount = `${paymentAmount.toLocaleString('fr-FR')} CDF`;
          maishapayFlowUsed = 'MOBILE_MONEY_SESSION';
          currencyReason = 'mobile_money_drc_cdf_default';
        }
      } else {
        paymentCurrency = 'USD';
        paymentAmount = round2(grandTotalUsd);
        amountFormatted = grandTotalUsd.toFixed(2);
        displayAmount = `$${grandTotalUsd.toFixed(2)} USD`;
        maishapayFlowUsed = 'MOBILE_MONEY_SESSION';
        currencyReason = 'mobile_money_non_drc_usd';
      }
    } else {
      // B) CARD: DRC uses CDF (never USD+CD), others use USD
      if (isDRC) {
        // Force CDF for card in DRC to avoid "USD+CD" combination error
        paymentCurrency = 'CDF';
        paymentAmount = Math.round(grandTotalCdf);
        amountFormatted = paymentAmount.toString();
        displayAmount = `${paymentAmount.toLocaleString('fr-FR')} CDF`;
        maishapayFlowUsed = 'CARD_SESSION';
        currencyReason = 'card_drc_cdf_enforced';
      } else {
        paymentCurrency = 'USD';
        paymentAmount = round2(grandTotalUsd);
        amountFormatted = grandTotalUsd.toFixed(2);
        displayAmount = `$${grandTotalUsd.toFixed(2)} USD`;
        maishapayFlowUsed = 'CARD_SESSION';
        currencyReason = 'card_non_drc_usd';
      }
    }

    // 🛡️ GUARD: Ensure correct currency/country combination (final safety check)
    if (isDRC && paymentCurrency === 'USD' && REQUESTED_METHOD === 'CARD') {
      console.error('[mobile-checkout] CHECKOUT_METHOD_MISMATCH: USD+CD for card is invalid');
      return jsonResponse({
        success: false,
        code: CHECKOUT_METHOD_MISMATCH_ERROR.code,
        message_fr: CHECKOUT_METHOD_MISMATCH_ERROR.message_fr,
        message_en: CHECKOUT_METHOD_MISMATCH_ERROR.message_en,
        error: 'USD currency not supported for card payments in DRC',
      }, 400);
    }

    // Generate motif (transaction description)
    const motif = `Paiement AfriShop - Commande ${existingOrder.id.slice(0, 8).toUpperCase()}`;

    // 📊 COMPREHENSIVE CHECKOUT SESSION AUDIT LOG
    console.log('[mobile-checkout] CHECKOUT_SESSION_AUDIT:', JSON.stringify({
      orderId: existingOrder.id,
      REQUESTED_METHOD,
      containsVehicleQuote: hasVehicleQuoteItems,
      buyerCountry: profile.country,
      isDRC,
      incoming: {
        currency: body.currency || 'not_provided',
        clientRequestedCurrency: clientRequestedCurrency || 'not_provided',
        amount: body.amount || 'not_provided',
        isoCode: body.isoCode || 'not_provided',
        payment_method: body.payment_method || body.method || body.channel || 'not_provided',
      },
      final: {
        currency: paymentCurrency,
        amount: paymentAmount,
        amountFormatted,
        isoCode,
        countryCode,
        motif,
      },
      dualCurrencyInfo: {
        usd: { amount: grandTotalUsd, display: `$${grandTotalUsd.toFixed(2)} USD` },
        cdf: { amount: grandTotalCdf, display: `${Math.round(grandTotalCdf).toLocaleString('fr-FR')} CDF` },
        exchangeRate,
      },
      maishapayFlowUsed,
      currencyReason,
      vehicleQuoteDetails: hasVehicleQuoteItems ? {
        orderItemIds: vehicleQuoteItems.map(v => v.id),
        quoteCurrency: 'USD',
        dbQuoteTotal: vehicleQuoteValidation?.totalAmount || 0,
        quoteRecords: vehicleQuoteValidation?.quoteDetails || [],
      } : null,
      breakdown: {
        regular_items_base: regularItemsBase,
        regular_items_margin: regularItemsMargin,
        regular_shipping: regularShippingFeeUsd,
        regular_total: regularTotal,
        vehicle_total: vehicleTotal,
        vehicle_shipping_included: vehicleShipping,
        grand_total_usd: grandTotalUsd,
        grand_total_cdf: grandTotalCdf,
      },
    }, null, 2));

    // Create checkout order
    const timestamp = Date.now().toString(36);
    
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
        shipping_city: mapToShippingCity(profile.city),
        // Vehicle payment audit fields
        contains_vehicle: containsVehicle,
        normalized_currency: paymentCurrency,
        normalized_amount: paymentAmount,
      })
      .select()
      .single();

    if (createOrderError) {
      console.error('[mobile-checkout] Error creating checkout order:', createOrderError);
      return jsonResponse({ success: false, error: 'Failed to create order. Please try again.' }, 500);
    }

    const reference = `AFRISHOP-${checkoutOrder.id.slice(0, 8)}-${timestamp}`;

    await supabase.from('orders').update({
      maisha_transaction_id: reference,
    }).eq('id', checkoutOrder.id);

    // Move items to new order
    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: checkoutOrder.id })
      .in('id', cart_item_ids);

    if (moveItemsError) {
      console.error('[mobile-checkout] Error moving items to checkout order:', moveItemsError);
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ success: false, error: 'Failed to process checkout. Please try again.' }, 500);
    }

    // Create payment record
    await supabase
      .from('maisha_payments')
      .insert({
        order_id: checkoutOrder.id,
        maisha_reference: reference,
        amount_usd: grandTotalUsd,
        amount_cdf: grandTotalCdf,
        currency: paymentCurrency,
        status: 'pending',
        user_id: user.id,
        raw_request: {
          amount: paymentAmount,
          currency: paymentCurrency,
          email: profile.email || user.email,
          phone: profile.phone,
          customerName: profile.full_name,
        },
      });

    // Get MaishaPay configuration
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
    const legacyMode = Deno.env.get('MAISHAPAY_MODE');
    const isLiveMode = gatewayMode === '1' || legacyMode === '1' || legacyMode?.toLowerCase() === 'live';
    
    const primarySecretKey = Deno.env.get('MAISHAPAY_SECRET_API_KEY');
    
    let publicKey: string;
    let secretKey: string;
    
    if (isLiveMode) {
      publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
      secretKey = primarySecretKey || Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || Deno.env.get('MAISHAPAY_SECRET_KEY') || '';
    } else {
      publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
      secretKey = primarySecretKey || Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || Deno.env.get('MAISHAPAY_SECRET_KEY') || '';
    }
    
    if (!publicKey || !secretKey) {
      console.error('[mobile-checkout] Missing MaishaPay keys');
      return jsonResponse({
        success: false,
        code: 'CHECKOUT_URL_ERROR',
        error: 'Payment gateway not configured. Please contact support.',
      }, 500);
    }

    // Use mobile callback URL for WebView interception
    const mobileCallbackUrl = Deno.env.get('MAISHAPAY_MOBILE_CALLBACK_URL') || 'https://afri-shop.com/payment-callback';
    const callbackUrl = mobileCallbackUrl;
    
    // Generate HTML for mobile WebView with country/ISO codes and motif for MaishaPay
    const html = generateCheckoutHtml({
      publicKey,
      secretKey,
      gatewayMode: isLiveMode ? '1' : '0',
      amount: amountFormatted,
      currency: paymentCurrency,
      displayAmount,
      reference,
      callbackUrl,
      orderId: checkoutOrder.id,
      isoCode: isDRC ? isoCode : undefined, // Only include for DRC
      countryCode: isDRC ? countryCode : undefined,
      motif, // Transaction description per MaishaPay API spec
      phone: profile.phone || undefined, // Recipient phone for MaishaPay
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const checkoutUrl = `${supabaseUrl}/functions/v1/maishapay-checkout-page?order_id=${checkoutOrder.id}`;
    const confirmationId = checkoutOrder.id.substring(0, 8).toUpperCase();

    console.log('[mobile-checkout] Order created successfully');
    console.log('[mobile-checkout] Order details:', {
      orderId: checkoutOrder.id,
      confirmationId,
      reference,
      grandTotalUsd,
      checkoutUrl,
    });

    // Return BOTH checkoutUrl AND html for compatibility with both USD and CDF amounts
    return jsonResponse({
      success: true,
      orderId: checkoutOrder.id,
      confirmationId,
      checkoutUrl,
      html, // Mobile app can render this directly in WebView
      order: {
        id: checkoutOrder.id,
        confirmationId,
        status: 'PENDING_PAYMENT',
        itemCount,
        totalUsd: grandTotalUsd,
        totalCdf: grandTotalCdf,
      },
      // 💰 Payment details with both currency amounts for mobile display
      paymentDetails: {
        currency: paymentCurrency,
        amount: paymentAmount,
        displayAmount,
        // Alternative currency amount for display purposes
        alternativeAmount: paymentCurrency === 'CDF' 
          ? { currency: 'USD', amount: grandTotalUsd, display: `$${grandTotalUsd.toFixed(2)} USD` }
          : { currency: 'CDF', amount: Math.round(grandTotalCdf), display: `${Math.round(grandTotalCdf).toLocaleString('fr-FR')} CDF` },
        exchangeRate,
        currencyReason,
      },
    });

  } catch (error: any) {
    console.error('[mobile-checkout] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ success: false, error: error.message }, error.status);
    }
    
    return jsonResponse({ success: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
});

function mapToShippingCity(city: string | null): 'KINSHASA' | 'LUBUMBASHI' | 'OTHER' | null {
  if (!city) return null;
  const normalized = city.toUpperCase().trim();
  if (normalized === 'KINSHASA') return 'KINSHASA';
  if (normalized === 'LUBUMBASHI') return 'LUBUMBASHI';
  return 'OTHER';
}
