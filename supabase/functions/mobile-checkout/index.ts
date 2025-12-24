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
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

// Payment method types
type PaymentMethod = 'MOBILE_MONEY' | 'CARD';
type MaishapayFlow = 'MOBILE_MONEY_SESSION' | 'CARD_SESSION';

/**
 * Mobile Checkout Edge Function - P0 STABILIZATION (2025-12-24)
 * 
 * CRITICAL FIXES:
 * 1. Server is SINGLE SOURCE OF TRUTH for totals - frontend NEVER sends totals
 * 2. Creates checkout_session record with integrity_hash
 * 3. Returns totals_breakdown for frontend display
 * 4. Structured logs: CHECKOUT_INIT, CHECKOUT_DEDUPED, CHECKOUT_TOTALS_RECOMPUTED, etc.
 * 5. CHECKOUT_PAYABLE_FINAL log proves UI vs server equality
 */

// ============================================
// P0 FIX: Generate integrity hash for checkout session
// ============================================
async function generateIntegrityHash(data: {
  cart_snapshot: any[];
  totals_breakdown: any;
  currency: string;
  pay_method: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const payload = JSON.stringify(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// P0 FIX: Deduplicate cart items by item_id or (store + url)
// ============================================
interface DeduplicatedItem {
  item_id: string;
  store: string;
  url: string;
  title: string;
  image: string | null;
  unit_price: number;
  currency: string;
  quantity: number;
  type: string;
  metadata: any;
  original_item: any;
}

function deduplicateCartItems(items: any[]): { 
  deduped: DeduplicatedItem[]; 
  duplicatesRemoved: number;
  dedupeLog: any[];
} {
  const seen = new Map<string, DeduplicatedItem>();
  const dedupeLog: any[] = [];
  let duplicatesRemoved = 0;

  for (const item of items) {
    // Use item.id as primary key, fallback to store+url hash
    const itemId = item.id || `${item.store}_${item.product_url}`.toLowerCase();
    
    if (seen.has(itemId)) {
      // Duplicate found - merge quantities
      const existing = seen.get(itemId)!;
      const oldQty = existing.quantity;
      existing.quantity += (item.quantity || 1);
      duplicatesRemoved++;
      dedupeLog.push({
        action: 'merged',
        item_id: itemId,
        old_qty: oldQty,
        added_qty: item.quantity || 1,
        new_qty: existing.quantity,
      });
    } else {
      seen.set(itemId, {
        item_id: itemId,
        store: item.store,
        url: item.product_url,
        title: item.title || '',
        image: item.product_image_url || null,
        unit_price: Number(item.base_price_usd || item.unit_price_usd || 0),
        currency: 'USD',
        quantity: item.quantity || 1,
        type: item.is_vehicle ? 'vehicle' : 'regular',
        metadata: {
          shipping_item_type_id: item.shipping_item_type_id,
          is_vehicle: item.is_vehicle,
          vehicle_quote_applied: item.vehicle_quote_applied,
          requires_manual_quote: item.requires_manual_quote,
        },
        original_item: item,
      });
    }
  }

  return {
    deduped: Array.from(seen.values()),
    duplicatesRemoved,
    dedupeLog,
  };
}

// ============================================
// P0 FIX: Recompute totals server-side (SINGLE SOURCE OF TRUTH)
// ============================================
interface TotalsBreakdown {
  subtotal_items: number;
  shipping_fee: number;
  markup_fee: number;
  taxes_fee: number;
  grand_total: number;
  currency: string;
  exchange_rate: number;
  cdf_equivalent: number;
  item_count: number;
  markup_rules_used: any[];
  contains_vehicle: boolean;
  vehicle_quote_total: number;
}

async function recomputeTotalsServerSide(
  items: any[],
  settings: any,
  vehicleQuoteValidation: any | null
): Promise<TotalsBreakdown> {
  const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent } = settings;
  
  let regularItemsBase = 0;
  let regularItemsMargin = 0;
  let vehicleTotal = 0;
  let vehicleShipping = 0;
  let itemCount = 0;
  const markupRulesUsed: any[] = [];

  for (const item of items) {
    const qty = item.quantity || 1;
    itemCount += qty;
    const isVehicle = item.is_vehicle === true;
    const vehicleQuoteApplied = item.vehicle_quote_applied === true;

    if (isVehicle && vehicleQuoteApplied) {
      // Vehicle with applied quote - use stored total (shipping already included)
      vehicleTotal += Number(item.total_price_usd || 0);
      vehicleShipping += Number(item.shipping_fee_usd || 0);
      markupRulesUsed.push({
        item_id: item.id,
        rule: 'vehicle_quote_applied',
        markup_percent: vehicleMarkupPercent,
        source: 'stored_quote',
      });
    } else {
      // Regular item - calculate markup
      const basePrice = Number(item.base_price_usd || item.subtotal_usd || 0);
      const effectiveMarkup = isVehicle ? vehicleMarkupPercent : markupPercent;
      const marginAmount = round2(basePrice * (effectiveMarkup / 100));
      
      regularItemsBase += basePrice;
      regularItemsMargin += marginAmount;
      markupRulesUsed.push({
        item_id: item.id,
        rule: isVehicle ? 'vehicle_pending_quote' : 'standard_markup',
        markup_percent: effectiveMarkup,
        base_price: basePrice,
        margin: marginAmount,
      });
    }
  }

  // P0: If vehicle quote validation succeeded, use DB quote total (override client amounts)
  if (vehicleQuoteValidation && vehicleQuoteValidation.valid) {
    const dbQuoteTotal = vehicleQuoteValidation.totalAmount;
    console.log('CHECKOUT_VEHICLE_QUOTE_OVERRIDE', {
      client_vehicle_total: vehicleTotal,
      db_quote_total: dbQuoteTotal,
      using: 'db_quote_total',
    });
    vehicleTotal = dbQuoteTotal;
  }

  // Calculate shipping for regular items only (vehicles have stored shipping)
  const regularShippingFee = regularItemsBase > 0 
    ? calculateShipping(regularItemsBase, shippingBaseFeeUsd, shippingPercent) 
    : 0;

  const subtotalItems = round2(regularItemsBase + (vehicleTotal - vehicleShipping));
  const shippingFee = round2(regularShippingFee + vehicleShipping);
  const markupFee = round2(regularItemsMargin);
  const taxesFee = 0; // No taxes currently implemented
  const grandTotal = round2(subtotalItems + markupFee + shippingFee + taxesFee);
  const cdfEquivalent = round2(grandTotal * exchangeRate);

  return {
    subtotal_items: subtotalItems,
    shipping_fee: shippingFee,
    markup_fee: markupFee,
    taxes_fee: taxesFee,
    grand_total: grandTotal,
    currency: 'USD',
    exchange_rate: exchangeRate,
    cdf_equivalent: cdfEquivalent,
    item_count: itemCount,
    markup_rules_used: markupRulesUsed,
    contains_vehicle: items.some(i => i.is_vehicle === true),
    vehicle_quote_total: vehicleTotal,
  };
}

// STEP 1: Parse and normalize payment method from payload
function parsePaymentMethod(body: Record<string, any>): PaymentMethod {
  const rawMethod = (body.payment_method || body.method || body.channel || body.pay_with || '').toString().toUpperCase();
  
  if (rawMethod.includes('CARD') || rawMethod.includes('VISA') || rawMethod.includes('MASTER') || 
      rawMethod.includes('CREDIT') || rawMethod.includes('DEBIT')) {
    return 'CARD';
  }
  
  if (rawMethod.includes('MOBILE') || rawMethod.includes('MOMO') || rawMethod.includes('MPESA') ||
      rawMethod.includes('AIRTEL') || rawMethod.includes('ORANGE')) {
    return 'MOBILE_MONEY';
  }
  
  return 'MOBILE_MONEY';
}

// Detect buyer country and derive ISO code from multiple sources
function detectBuyerCountry(
  profile: { country?: string | null },
  payload: Record<string, any> = {}
): { isDRC: boolean; isoCode: string; countryCode: string } {
  const payloadIso = (
    payload.isoCode || 
    payload.recipient?.countryCode || 
    payload.customer?.countryCode || 
    ''
  ).toUpperCase();
  
  const profileCountry = (profile?.country || '').toUpperCase();
  
  let detectedIso = payloadIso;
  
  if (!detectedIso) {
    const isDRCFromProfile = profileCountry.includes('CONGO') || 
                             profileCountry === 'CD' || 
                             profileCountry === 'DRC' ||
                             profileCountry === 'DR CONGO' ||
                             profileCountry === 'RDC' ||
                             profileCountry === '';
    detectedIso = isDRCFromProfile ? 'CD' : (profileCountry.slice(0, 2) || 'CD');
  }
  
  const isDRC = detectedIso === 'CD';
  
  return { isDRC, isoCode: detectedIso, countryCode: detectedIso };
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
  // 🔖 VERSION MARKER - P0 STABILIZATION BUILD
  console.log("MOBILE_CHECKOUT_VERSION", "v2025-12-24-p0-payable-final");
  
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    // ============================================
    // CHECKOUT_INIT: Log entry point
    // ============================================
    console.log('CHECKOUT_INIT', { timestamp: new Date().toISOString() });

    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-checkout] User authenticated:', user.id);

    const body = await req.json();
    const { cart_item_ids, notes } = body;

    // ============================================
    // P0 CRITICAL: Capture client amounts as DEBUG ONLY
    // These values are NEVER used in calculations or MaishaPay calls
    // ============================================
    const ui_amount_usd = body.amount_usd !== undefined ? Number(body.amount_usd) : null;
    const ui_amount_cdf = body.amount_cdf !== undefined ? Number(body.amount_cdf) : null;
    
    // Also capture legacy total fields as debug
    const ui_total = body.total !== undefined ? Number(body.total) : null;
    const ui_amount = body.amount !== undefined ? Number(body.amount) : null;
    const ui_grand_total = body.grand_total !== undefined ? Number(body.grand_total) : null;

    // Log all client-sent amounts (debug only - NEVER used for payment)
    if (ui_amount_usd !== null || ui_amount_cdf !== null || ui_total !== null || ui_amount !== null || ui_grand_total !== null) {
      console.log('CHECKOUT_CLIENT_AMOUNTS_DEBUG_ONLY', {
        ui_amount_usd,
        ui_amount_cdf,
        ui_total,
        ui_amount,
        ui_grand_total,
        reason: 'Client amounts captured for debugging only - server is single source of truth',
      });
    }

    // Parse payment method and currency from payload
    const REQUESTED_METHOD: PaymentMethod = parsePaymentMethod(body);
    const clientRequestedCurrency = (body.currency || '').toUpperCase();
    
    // P0 FIX: Validate currency (card = USD only)
    if (REQUESTED_METHOD === 'CARD' && clientRequestedCurrency === 'CDF') {
      console.log('CHECKOUT_CURRENCY_OVERRIDE', {
        requested: 'CDF',
        enforced: 'USD',
        reason: 'Card payments only support USD',
      });
    }

    console.log('CHECKOUT_INIT', {
      user_id: user.id,
      cart_item_ids_count: cart_item_ids?.length || 0,
      pay_method: REQUESTED_METHOD,
      currency: clientRequestedCurrency || 'not_specified',
    });

    // P0 FIX: Validate cart_items is not empty
    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      console.log('CHECKOUT_ERROR', { code: 'EMPTY_CART', cart_item_ids });
      return jsonResponse({ 
        success: false, 
        code: 'EMPTY_CART',
        error: 'cart_item_ids array is required and must not be empty' 
      }, 400);
    }

    // Fetch user profile for shipping details
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, email, full_name, name, phone, address_line1, address_line2, city, state_province, postal_code, country')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[mobile-checkout] Error fetching profile:', profileError);
    }

    if (!isProfileComplete(userProfile)) {
      const missingFields = getMissingProfileFields(userProfile);
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

    const profile = userProfile!;
    const { isDRC, isoCode, countryCode } = detectBuyerCountry(profile, body);

    // Get user's DRAFT order
    const providedCartId = body.cart_id || body.cartId || body.order_id || body.orderId;
    const clientCartVersion = Number(body.cart_version) || null;
    let existingOrder: { id: string; cart_version: number } | null = null;
    
    if (providedCartId) {
      const { data: specificOrder, error: specificOrderError } = await supabase
        .from('orders')
        .select('id, cart_version')
        .eq('id', providedCartId)
        .eq('user_id', user.id)
        .eq('status', 'DRAFT')
        .maybeSingle();

      if (specificOrderError) {
        console.error('[mobile-checkout] Error fetching specific cart:', specificOrderError);
        return jsonResponse({ success: false, error: 'Failed to fetch cart data.' }, 500);
      }

      if (!specificOrder) {
        return jsonResponse({
          ok: false,
          success: false,
          code: 'CART_NOT_FOUND',
          message: 'Cart not found or no longer active.',
          cart_id: providedCartId,
        }, 400);
      }
      
      existingOrder = specificOrder;
    } else {
      const { data: draftOrder, error: orderFetchError } = await supabase
        .from('orders')
        .select('id, cart_version')
        .eq('user_id', user.id)
        .eq('status', 'DRAFT')
        .maybeSingle();

      if (orderFetchError) {
        console.error('[mobile-checkout] Error fetching draft order:', orderFetchError);
        return jsonResponse({ success: false, error: 'Failed to fetch cart data.' }, 500);
      }

      if (!draftOrder) {
        return jsonResponse({ 
          success: false, 
          code: 'EMPTY_CART',
          error: 'Your cart is empty. Please add items before checkout.' 
        }, 400);
      }
      
      existingOrder = draftOrder;
    }

    // P1 FIX: Cart version check - ensures cart consistency
    if (clientCartVersion !== null && existingOrder.cart_version !== clientCartVersion) {
      console.warn('CHECKOUT_CART_VERSION_MISMATCH', {
        client_version: clientCartVersion,
        server_version: existingOrder.cart_version,
        order_id: existingOrder.id,
      });

      const { data: currentItems } = await supabase
        .from('order_items')
        .select('id, title, quantity, subtotal_usd, total_price_usd, is_saved_for_later')
        .eq('order_id', existingOrder.id)
        .eq('is_saved_for_later', false);

      return jsonResponse({
        ok: false,
        success: false,
        code: 'CART_VERSION_MISMATCH',
        message: 'Cart changed. Please refresh.',
        client_cart_version: clientCartVersion,
        server_cart_version: existingOrder.cart_version,
        server_cart: {
          cart_id: existingOrder.id,
          cart_version: existingOrder.cart_version,
          items: currentItems || [],
          item_count: currentItems?.length || 0,
        },
      }, 409);
    }

    // Fetch requested items from DB (server-side source of truth)
    const { data: dbItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', cart_item_ids)
      .eq('order_id', existingOrder.id);

    if (itemsError) {
      console.error('[mobile-checkout] Error fetching items:', itemsError);
      return jsonResponse({ success: false, error: 'Failed to fetch cart items.' }, 500);
    }

    const foundItemIds = new Set((dbItems || []).map(item => item.id));
    const missingItemIds = cart_item_ids.filter((id: string) => !foundItemIds.has(id));
    
    if (!dbItems || dbItems.length !== cart_item_ids.length) {
      console.warn('CHECKOUT_CART_DESYNC', {
        requested: cart_item_ids.length,
        found: dbItems?.length || 0,
        missing: missingItemIds,
      });
      return jsonResponse({
        success: false,
        code: 'CART_DESYNC',
        message: 'Cart changed. Please refresh.',
        missing_item_ids: missingItemIds,
        cart_id: existingOrder.id,
      }, 400);
    }

    // Check for saved items
    const savedItems = dbItems.filter(item => item.is_saved_for_later);
    if (savedItems.length > 0) {
      return jsonResponse({ 
        success: false, 
        code: 'SAVED_ITEMS_IN_CART',
        error: 'Cannot checkout items that are saved for later.' 
      }, 400);
    }

    // ============================================
    // CHECKOUT_DEDUPED: Deduplicate cart items
    // ============================================
    const { deduped, duplicatesRemoved, dedupeLog } = deduplicateCartItems(dbItems);
    console.log('CHECKOUT_DEDUPED', {
      original_count: dbItems.length,
      deduped_count: deduped.length,
      duplicates_removed: duplicatesRemoved,
      dedupe_log: dedupeLog,
    });

    // P2 FIX: Check for vehicles requiring manual quote
    const vehiclesWithPendingQuotes = dbItems.filter(item => 
      item.is_vehicle === true && item.vehicle_quote_applied !== true
    );
    
    if (vehiclesWithPendingQuotes.length > 0) {
      console.log('CHECKOUT_QUOTE_REQUIRED', {
        vehicle_count: vehiclesWithPendingQuotes.length,
        vehicle_ids: vehiclesWithPendingQuotes.map(v => v.id),
      });
      
      return jsonResponse({ 
        success: false,
        code: 'QUOTE_REQUIRED',
        message: 'Vehicle items require a custom shipping quote before checkout.',
        summary: {
          has_vehicle_items: true,
          requires_custom_quote: true,
        },
        quoteRequiredItems: vehiclesWithPendingQuotes.map(item => ({
          id: item.id,
          title: item.title,
          productUrl: item.product_url,
          isVehicle: true,
        })),
      }, 400);
    }

    // Get pricing settings
    const settings = await getCachedSettings(supabase);
    const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent } = settings;

    // Vehicle detection and quote validation
    const vehicleDetection = detectVehicleFromItems(dbItems);
    const containsVehicle = vehicleDetection.isVehicle;
    
    const vehicleQuoteItems = dbItems.filter(item => 
      item.is_vehicle === true && item.vehicle_quote_applied === true
    );
    const hasVehicleQuoteItems = vehicleQuoteItems.length > 0;

    let vehicleQuoteValidation: Awaited<ReturnType<typeof fetchAndValidateVehicleQuotes>> | null = null;
    if (hasVehicleQuoteItems) {
      vehicleQuoteValidation = await fetchAndValidateVehicleQuotes(supabase, vehicleQuoteItems);
      
      if (!vehicleQuoteValidation.valid) {
        console.error('CHECKOUT_VEHICLE_QUOTE_INVALID', {
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
    }

    // ============================================
    // CHECKOUT_TOTALS_RECOMPUTED: Server computes totals
    // ============================================
    const totalsBreakdown = await recomputeTotalsServerSide(dbItems, settings, vehicleQuoteValidation);
    
    console.log('CHECKOUT_TOTALS_RECOMPUTED', {
      subtotal_items: totalsBreakdown.subtotal_items,
      shipping_fee: totalsBreakdown.shipping_fee,
      markup_fee: totalsBreakdown.markup_fee,
      taxes_fee: totalsBreakdown.taxes_fee,
      grand_total: totalsBreakdown.grand_total,
      currency: totalsBreakdown.currency,
      cdf_equivalent: totalsBreakdown.cdf_equivalent,
      item_count: totalsBreakdown.item_count,
      contains_vehicle: totalsBreakdown.contains_vehicle,
    });

    // Log each markup rule used
    for (const rule of totalsBreakdown.markup_rules_used) {
      console.log('CHECKOUT_MARKUP_RULE_USED', rule);
    }

    // Validate grand total
    if (!Number.isFinite(totalsBreakdown.grand_total) || totalsBreakdown.grand_total <= 0) {
      console.error('CHECKOUT_INVALID_TOTAL', { 
        grand_total: totalsBreakdown.grand_total, 
        item_count: totalsBreakdown.item_count 
      });
      return jsonResponse({
        success: false,
        code: 'INVALID_AMOUNT',
        error: 'Unable to calculate order total. Please refresh and try again.',
      }, 400);
    }

    // ============================================
    // P0 CRITICAL: Determine SINGLE payable amount and currency
    // This is the ONLY source for MaishaPay amount
    // ============================================
    let payable_currency: 'USD' | 'CDF';
    let payable_amount: number;
    let amountFormatted: string;
    let displayAmount: string;
    let maishapayFlowUsed: MaishapayFlow;
    let currencyReason: string;

    const VEHICLE_CARD_ALLOWED = Deno.env.get('VEHICLE_CARD_ALLOWED') !== 'false';
    const VEHICLE_DEPOSIT_PERCENT = Number(Deno.env.get('VEHICLE_DEPOSIT_PERCENT')) || 0.20;
    const VEHICLE_DEPOSIT_MAX_CDF = Number(Deno.env.get('VEHICLE_DEPOSIT_MAX_CDF')) || 5000000;
    const USD_TO_CDF_RATE = exchangeRate;

    if (hasVehicleQuoteItems || containsVehicle) {
      // Vehicle payment handling
      if (REQUESTED_METHOD === 'CARD' && !VEHICLE_CARD_ALLOWED) {
        console.log('CHECKOUT_VEHICLE_CARD_BLOCKED', {
          orderId: existingOrder.id,
          reason: 'VEHICLE_CARD_ALLOWED=false',
        });
        return jsonResponse({
          ok: false,
          success: false,
          code: 'MAISHAPAY_METHOD_NOT_ALLOWED',
          checkout_type: 'VEHICLE_DEPOSIT_REQUIRED',
          allowed_methods: ['MOBILE_MONEY'],
          requested_method: REQUESTED_METHOD,
          error: 'Card not available for vehicle deposit',
          totals_breakdown: totalsBreakdown,
        }, 400);
      }

      // Calculate deposit amounts from SERVER-COMPUTED totals
      const vehicleTotalUsd = totalsBreakdown.vehicle_quote_total || totalsBreakdown.grand_total;
      const vehicleTotalCdf = Math.round(vehicleTotalUsd * USD_TO_CDF_RATE);
      const calculatedDeposit = Math.round(vehicleTotalCdf * VEHICLE_DEPOSIT_PERCENT);
      const depositAmountCdf = Math.min(calculatedDeposit, VEHICLE_DEPOSIT_MAX_CDF);
      const depositAmountUsd = round2(depositAmountCdf / USD_TO_CDF_RATE);

      // Determine currency based on client request or default to USD
      const vehicleRequestedCurrency = (clientRequestedCurrency === 'CDF' || clientRequestedCurrency === 'USD') 
        ? clientRequestedCurrency 
        : 'USD';

      if (vehicleRequestedCurrency === 'CDF') {
        payable_currency = 'CDF';
        payable_amount = depositAmountCdf;
        amountFormatted = depositAmountCdf.toString();
        displayAmount = `${depositAmountCdf.toLocaleString('fr-FR')} CDF`;
      } else {
        payable_currency = 'USD';
        payable_amount = depositAmountUsd;
        amountFormatted = depositAmountUsd.toFixed(2);
        displayAmount = `$${depositAmountUsd.toFixed(2)} USD`;
      }
      
      maishapayFlowUsed = REQUESTED_METHOD === 'CARD' ? 'CARD_SESSION' : 'MOBILE_MONEY_SESSION';
      currencyReason = `vehicle_deposit_${REQUESTED_METHOD.toLowerCase()}_${payable_currency.toLowerCase()}`;
    } else {
      // Regular item payment - use SERVER-COMPUTED grand_total
      if (REQUESTED_METHOD === 'MOBILE_MONEY') {
        if (clientRequestedCurrency === 'USD') {
          payable_currency = 'USD';
          payable_amount = round2(totalsBreakdown.grand_total);
          amountFormatted = totalsBreakdown.grand_total.toFixed(2);
          displayAmount = `$${totalsBreakdown.grand_total.toFixed(2)} USD`;
          currencyReason = 'mobile_money_usd_selected';
        } else if (clientRequestedCurrency === 'CDF' || isDRC) {
          payable_currency = 'CDF';
          payable_amount = Math.round(totalsBreakdown.cdf_equivalent);
          amountFormatted = payable_amount.toString();
          displayAmount = `${payable_amount.toLocaleString('fr-FR')} CDF`;
          currencyReason = clientRequestedCurrency === 'CDF' ? 'mobile_money_cdf_selected' : 'mobile_money_drc_default';
        } else {
          payable_currency = 'USD';
          payable_amount = round2(totalsBreakdown.grand_total);
          amountFormatted = totalsBreakdown.grand_total.toFixed(2);
          displayAmount = `$${totalsBreakdown.grand_total.toFixed(2)} USD`;
          currencyReason = 'mobile_money_usd_default';
        }
        maishapayFlowUsed = 'MOBILE_MONEY_SESSION';
      } else {
        // CARD: USD only - use SERVER-COMPUTED grand_total
        payable_currency = 'USD';
        payable_amount = round2(totalsBreakdown.grand_total);
        amountFormatted = totalsBreakdown.grand_total.toFixed(2);
        displayAmount = `$${totalsBreakdown.grand_total.toFixed(2)} USD`;
        maishapayFlowUsed = 'CARD_SESSION';
        currencyReason = 'card_usd_only';
      }
    }

    // ============================================
    // Create cart snapshot for checkout_session
    // ============================================
    const cartSnapshot = deduped.map(d => ({
      item_id: d.item_id,
      store: d.store,
      url: d.url,
      title: d.title,
      unit_price: d.unit_price,
      quantity: d.quantity,
      type: d.type,
    }));

    // Generate integrity hash
    const integrityHash = await generateIntegrityHash({
      cart_snapshot: cartSnapshot,
      totals_breakdown: totalsBreakdown,
      currency: payable_currency,
      pay_method: REQUESTED_METHOD,
    });

    // ============================================
    // Create checkout order
    // ============================================
    const timestamp = Date.now().toString(36);
    
    const { data: checkoutOrder, error: createOrderError } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        status: 'PENDING_PAYMENT',
        item_total_usd: round2(totalsBreakdown.subtotal_items),
        service_fee_usd: round2(totalsBreakdown.markup_fee),
        shipping_fee_usd: round2(totalsBreakdown.shipping_fee),
        total_usd: totalsBreakdown.grand_total,
        total_cdf: totalsBreakdown.cdf_equivalent,
        exchange_rate_used: exchangeRate,
        maisha_payment_status: 'PENDING',
        admin_notes: notes || null,
        shipping_city: mapToShippingCity(profile.city),
        contains_vehicle: containsVehicle,
        normalized_currency: payable_currency,
        normalized_amount: payable_amount,
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

    // Move items to new order (P1: only moves, never deletes)
    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: checkoutOrder.id })
      .in('id', cart_item_ids);

    if (moveItemsError) {
      console.error('[mobile-checkout] Error moving items to checkout order:', moveItemsError);
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ success: false, error: 'Failed to process checkout. Please try again.' }, 500);
    }

    // ============================================
    // Create checkout_session record (P0 FIX)
    // ============================================
    const { data: checkoutSession, error: sessionError } = await supabase
      .from('checkout_sessions')
      .insert({
        user_id: user.id,
        order_id: checkoutOrder.id,
        cart_snapshot: cartSnapshot,
        totals_breakdown: totalsBreakdown,
        currency: payable_currency,
        pay_method: REQUESTED_METHOD,
        grand_total: payable_amount,
        integrity_hash: integrityHash,
        maisha_reference: reference,
        status: 'initiated',
        metadata: {
          client_cart_version: clientCartVersion,
          server_cart_version: existingOrder.cart_version,
          isDRC,
          isoCode,
          currencyReason,
          // Store UI amounts for debugging (never used for payment)
          debug_ui_amounts: {
            ui_amount_usd,
            ui_amount_cdf,
            ui_total,
            ui_amount,
            ui_grand_total,
          },
        },
      })
      .select('id')
      .single();

    if (sessionError) {
      console.warn('[mobile-checkout] Failed to create checkout_session (non-fatal):', sessionError);
    }

    // Create payment record - uses payable_amount (server-computed)
    await supabase
      .from('maisha_payments')
      .insert({
        order_id: checkoutOrder.id,
        maisha_reference: reference,
        amount_usd: totalsBreakdown.grand_total,
        amount_cdf: totalsBreakdown.cdf_equivalent,
        currency: payable_currency,
        status: 'pending',
        user_id: user.id,
        raw_request: {
          amount: payable_amount,
          currency: payable_currency,
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

    const mobileCallbackUrl = Deno.env.get('MAISHAPAY_MOBILE_CALLBACK_URL') || 'https://afri-shop.com/payment-callback';
    const motif = `Paiement AfriShop - Commande ${checkoutOrder.id.slice(0, 8).toUpperCase()}`;

    // ============================================
    // CHECKOUT_CREATE_MAISHAPAY: Uses payable_amount (server-computed)
    // ============================================
    console.log('CHECKOUT_CREATE_MAISHAPAY', {
      orderId: checkoutOrder.id,
      checkout_session_id: checkoutSession?.id || null,
      containsVehicle,
      hasVehicleQuoteItems,
      requestedMethod: REQUESTED_METHOD,
      requestedCurrency: clientRequestedCurrency || 'not_specified',
      // P0 CRITICAL: These are the values sent to MaishaPay
      payable_currency,
      payable_amount,
      gatewayMode: isLiveMode ? 'live' : 'sandbox',
      reference,
    });

    // Generate HTML for mobile WebView - uses payable_amount
    const html = generateCheckoutHtml({
      publicKey,
      secretKey,
      gatewayMode: isLiveMode ? '1' : '0',
      amount: amountFormatted,          // Derived from payable_amount
      currency: payable_currency,        // Server-determined
      displayAmount,                     // Derived from payable_amount
      reference,
      callbackUrl: mobileCallbackUrl,
      orderId: checkoutOrder.id,
      isoCode: isDRC ? isoCode : undefined,
      countryCode: isDRC ? countryCode : undefined,
      motif,
      phone: profile.phone || undefined,
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const checkoutUrl = `${supabaseUrl}/functions/v1/maishapay-checkout-page?order_id=${checkoutOrder.id}`;
    const confirmationId = checkoutOrder.id.substring(0, 8).toUpperCase();

    // ============================================
    // CHECKOUT_PAYABLE_FINAL: Proves UI vs server equality
    // This is the critical log that proves what was charged
    // ============================================
    console.log('CHECKOUT_PAYABLE_FINAL', {
      // Client-sent amounts (DEBUG ONLY - never used for payment)
      ui_amount_usd,
      ui_amount_cdf,
      // Server-computed payable amount (ACTUALLY SENT TO MAISHAPAY)
      payable_amount,
      payable_currency,
      // Context
      order_id: checkoutOrder.id,
      user_id: user.id,
      maishapay_reference: reference,
      checkout_session_id: checkoutSession?.id || null,
      // Breakdown for verification
      server_grand_total_usd: totalsBreakdown.grand_total,
      server_cdf_equivalent: totalsBreakdown.cdf_equivalent,
      contains_vehicle: containsVehicle,
      is_deposit: containsVehicle || hasVehicleQuoteItems,
    });

    // ============================================
    // CHECKOUT_FINAL: Success response
    // ============================================
    console.log('CHECKOUT_FINAL', {
      orderId: checkoutOrder.id,
      checkout_session_id: checkoutSession?.id || null,
      confirmationId,
      reference,
      grandTotalUsd: totalsBreakdown.grand_total,
      payable_currency,
      payable_amount,
      integrityHash: integrityHash.slice(0, 16) + '...',
    });

    // Return response with payable_amount, payable_currency, totals_breakdown
    return jsonResponse({
      success: true,
      checkout_type: containsVehicle ? 'VEHICLE_DEPOSIT' : 'FULL_PAYMENT',
      orderId: checkoutOrder.id,
      checkout_session_id: checkoutSession?.id || null,
      confirmationId,
      checkoutUrl,
      html,
      // P0 CRITICAL: Single payable values
      payable_amount,
      payable_currency,
      // Legacy fields for backwards compatibility
      currency: payable_currency,
      amount: payable_amount,
      // P0 FIX: Return totals_breakdown for frontend verification
      totals_breakdown: {
        subtotal: totalsBreakdown.subtotal_items,
        shipping: totalsBreakdown.shipping_fee,
        markup: totalsBreakdown.markup_fee,
        taxes: totalsBreakdown.taxes_fee,
        grand_total: totalsBreakdown.grand_total,
        currency: payable_currency,
        cdf_equivalent: totalsBreakdown.cdf_equivalent,
        exchange_rate: totalsBreakdown.exchange_rate,
        // Vehicle deposit info if applicable
        is_deposit: containsVehicle || hasVehicleQuoteItems,
        vehicle_quote_total: totalsBreakdown.vehicle_quote_total,
      },
      // P0 FIX: Return integrity_hash for verification
      integrity_hash: integrityHash,
      // Debug: client-sent amounts (for comparison, never used for payment)
      debug: {
        ui_amount_usd,
        ui_amount_cdf,
      },
      order: {
        id: checkoutOrder.id,
        confirmationId,
        status: 'PENDING_PAYMENT',
        itemCount: totalsBreakdown.item_count,
        totalUsd: totalsBreakdown.grand_total,
        totalCdf: totalsBreakdown.cdf_equivalent,
      },
      paymentDetails: {
        currency: payable_currency,
        amount: payable_amount,
        displayAmount,
        alternativeAmount: payable_currency === 'CDF' 
          ? { currency: 'USD', amount: totalsBreakdown.grand_total, display: `$${totalsBreakdown.grand_total.toFixed(2)} USD` }
          : { currency: 'CDF', amount: Math.round(totalsBreakdown.cdf_equivalent), display: `${Math.round(totalsBreakdown.cdf_equivalent).toLocaleString('fr-FR')} CDF` },
        exchangeRate,
        currencyReason,
      },
    });

  } catch (error: any) {
    console.error('[mobile-checkout] Error:', error.message);
    const debugId = `err-${Date.now().toString(36)}`;
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        success: false, 
        code: 'AUTH_ERROR',
        error: error.message,
        debug_id: debugId,
      }, error.status);
    }
    
    return jsonResponse({ 
      success: false, 
      code: 'RETRY',
      message: 'Temporary issue, please retry.',
      error: 'An unexpected error occurred. Please try again.',
      debug_id: debugId,
    }, 500);
  }
});

function mapToShippingCity(city: string | null): 'KINSHASA' | 'LUBUMBASHI' | 'OTHER' | null {
  if (!city) return null;
  const normalized = city.toUpperCase().trim();
  if (normalized === 'KINSHASA') return 'KINSHASA';
  if (normalized === 'LUBUMBASHI') return 'LUBUMBASHI';
  return 'OTHER';
}
