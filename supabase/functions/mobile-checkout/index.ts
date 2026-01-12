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
  fetchAndValidateVehicleQuotes, 
  VEHICLE_QUOTE_MISSING_ERROR,
} from "../_shared/vehiclePaymentGuard.ts";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { 
  getActiveProvider, 
  createPaymentRecord,
  generatePaymentReference as generateProviderRef,
  validateProviderSecrets,
} from "../_shared/paymentProviders.ts";
import { createDeposit, getPawaPayConfig, ConfigMissingError } from "../_shared/pawapayAdapter.ts";

// Payment method types
type PaymentMethod = 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER';

// Payment flow types - MaishaPay REMOVED
type PaymentFlow = 'PAWAPAY' | 'STRIPE' | 'BANK_TRANSFER' | 'CHOICE_REQUIRED';

// Payment method preference for large orders
type PaymentMethodPreference = 'CARD' | 'BANK_TRANSFER';

// Payment settings from database
interface PaymentSettings {
  mobile_money_max_usd: number;
  mobile_money_max_cdf: number;
  large_order_currency: string;
  stripe_enabled: boolean;
  bank_transfer_enabled: boolean;
  pawapay_enabled: boolean;
}

// Default payment settings (fallback)
const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  mobile_money_max_usd: 250,
  mobile_money_max_cdf: 1500000,
  large_order_currency: 'USD',
  stripe_enabled: true,
  bank_transfer_enabled: true,
  pawapay_enabled: true,
};

// Fetch payment settings from database
async function getPaymentSettings(supabase: any): Promise<PaymentSettings> {
  try {
    const { data, error } = await supabase
      .from('payment_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    
    if (error) {
      console.warn('[mobile-checkout] Error fetching payment_settings:', error.message);
      return DEFAULT_PAYMENT_SETTINGS;
    }
    
    if (!data) {
      console.warn('[mobile-checkout] No payment_settings found, using defaults');
      return DEFAULT_PAYMENT_SETTINGS;
    }
    
    return {
      mobile_money_max_usd: Number(data.mobile_money_max_usd) || DEFAULT_PAYMENT_SETTINGS.mobile_money_max_usd,
      mobile_money_max_cdf: Number(data.mobile_money_max_cdf) || DEFAULT_PAYMENT_SETTINGS.mobile_money_max_cdf,
      large_order_currency: data.large_order_currency || 'USD',
      stripe_enabled: data.stripe_enabled !== false,
      bank_transfer_enabled: data.bank_transfer_enabled !== false,
      pawapay_enabled: data.pawapay_enabled !== false,
    };
  } catch (e: any) {
    console.error('[mobile-checkout] Exception fetching payment_settings:', e.message);
    return DEFAULT_PAYMENT_SETTINGS;
  }
}

// Check if amount exceeds mobile money limits
function isOverMobileMoneyLimit(
  amount: number,
  currency: 'USD' | 'CDF',
  paymentSettings: PaymentSettings
): boolean {
  if (currency === 'USD') {
    return amount > paymentSettings.mobile_money_max_usd;
  }
  return amount > paymentSettings.mobile_money_max_cdf;
}

// Get available payment options for large orders
function getLargeOrderOptions(paymentSettings: PaymentSettings): ('STRIPE' | 'BANK_TRANSFER')[] {
  const options: ('STRIPE' | 'BANK_TRANSFER')[] = [];
  if (paymentSettings.stripe_enabled) options.push('STRIPE');
  if (paymentSettings.bank_transfer_enabled) options.push('BANK_TRANSFER');
  return options;
}

/**
 * Mobile Checkout Edge Function - P0 FULL PAYMENT (2026-01)
 * 
 * CRITICAL REQUIREMENTS:
 * 1. Server is SINGLE SOURCE OF TRUTH for totals - client amounts are DEBUG ONLY
 * 2. NO DEPOSIT LOGIC - ALL orders (including vehicles) pay FULL PRICE
 * 3. NO CAPS/LIMITS - payable_amount = server-computed grand_total
 * 4. MaishaPay REMOVED - Only pawaPay for mobile money, Stripe for cards, Bank Transfer for vehicles
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
// NO CAPS, NO LIMITS, NO DEPOSIT LOGIC
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

serve(async (req) => {
  // 🔖 VERSION MARKER - P0 FULL PAYMENT (NO MAISHAPAY)
  console.log("MOBILE_CHECKOUT_VERSION", "v2026-01-12-no-maishapay");
  
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    // ============================================
    // CHECKOUT_INIT: Log entry point
    // ============================================
    console.log('[mobile-checkout] CHECKOUT_INIT', { timestamp: new Date().toISOString() });

    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-checkout] User authenticated:', user.id);

    const body = await req.json();
    const { cart_item_ids, notes } = body;

    // ============================================
    // P0 CRITICAL: Capture client amounts as DEBUG ONLY
    // These values are NEVER used in calculations
    // ============================================
    const ui_amount_usd = body.amount_usd !== undefined ? Number(body.amount_usd) : null;
    const ui_amount_cdf = body.amount_cdf !== undefined ? Number(body.amount_cdf) : null;
    
    // Also capture legacy total fields as debug
    const ui_total = body.total !== undefined ? Number(body.total) : null;
    const ui_amount = body.amount !== undefined ? Number(body.amount) : null;
    const ui_grand_total = body.grand_total !== undefined ? Number(body.grand_total) : null;

    // Log all client-sent amounts (debug only - NEVER used for payment)
    if (ui_amount_usd !== null || ui_amount_cdf !== null || ui_total !== null || ui_amount !== null || ui_grand_total !== null) {
      console.log('[mobile-checkout] CHECKOUT_CLIENT_AMOUNTS_DEBUG_ONLY', {
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
      console.log('[mobile-checkout] CHECKOUT_CURRENCY_OVERRIDE', {
        requested: 'CDF',
        enforced: 'USD',
        reason: 'Card payments only support USD',
      });
    }

    console.log('[mobile-checkout] CHECKOUT_INIT', {
      user_id: user.id,
      cart_item_ids_count: cart_item_ids?.length || 0,
      pay_method: REQUESTED_METHOD,
      currency: clientRequestedCurrency || 'not_specified',
    });

    // P0 FIX: Validate cart_items is not empty
    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
      console.log('[mobile-checkout] CHECKOUT_ERROR', { code: 'EMPTY_CART', cart_item_ids });
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
      
      console.log('[mobile-checkout] PROFILE_INCOMPLETE', { userId: user.id, missingFields });
      return jsonResponse({
        success: false,
        code: 'PROFILE_INCOMPLETE',
        message: `Please add your ${missingFieldNames} to your profile before checkout.`,
        error: `Please add your ${missingFieldNames} to your profile before checkout.`,
        missingFields,
      }, 400);
    }

    const profile = userProfile!;

    // ============================================
    // P0 FIX: Phone normalization & validation to E.164
    // Load from profile ONLY, NOT from payload
    // ============================================
    const rawPhone = (profile.phone || '').trim();
    
    // Step 1: Check if phone exists
    if (!rawPhone) {
      console.log('[mobile-checkout] [profile-phone]', { 
        phone_last4: 'N/A',
        phone_valid: false,
        reason: 'missing',
      });
      return jsonResponse({
        success: false,
        code: 'PHONE_REQUIRED',
        message: 'Phone number missing in profile',
        error: 'A valid phone number is required in your profile before checkout.',
      }, 400);
    }
    
    // Step 2: Normalize phone - remove spaces, dashes, parentheses
    let normalizedPhone = rawPhone.replace(/[\s\-()]/g, '');
    
    // Step 3: Ensure starts with + 
    if (!normalizedPhone.startsWith('+')) {
      // Try to add + if it looks like international format
      if (normalizedPhone.startsWith('00')) {
        normalizedPhone = '+' + normalizedPhone.slice(2);
      } else if (normalizedPhone.startsWith('243')) {
        // DRC country code without +
        normalizedPhone = '+' + normalizedPhone;
      } else if (normalizedPhone.startsWith('0')) {
        // Local format - assume DRC
        normalizedPhone = '+243' + normalizedPhone.slice(1);
      } else if (/^[1-9]/.test(normalizedPhone)) {
        // Starts with digit but no prefix - assume needs +
        normalizedPhone = '+' + normalizedPhone;
      }
    }
    
    // Step 4: Validate E.164 format: +[country][number] = 10-15 digits after +
    const e164Regex = /^\+\d{10,15}$/;
    const phoneValid = e164Regex.test(normalizedPhone);
    const phoneLast4 = normalizedPhone.slice(-4);
    
    console.log('[mobile-checkout] [profile-phone]', { 
      phone_last4: phoneLast4,
      phone_valid: phoneValid,
      phone_length: normalizedPhone.length,
    });
    
    if (!phoneValid) {
      return jsonResponse({
        success: false,
        code: 'INVALID_PHONE',
        message: 'Phone number invalid. Please update your profile phone in international format like +243...',
        error: 'Phone number must be in international format (e.g., +243812345678).',
      }, 400);
    }
    
    // Store normalized phone for later use
    const validatedPhone = normalizedPhone;
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
      console.warn('[mobile-checkout] CHECKOUT_CART_VERSION_MISMATCH', {
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
      console.warn('[mobile-checkout] CHECKOUT_CART_DESYNC', {
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
    // P0 CRITICAL: Check for pending price confirmations
    // Block checkout if any item has a pending price confirmation
    // ============================================
    const pendingPriceItems = dbItems.filter(item => {
      // Check all possible locations for pending status (case-insensitive)
      const rawStatus = String(
        item.price_confirmation_status ||
        item.meta?.price_confirmation_status ||
        item.meta?.priceConfirmationStatus ||
        ''
      ).toUpperCase().trim();
      
      return rawStatus === 'PENDING';
    });

    if (pendingPriceItems.length > 0) {
      console.log('[mobile-checkout] CHECKOUT_PRICE_CONFIRMATION_REQUIRED', {
        pending_count: pendingPriceItems.length,
        pending_item_ids: pendingPriceItems.map(i => i.id),
      });

      return jsonResponse({
        ok: false,
        success: false,
        code: 'PRICE_CONFIRMATION_REQUIRED',
        message_fr: "Un ou plusieurs articles ont un prix modifié en attente de vérification. Vous recevrez un e-mail après confirmation.",
        message_en: "One or more items have an edited price pending admin review. You'll receive an email once approved.",
        pendingItems: pendingPriceItems.map(item => ({
          id: item.id,
          name: item.title || 'Unknown item',
          url: item.product_url,
        })),
      }, 409);
    }

    // ============================================
    // CHECKOUT_DEDUPED: Deduplicate cart items
    // ============================================
    const { deduped, duplicatesRemoved, dedupeLog } = deduplicateCartItems(dbItems);
    console.log('[mobile-checkout] CHECKOUT_DEDUPED', {
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
      console.log('[mobile-checkout] CHECKOUT_QUOTE_REQUIRED', {
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
        console.error('[mobile-checkout] CHECKOUT_VEHICLE_QUOTE_INVALID', {
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
    
    console.log('[mobile-checkout] CHECKOUT_TOTALS_RECOMPUTED', {
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
      console.log('[mobile-checkout] CHECKOUT_MARKUP_RULE_USED', rule);
    }

    // Validate grand total
    if (!Number.isFinite(totalsBreakdown.grand_total) || totalsBreakdown.grand_total <= 0) {
      console.error('[mobile-checkout] CHECKOUT_INVALID_TOTAL', { 
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
    // LOAD PAYMENT SETTINGS FOR LIMIT CHECKING
    // ============================================
    const paymentSettings = await getPaymentSettings(supabase);
    
    console.log('[mobile-checkout] PAYMENT_SETTINGS_LOADED', {
      mobile_money_max_usd: paymentSettings.mobile_money_max_usd,
      mobile_money_max_cdf: paymentSettings.mobile_money_max_cdf,
      stripe_enabled: paymentSettings.stripe_enabled,
      bank_transfer_enabled: paymentSettings.bank_transfer_enabled,
      pawapay_enabled: paymentSettings.pawapay_enabled,
    });

    // Parse payment_method_preference for large orders (new optional field)
    const paymentMethodPreference = (body.payment_method_preference || '').toUpperCase() as '' | 'CARD' | 'BANK_TRANSFER';
    
    // Determine target currency for limit checking
    const targetCurrency: 'USD' | 'CDF' = clientRequestedCurrency === 'CDF' ? 'CDF' : 'USD';
    const amountToCheck = targetCurrency === 'CDF' ? totalsBreakdown.cdf_equivalent : totalsBreakdown.grand_total;
    
    // Check if order exceeds mobile money limits
    const isOverLimit = isOverMobileMoneyLimit(amountToCheck, targetCurrency, paymentSettings);
    const isLargeOrder = containsVehicle || isOverLimit;
    
    console.log('[mobile-checkout] CHECKOUT_LIMIT_CHECK', {
      amount: amountToCheck,
      currency: targetCurrency,
      limit_usd: paymentSettings.mobile_money_max_usd,
      limit_cdf: paymentSettings.mobile_money_max_cdf,
      is_over_limit: isOverLimit,
      contains_vehicle: containsVehicle,
      is_large_order: isLargeOrder,
      payment_method_preference: paymentMethodPreference || 'none',
    });

    // ============================================
    // LARGE ORDER FLOW: CHOICE_REQUIRED or process preference
    // ============================================
    if (isLargeOrder) {
      // If no preference provided, return CHOICE_REQUIRED
      if (!paymentMethodPreference) {
        const availableOptions = getLargeOrderOptions(paymentSettings);
        
        if (availableOptions.length === 0) {
          console.error('[mobile-checkout] NO_LARGE_ORDER_OPTIONS', {
            stripe_enabled: paymentSettings.stripe_enabled,
            bank_transfer_enabled: paymentSettings.bank_transfer_enabled,
          });
          return jsonResponse({
            success: false,
            code: 'NO_PAYMENT_OPTIONS',
            message: 'No payment methods available for large orders. Please contact support.',
            error: 'Large order payment methods are disabled.',
          }, 503);
        }
        
        console.log('[mobile-checkout] CHECKOUT_CHOICE_REQUIRED', {
          order_id: existingOrder.id,
          amount: totalsBreakdown.grand_total,
          original_currency: targetCurrency,
          required_currency: 'USD',
          options: availableOptions,
          reason: containsVehicle ? 'vehicle_order' : 'over_mobile_money_limit',
        });
        
        return jsonResponse({
          success: true,
          order_id: existingOrder.id,
          payment_flow: 'CHOICE_REQUIRED' as PaymentFlow,
          amount: totalsBreakdown.grand_total,
          currency: targetCurrency, // Original user choice (informational)
          required_currency: 'USD', // Required for large orders
          cdf_equivalent: totalsBreakdown.cdf_equivalent,
          options: availableOptions,
          reason: containsVehicle ? 'vehicle_order' : 'over_mobile_money_limit',
          message: 'This order requires Card or Bank Transfer payment in USD.',
          message_fr: 'Cette commande nécessite un paiement par carte ou virement bancaire en USD.',
          totals_breakdown: {
            subtotal: totalsBreakdown.subtotal_items,
            shipping: totalsBreakdown.shipping_fee,
            markup: totalsBreakdown.markup_fee,
            taxes: totalsBreakdown.taxes_fee,
            grand_total: totalsBreakdown.grand_total,
            currency: 'USD',
            cdf_equivalent: totalsBreakdown.cdf_equivalent,
            exchange_rate: totalsBreakdown.exchange_rate,
          },
        });
      }
      
      // Preference provided - validate and process
      
      // ENFORCE USD ONLY for large orders
      if (clientRequestedCurrency === 'CDF') {
        console.log('[mobile-checkout] USD_REQUIRED_FOR_LARGE_ORDER', {
          requested_currency: 'CDF',
          required_currency: 'USD',
          payment_method_preference: paymentMethodPreference,
        });
        return jsonResponse({
          success: false,
          code: 'USD_REQUIRED_FOR_LARGE_ORDER',
          message: 'Card/Bank transfer requires USD.',
          error: 'Large order payments must be in USD.',
          required_currency: 'USD',
        }, 400);
      }
      
      // Check if selected method is enabled
      if (paymentMethodPreference === 'CARD' && !paymentSettings.stripe_enabled) {
        return jsonResponse({
          success: false,
          code: 'PAYMENT_METHOD_DISABLED',
          message: 'Card payments are currently disabled. Please use Bank Transfer.',
          error: 'Stripe is not enabled.',
        }, 400);
      }
      
      if (paymentMethodPreference === 'BANK_TRANSFER' && !paymentSettings.bank_transfer_enabled) {
        return jsonResponse({
          success: false,
          code: 'PAYMENT_METHOD_DISABLED',
          message: 'Bank Transfer is currently disabled. Please use Card payment.',
          error: 'Bank Transfer is not enabled.',
        }, 400);
      }
    }

    // ============================================
    // Check if pawaPay is enabled for standard orders
    // ============================================
    if (!isLargeOrder && !paymentSettings.pawapay_enabled) {
      console.log('[mobile-checkout] PAWAPAY_DISABLED', {
        grand_total: totalsBreakdown.grand_total,
      });
      return jsonResponse({
        success: false,
        code: 'MOBILE_MONEY_DISABLED',
        message: 'Mobile money payments are currently disabled. Please use Card or Bank Transfer.',
        error: 'pawaPay is disabled in settings.',
      }, 503);
    }

    // ============================================
    // P0 CRITICAL: Determine SINGLE payable amount and currency
    // NO CAPS, NO LIMITS, NO DEPOSIT - FULL GRAND TOTAL ONLY
    // ============================================
    let payable_currency: 'USD' | 'CDF';
    let payable_amount: number;
    let amountFormatted: string;
    let displayAmount: string;
    let currencyReason: string;

    // pawaPay supported currencies for DRC
    const PAWAPAY_SUPPORTED_CURRENCIES = ['USD', 'CDF'];
    
    // ALL items pay FULL PRICE upfront - no deposit, no caps, no limits
    if (REQUESTED_METHOD === 'MOBILE_MONEY') {
      // Validate currency is supported by pawaPay
      if (clientRequestedCurrency && !PAWAPAY_SUPPORTED_CURRENCIES.includes(clientRequestedCurrency)) {
        console.log('[mobile-checkout] CURRENCY_NOT_SUPPORTED', {
          requested: clientRequestedCurrency,
          supported: PAWAPAY_SUPPORTED_CURRENCIES,
        });
        return jsonResponse({
          success: false,
          code: 'CURRENCY_NOT_SUPPORTED',
          message: 'Selected currency is not supported for this payment method.',
          error: `Currency ${clientRequestedCurrency} is not supported. Use USD or CDF.`,
        }, 400);
      }
      
      if (clientRequestedCurrency === 'USD') {
        payable_currency = 'USD';
        payable_amount = round2(totalsBreakdown.grand_total);
        amountFormatted = payable_amount.toFixed(2);
        displayAmount = `$${amountFormatted} USD`;
        currencyReason = 'mobile_money_usd_full_payment';
      } else if (clientRequestedCurrency === 'CDF' || isDRC) {
        payable_currency = 'CDF';
        payable_amount = Math.round(totalsBreakdown.cdf_equivalent);
        amountFormatted = payable_amount.toString();
        displayAmount = `${payable_amount.toLocaleString('fr-FR')} CDF`;
        currencyReason = clientRequestedCurrency === 'CDF' ? 'mobile_money_cdf_full_payment' : 'mobile_money_drc_default_full_payment';
      } else {
        payable_currency = 'USD';
        payable_amount = round2(totalsBreakdown.grand_total);
        amountFormatted = payable_amount.toFixed(2);
        displayAmount = `$${amountFormatted} USD`;
        currencyReason = 'mobile_money_usd_default_full_payment';
      }
    } else {
      // CARD: USD only - use SERVER-COMPUTED grand_total
      payable_currency = 'USD';
      payable_amount = round2(totalsBreakdown.grand_total);
      amountFormatted = payable_amount.toFixed(2);
      displayAmount = `$${amountFormatted} USD`;
      currencyReason = 'card_usd_full_payment';
    }
    
    // ============================================
    // P0 FIX: Validate amount before calling provider
    // ============================================
    if (!Number.isFinite(payable_amount) || isNaN(payable_amount) || payable_amount <= 0) {
      console.error('[mobile-checkout] INVALID_PAYABLE_AMOUNT', {
        payable_amount,
        grand_total: totalsBreakdown.grand_total,
        cdf_equivalent: totalsBreakdown.cdf_equivalent,
      });
      return jsonResponse({
        success: false,
        code: 'INVALID_AMOUNT',
        message: 'Payment amount is invalid. Please refresh and try again.',
        error: 'Computed payment amount is not valid.',
      }, 400);
    }
    
    // pawaPay minimum amounts (approximate - adjust based on provider docs)
    const PAWAPAY_MIN_USD = 0.50;
    const PAWAPAY_MIN_CDF = 500;
    const PAWAPAY_MAX_USD = 50000;
    const PAWAPAY_MAX_CDF = 100000000; // 100M CDF
    
    if (REQUESTED_METHOD === 'MOBILE_MONEY') {
      const minAmount = payable_currency === 'USD' ? PAWAPAY_MIN_USD : PAWAPAY_MIN_CDF;
      const maxAmount = payable_currency === 'USD' ? PAWAPAY_MAX_USD : PAWAPAY_MAX_CDF;
      
      if (payable_amount < minAmount || payable_amount > maxAmount) {
        console.log('[mobile-checkout] AMOUNT_OUT_OF_RANGE', {
          payable_amount,
          payable_currency,
          min: minAmount,
          max: maxAmount,
        });
        return jsonResponse({
          success: false,
          code: 'AMOUNT_OUT_OF_RANGE',
          message: 'Amount is outside allowed limits for this payment method.',
          error: `Amount must be between ${minAmount} and ${maxAmount} ${payable_currency}.`,
        }, 400);
      }
    }

    // ============================================
    // CHECKOUT_PAYABLE_COMPUTED: Required structured log
    // ============================================
    console.log('[mobile-checkout] CHECKOUT_PAYABLE_COMPUTED', {
      payable_amount,
      payable_currency,
      server_grand_total: totalsBreakdown.grand_total,
      ui_amount_usd,
      ui_amount_cdf,
      payment_method: REQUESTED_METHOD,
    });

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
    // Create checkout_session record
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

    // Generate confirmationId early for use in response
    const confirmationId = checkoutOrder.id.substring(0, 8).toUpperCase();

    // ============================================
    // PROVIDER ROUTING: Check for active provider
    // Only pawaPay for mobile money (MaishaPay REMOVED)
    // ============================================
    const provider = await getActiveProvider(supabase, isoCode || 'COD', REQUESTED_METHOD);
    
    console.log('[mobile-checkout] CHECKOUT_PROVIDER_SELECTED', {
      provider: provider?.provider_key || 'none',
      is_enabled: provider?.is_enabled || false,
      country: isoCode,
      method: REQUESTED_METHOD,
    });

    // ============================================
    // PAWAPAY BRANCH: Mobile Money via pawaPay (only option)
    // ============================================
    if (REQUESTED_METHOD === 'MOBILE_MONEY') {
      // pawaPay is required for mobile money
      if (!provider || provider.provider_key !== 'pawapay' || !provider.is_enabled) {
        console.error('[mobile-checkout] PAWAPAY_NOT_AVAILABLE', {
          provider: provider?.provider_key,
          is_enabled: provider?.is_enabled,
        });
        return jsonResponse({
          success: false,
          code: 'PROVIDER_NOT_AVAILABLE',
          message: 'Mobile money payments are temporarily unavailable. Please try Bank Transfer.',
          error: 'Payment provider not available.',
        }, 503);
      }

      const secretsValid = validateProviderSecrets(provider);
      
      if (!secretsValid.valid) {
        console.error('[mobile-checkout] PAWAPAY_SECRETS_MISSING', {
          missing: secretsValid.missing,
        });
        return jsonResponse({
          success: false,
          code: 'PROVIDER_CONFIG_ERROR',
          message: 'Mobile money payments are temporarily unavailable. Please try Bank Transfer.',
          error: 'Payment provider not configured.',
        }, 503);
      }

      // SAFE LOGGING: structured checkout init
      console.log('[mobile-checkout] CHECKOUT_PAWAPAY_INIT', { 
        order_id: checkoutOrder.id,
        payment_flow: 'PAWAPAY',
        currency: payable_currency,
        amount: payable_amount,
        phone_last4: validatedPhone.slice(-4),
      });
      
      try {
        const pawaConfig = getPawaPayConfig(provider);
        const pawaReference = generateProviderRef(checkoutOrder.id);
        
        const depositResult = await createDeposit(pawaConfig, {
          orderId: checkoutOrder.id,
          amount: payable_amount,
          currency: payable_currency,
          customerPhone: validatedPhone, // Use normalized/validated phone
          customerEmail: profile.email || user.email || '',
          country: isoCode || 'COD',
          reference: pawaReference,
          description: `AfriShop Order #${checkoutOrder.id.slice(0, 8)}`,
        });

        if (depositResult.success) {
          // Create payment record in unified payments table
          await createPaymentRecord(supabase, {
            order_id: checkoutOrder.id,
            provider_key: 'pawapay',
            amount: payable_amount,
            currency: payable_currency,
            reference: pawaReference,
            customer_phone: validatedPhone,
            country: isoCode || 'COD',
            provider_deposit_id: depositResult.provider_deposit_id,
            raw_request: depositResult.raw_request,
            status: 'pending',
          });

          console.log('[mobile-checkout] CHECKOUT_PAWAPAY_SUCCESS', {
            order_id: checkoutOrder.id,
            payment_flow: 'PAWAPAY',
            currency: payable_currency,
            amount: payable_amount,
            depositId: depositResult.provider_deposit_id,
            reference: pawaReference,
          });

          // Return redirectUrl to payment-callback page that polls for status
          const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://afri-shop.com';
          const redirectUrl = `${frontendUrl}/payment-callback?orderId=${encodeURIComponent(checkoutOrder.id)}&provider=pawapay&depositId=${encodeURIComponent(depositResult.provider_deposit_id || '')}&reference=${encodeURIComponent(pawaReference)}`;

          return jsonResponse({
            success: true,
            // === REQUIRED FIELDS (always present) ===
            order_id: checkoutOrder.id,
            payment_flow: 'PAWAPAY' as PaymentFlow,
            currency: payable_currency,
            amount: payable_amount,
            // === OPTIONAL FIELDS (based on flow) ===
            redirectUrl,
            // === LEGACY FIELDS (for backwards compatibility) ===
            checkout_type: 'FULL_PAYMENT',
            orderId: checkoutOrder.id,
            checkout_session_id: checkoutSession?.id || null,
            confirmationId,
            provider: 'pawapay',
            checkoutUrl: redirectUrl,
            message: depositResult.message || 'Payment request sent to your phone. Please confirm on your device.',
            payable_amount,
            payable_currency,
            totals_breakdown: {
              subtotal: totalsBreakdown.subtotal_items,
              shipping: totalsBreakdown.shipping_fee,
              markup: totalsBreakdown.markup_fee,
              taxes: totalsBreakdown.taxes_fee,
              grand_total: totalsBreakdown.grand_total,
              currency: payable_currency,
              cdf_equivalent: totalsBreakdown.cdf_equivalent,
              exchange_rate: totalsBreakdown.exchange_rate,
              vehicle_quote_total: totalsBreakdown.vehicle_quote_total,
            },
            integrity_hash: integrityHash,
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
            },
          });
        } else {
          // ============================================
          // P0 FIX: Better error mapping from provider
          // ============================================
          const errorDetails = depositResult.errorDetails;
          
          // SAFE LOGGING: structured provider error (no secrets)
          console.error('[mobile-checkout] [provider-init] CHECKOUT_PAWAPAY_FAILED', {
            order_id: checkoutOrder.id,
            provider: 'pawapay',
            provider_http_status: errorDetails?.provider_http_status,
            provider_error_code: errorDetails?.provider_error_code,
            provider_request_id: errorDetails?.provider_request_id,
            is_rejection: errorDetails?.is_rejection,
            is_auth_error: errorDetails?.is_auth_error,
          });
          
          // Special handling for 401 auth errors - this is server misconfig, NOT user error
          if (errorDetails?.is_auth_error) {
            return jsonResponse({
              success: false,
              code: 'PROVIDER_AUTH_FAILED',
              message: 'Payment provider authentication failed. Check API token.',
              error: 'Provider authentication failed.',
              provider: 'pawapay',
              provider_http_status: 401,
              provider_request_id: errorDetails?.provider_request_id,
            }, 500); // 500 because it's server misconfig, not user error
          }
          
          // Determine HTTP status based on error type
          // Provider rejection (4xx-type) = 400, Server error = 500
          const httpStatus = errorDetails?.is_rejection ? 400 : 500;
          const errorCode = errorDetails?.is_rejection ? 'PROVIDER_REJECTED' : 'PAYMENT_INIT_FAILED';
          const errorMessage = errorDetails?.is_rejection 
            ? 'Payment was rejected by the payment provider.'
            : 'Failed to initiate payment. Please try again.';
          
          return jsonResponse({
            success: false,
            code: errorCode,
            message: errorMessage,
            error: depositResult.error || 'Payment initiation failed.',
            // Include safe diagnostic fields
            provider: 'pawapay',
            provider_http_status: errorDetails?.provider_http_status,
            provider_error_code: errorDetails?.provider_error_code,
            provider_request_id: errorDetails?.provider_request_id,
          }, httpStatus);
        }
      } catch (pawaError: any) {
        // Handle ConfigMissingError specifically - server misconfig
        if (pawaError instanceof ConfigMissingError || pawaError.code === 'CONFIG_MISSING') {
          console.error('[mobile-checkout] [pawapay-auth] CONFIG_MISSING', {
            order_id: checkoutOrder.id,
            error: pawaError.message,
          });
          return jsonResponse({
            success: false,
            code: 'CONFIG_MISSING',
            message: 'Payment provider token is not configured.',
            error: pawaError.message,
            provider: 'pawapay',
          }, 500);
        }
        
        // True server exception - return 500
        console.error('[mobile-checkout] [provider-init] CHECKOUT_PAWAPAY_EXCEPTION', {
          order_id: checkoutOrder.id,
          error_name: pawaError.name,
          error_message: pawaError.message?.slice(0, 100),
        });
        return jsonResponse({
          success: false,
          code: 'PAYMENT_ERROR',
          message: 'Mobile money payment failed. Please try again or use Bank Transfer.',
          error: 'An unexpected error occurred during payment initiation.',
          provider: 'pawapay',
        }, 500);
      }
    }

    // ============================================
    // CARD BRANCH: Use Stripe (for large orders with CARD preference)
    // ============================================
    if (REQUESTED_METHOD === 'CARD' || paymentMethodPreference === 'CARD') {
      // Check if Stripe is available
      const stripeProvider = await getActiveProvider(supabase, isoCode || 'COD', 'CARD');
      
      if (stripeProvider && stripeProvider.provider_key === 'stripe' && stripeProvider.is_enabled) {
        try {
          // Import Stripe adapter dynamically
          const { createPaymentIntent, getStripeConfig } = await import('../_shared/stripeAdapter.ts');
          const stripeConfig = getStripeConfig(stripeProvider);
          
          const stripeReference = generateProviderRef(checkoutOrder.id);
          
          const stripeResult = await createPaymentIntent(stripeConfig, {
            orderId: checkoutOrder.id,
            userId: user.id,
            intentId: stripeReference,
            amount: payable_amount,
            description: `AfriShop Order #${checkoutOrder.id.slice(0, 8)}`,
          });
          
          if (stripeResult.success && stripeResult.client_secret) {
            // Create payment record
            await createPaymentRecord(supabase, {
              order_id: checkoutOrder.id,
              provider_key: 'stripe',
              amount: payable_amount,
              currency: 'USD',
              reference: stripeReference,
              provider_deposit_id: stripeResult.provider_deposit_id,
              client_secret: stripeResult.client_secret,
              raw_request: stripeResult.raw_request,
              status: 'pending',
            });
            
            console.log('[mobile-checkout] CHECKOUT_STRIPE_SUCCESS', {
              order_id: checkoutOrder.id,
              payment_flow: 'STRIPE',
              amount: payable_amount,
              reference: stripeReference,
            });
            
            return jsonResponse({
              success: true,
              order_id: checkoutOrder.id,
              payment_flow: 'STRIPE' as PaymentFlow,
              currency: 'USD',
              amount: payable_amount,
              provider: 'stripe',
              nextAction: {
                type: 'stripe_payment_intent',
                clientSecret: stripeResult.client_secret,
              },
              confirmationId: checkoutOrder.id.substring(0, 8).toUpperCase(),
              totals_breakdown: {
                subtotal: totalsBreakdown.subtotal_items,
                shipping: totalsBreakdown.shipping_fee,
                markup: totalsBreakdown.markup_fee,
                taxes: totalsBreakdown.taxes_fee,
                grand_total: totalsBreakdown.grand_total,
                currency: 'USD',
                cdf_equivalent: totalsBreakdown.cdf_equivalent,
                exchange_rate: totalsBreakdown.exchange_rate,
              },
            });
          } else {
            console.error('[mobile-checkout] STRIPE_PAYMENT_FAILED', {
              order_id: checkoutOrder.id,
              error: stripeResult.error,
            });
            return jsonResponse({
              success: false,
              code: 'STRIPE_PAYMENT_FAILED',
              message: 'Card payment initialization failed. Please try again or use Bank Transfer.',
              error: stripeResult.error || 'Failed to create Stripe payment intent.',
            }, 500);
          }
        } catch (stripeError: any) {
          console.error('[mobile-checkout] STRIPE_EXCEPTION', {
            order_id: checkoutOrder.id,
            error: stripeError.message,
          });
          return jsonResponse({
            success: false,
            code: 'STRIPE_ERROR',
            message: 'Card payment failed. Please try again or use Bank Transfer.',
            error: stripeError.message,
          }, 500);
        }
      }
      
      // No card provider available
      return jsonResponse({
        success: false,
        code: 'CARD_NOT_AVAILABLE',
        message: 'Card payments are not available. Please use Mobile Money or Bank Transfer.',
        error: 'Card payment provider not configured.',
      }, 503);
    }

    // ============================================
    // BANK_TRANSFER BRANCH: For large orders with BANK_TRANSFER preference
    // ============================================
    if (paymentMethodPreference === 'BANK_TRANSFER') {
      console.log('[mobile-checkout] CHECKOUT_BANK_TRANSFER', {
        order_id: checkoutOrder.id,
        payment_flow: 'BANK_TRANSFER',
        amount: payable_amount,
        currency: 'USD',
      });
      
      // Fetch bank transfer settings
      const { data: bankSettings } = await supabase
        .from('settings')
        .select('bank_name, bank_account_holder, bank_account_number, bank_iban, bank_swift, bank_address, bank_instructions_en, bank_instructions_fr')
        .limit(1)
        .maybeSingle();
      
      const bankTransferInfo = {
        bank_name: bankSettings?.bank_name || 'Contact support for bank details',
        account_holder: bankSettings?.bank_account_holder || '',
        account_number: bankSettings?.bank_account_number || '',
        iban: bankSettings?.bank_iban || '',
        swift_code: bankSettings?.bank_swift || '',
        bank_address: bankSettings?.bank_address || '',
        instructions_en: bankSettings?.bank_instructions_en || 'Please transfer the exact amount and include your order ID in the reference.',
        instructions_fr: bankSettings?.bank_instructions_fr || 'Veuillez transférer le montant exact et inclure votre numéro de commande dans la référence.',
      };
      
      // Update order status to await bank transfer
      await supabase.from('orders').update({
        status: 'PENDING_PAYMENT',
        maisha_payment_status: 'PENDING_BANK_TRANSFER',
        payment_notes: 'Awaiting bank transfer',
      }).eq('id', checkoutOrder.id);
      
      return jsonResponse({
        success: true,
        order_id: checkoutOrder.id,
        payment_flow: 'BANK_TRANSFER' as PaymentFlow,
        currency: 'USD',
        amount: payable_amount,
        confirmationId: checkoutOrder.id.substring(0, 8).toUpperCase(),
        bank_transfer: bankTransferInfo,
        reference: `AFRISHOP-${checkoutOrder.id.slice(0, 8).toUpperCase()}`,
        message: 'Please complete the bank transfer and upload proof of payment.',
        message_fr: 'Veuillez effectuer le virement bancaire et télécharger la preuve de paiement.',
        totals_breakdown: {
          subtotal: totalsBreakdown.subtotal_items,
          shipping: totalsBreakdown.shipping_fee,
          markup: totalsBreakdown.markup_fee,
          taxes: totalsBreakdown.taxes_fee,
          grand_total: totalsBreakdown.grand_total,
          currency: 'USD',
          cdf_equivalent: totalsBreakdown.cdf_equivalent,
          exchange_rate: totalsBreakdown.exchange_rate,
        },
      });
    }

    // ============================================
    // FALLBACK: No valid payment method
    // ============================================
    console.error('[mobile-checkout] NO_VALID_PAYMENT_METHOD', {
      orderId: checkoutOrder.id,
      requested_method: REQUESTED_METHOD,
      payment_method_preference: paymentMethodPreference,
    });
    
    return jsonResponse({
      success: false,
      code: 'INVALID_PAYMENT_METHOD',
      message: 'Invalid payment method. Please use Mobile Money, Card, or Bank Transfer.',
      error: 'Payment method not supported.',
    }, 400);

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
