import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  extractRequestToken,
  verifyAndGetUser,
  handleCors,
  errorResponse,
  jsonResponse as sharedJsonResponse,
} from "../_shared/auth.ts";
import { isProfileComplete, getMissingProfileFields, formatProfileForResponse } from "../_shared/profileHelper.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
import { calculateShipping } from "../_shared/cartHelpers.ts";
import { applyPricingProtection, buildAuditLogEntry } from "../_shared/cart/pricingProtection.ts";
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
import { runCartLockGate } from "../_shared/cartLockGate.ts";
import { enforceLockedPayableUsd } from "../_shared/lockedTotals.ts";

function jsonResponse(data: unknown, status = 200) {
  if (status === 200) {
    return sharedJsonResponse(data, 200);
  }

  const payload = data && typeof data === 'object'
    ? {
        ...(data as Record<string, unknown>),
        http_status: status,
      }
    : {
        ok: false,
        success: false,
        error: String(data ?? 'Request failed'),
        http_status: status,
      };

  console.warn('[mobile-checkout] NORMALIZED_NON_200_RESPONSE', {
    original_status: status,
    code: (payload as Record<string, unknown>).code ?? null,
    error: (payload as Record<string, unknown>).error ?? null,
  });

  return sharedJsonResponse(payload, 200);
}

// Payment method types
type PaymentMethod = 'MOBILE_MONEY' | 'CARD';

// Payment flow types
type PaymentFlow = 'PAWAPAY' | 'STRIPE' | 'CHOICE_REQUIRED';

// Payment method preference for large orders - ONLY VALID VALUES
type PaymentMethodPreference = 'CARD';
const VALID_PAYMENT_PREFERENCES: readonly string[] = ['CARD'];

// Structured available method for frontend (eliminates secondary API call)
interface AvailableMethod {
  method: 'MOBILE_MONEY' | 'CARD';
  enabled: boolean;
  disabledReason: string | null;
}

// Payment settings from database
interface PaymentSettings {
  mobile_money_max_usd: number;
  mobile_money_max_cdf: number;
  large_order_currency: string;
  stripe_enabled: boolean;
  pawapay_enabled: boolean;
}

// Default payment settings (fallback)
const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  mobile_money_max_usd: 250,
  mobile_money_max_cdf: 1500000,
  large_order_currency: 'USD',
  stripe_enabled: true,
  pawapay_enabled: true,
};

// Fetch payment settings from database
async function getPaymentSettings(supabase: any): Promise<PaymentSettings> {
  try {
    const { data, error } = await supabase
      .from('payment_settings')
      .select('*')
      .order('updated_at', { ascending: false })
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
function getLargeOrderOptions(paymentSettings: PaymentSettings): ('STRIPE')[] {
  const options: ('STRIPE')[] = [];
  if (paymentSettings.stripe_enabled) options.push('STRIPE');
  return options;
}

// Build structured available methods for frontend (eliminates secondary API call)
function buildAvailableMethods(
  paymentSettings: PaymentSettings,
  totalUsdDollars: number,
  isVehicle: boolean
): AvailableMethod[] {
  const methods: AvailableMethod[] = [];
  const isOverLimit = totalUsdDollars > paymentSettings.mobile_money_max_usd;
  const isLargeOrder = isOverLimit || isVehicle;

  // MOBILE_MONEY (pawaPay)
  if (paymentSettings.pawapay_enabled) {
    if (isVehicle) {
      methods.push({
        method: 'MOBILE_MONEY',
        enabled: false,
        disabledReason: 'Not available for vehicle purchases',
      });
    } else if (isOverLimit) {
      methods.push({
        method: 'MOBILE_MONEY',
        enabled: false,
        disabledReason: `Maximum $${paymentSettings.mobile_money_max_usd.toLocaleString()} per transaction`,
      });
    } else {
      methods.push({
        method: 'MOBILE_MONEY',
        enabled: true,
        disabledReason: null,
      });
    }
  }

  // CARD (Stripe) - always available if enabled
  if (paymentSettings.stripe_enabled) {
    methods.push({
      method: 'CARD',
      enabled: true,
      disabledReason: null,
    });
  }

  return methods;
}

/**
 * Mobile Checkout Edge Function - P0 FULL PAYMENT (2026-01)
 * 
 * CRITICAL REQUIREMENTS:
 * 1. Server is SINGLE SOURCE OF TRUTH for totals - client amounts are DEBUG ONLY
 * 2. NO DEPOSIT LOGIC - ALL orders (including vehicles) pay FULL PRICE
 * 3. NO CAPS/LIMITS - payable_amount = server-computed grand_total
 * 4. MaishaPay REMOVED - Only pawaPay for mobile money, Stripe for cards, Bank Transfer for vehicles
 * 5. CHECKOUT SESSION LOCKING - Use checkout_session_id to prevent "Cart changed" errors
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
// NORMALIZATION: Recompute null pricing fields from base_price_usd
// Fixes items created before pricing was persisted at insert time
// ============================================
function normalizeItemPricing(
  item: any,
  settings: { markupPercent: number; vehicleMarkupPercent: number; shippingBaseFeeUsd: number; shippingPercent: number; exchangeRate: number }
): any {
  const basePriceUsd = Number(item.base_price_usd || 0);
  const quantity = Number(item.quantity || 1);
  const isVehicle = item.is_vehicle === true;
  const isFixedPrice = item.price_source === 'hot_product';
  const requiresManualQuote = item.requires_manual_quote === true;
  const vehicleQuoteApplied = item.vehicle_quote_applied === true;

  // If all pricing fields are populated, return as-is
  if (
    item.unit_price_usd != null &&
    item.subtotal_usd != null &&
    item.markup_fee_usd != null &&
    item.shipping_fee_usd != null &&
    item.total_price_usd != null &&
    item.total_price_cdf != null
  ) {
    return item;
  }

  // Skip normalization for vehicle items with applied quotes (authoritative pricing)
  if (isVehicle && vehicleQuoteApplied && item.total_price_usd != null) {
    return item;
  }

  // ALL-INCLUSIVE FIX: If item was stored as all-inclusive, don't re-apply markup/shipping
  const isStoredAllInclusive = item.price_source === 'all_inclusive_display';
  const effectiveMarkup = (isFixedPrice || isStoredAllInclusive) ? 0 : (isVehicle ? settings.vehicleMarkupPercent : settings.markupPercent);
  const itemBaseTotalUsd = round2(basePriceUsd * quantity);
  const marginUsd = round2(itemBaseTotalUsd * (effectiveMarkup / 100));
  const subtotalUsd = round2(itemBaseTotalUsd + marginUsd);

  let shippingFeeUsd = 0;
  if (!isFixedPrice && !isStoredAllInclusive && !requiresManualQuote) {
    shippingFeeUsd = round2(settings.shippingBaseFeeUsd + (itemBaseTotalUsd * settings.shippingPercent));
  }

  const totalPriceUsd = round2(subtotalUsd + shippingFeeUsd);
  const totalPriceCdf = round2(totalPriceUsd * settings.exchangeRate);

  console.warn('[mobile-checkout] ITEM_PRICING_NORMALIZED', {
    item_id: item.id,
    base_price_usd: basePriceUsd,
    quantity,
    computed: { unit_price_usd: basePriceUsd, subtotal_usd: subtotalUsd, markup_fee_usd: marginUsd, shipping_fee_usd: shippingFeeUsd, total_price_usd: totalPriceUsd },
    original_nulls: {
      unit_price_usd: item.unit_price_usd == null,
      subtotal_usd: item.subtotal_usd == null,
      markup_fee_usd: item.markup_fee_usd == null,
      shipping_fee_usd: item.shipping_fee_usd == null,
      total_price_usd: item.total_price_usd == null,
    },
  });

  return {
    ...item,
    unit_price_usd: item.unit_price_usd ?? round2(basePriceUsd),
    subtotal_usd: item.subtotal_usd ?? subtotalUsd,
    markup_fee_usd: item.markup_fee_usd ?? marginUsd,
    shipping_fee_usd: item.shipping_fee_usd ?? shippingFeeUsd,
    total_price_usd: item.total_price_usd ?? totalPriceUsd,
    total_price_cdf: item.total_price_cdf ?? totalPriceCdf,
  };
}
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
  let regularItemsBaseNonInclusive = 0; // Only non-all-inclusive items (for shipping calc)
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
      // ALL-INCLUSIVE FIX: If item was stored as all-inclusive or hot_product, use stored totals directly
      const isStoredAllInclusive = item.price_source === 'all_inclusive_display' || item.price_source === 'hot_product';
      const unitPrice = Number(item.base_price_usd || item.unit_price_usd || 0);
      const basePrice = round2(unitPrice * qty);

      if (isStoredAllInclusive) {
        // All-inclusive: base_price_usd already contains markup+shipping, treat as final
        regularItemsBase += basePrice;
        // No additional margin — it's baked in
        markupRulesUsed.push({
          item_id: item.id,
          rule: 'all_inclusive_display',
          markup_percent: 0,
          unit_price: unitPrice,
          quantity: qty,
          base_price: basePrice,
          margin: 0,
        });
      } else {
        const effectiveMarkup = isVehicle ? vehicleMarkupPercent : markupPercent;
        const marginAmount = round2(basePrice * (effectiveMarkup / 100));
        regularItemsBase += basePrice;
        regularItemsBaseNonInclusive += basePrice;
        regularItemsMargin += marginAmount;
        markupRulesUsed.push({
          item_id: item.id,
          rule: isVehicle ? 'vehicle_pending_quote' : 'standard_markup',
          markup_percent: effectiveMarkup,
          unit_price: unitPrice,
          quantity: qty,
          base_price: basePrice,
          margin: marginAmount,
        });
      }
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

  // Calculate shipping for regular NON-all-inclusive items only
  // All-inclusive items already have shipping baked into base_price_usd
  const regularShippingFee = regularItemsBaseNonInclusive > 0 
    ? calculateShipping(regularItemsBaseNonInclusive, shippingBaseFeeUsd, shippingPercent) 
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

// ============================================
// PERF: Timing utility for performance diagnostics
// ============================================
function createPerfTimer() {
  const start = Date.now();
  const checkpoints: { step: string; elapsed_ms: number }[] = [];
  return {
    mark(step: string) {
      const elapsed_ms = Date.now() - start;
      checkpoints.push({ step, elapsed_ms });
      console.log(`[PERF] step=${step} elapsed_ms=${elapsed_ms}`);
    },
    total() { return Date.now() - start; },
    checkpoints() { return checkpoints; },
  };
}

serve(async (req) => {
  // 🔖 VERSION MARKER - P0 FULL PAYMENT WITH CHECKOUT SESSION LOCKING + PERF TIMING + SDK-FREE
  const correlationId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  
  // Parse environment from query or header
  const urlParsed = new URL(req.url);
  const env = urlParsed.searchParams.get('env') || req.headers.get('X-Afrishop-Environment') || 'prod';
  
  console.log(`[CHECKOUT] start correlationId=${correlationId} env=${env} method=${req.method}`);
  console.log("MOBILE_CHECKOUT_VERSION", "v2026-02-06-sdk-free-always-json");
  
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, success: false, error: 'Method not allowed', correlationId }, 200);
  }

  // Start performance timer
  const perf = createPerfTimer();

  try {
    // ============================================
    // CHECKOUT_INIT: Log entry point
    // ============================================
    perf.mark('init');

    // Handle auth errors gracefully - return HTTP 200 with structured JSON error
    let user: any;
    let supabase: any;
    try {
      const { token, source: tokenSource } = await extractRequestToken(req);
      const hasAuthorizationHeader = !!req.headers.get('Authorization');

      console.log(`[CHECKOUT] correlationId=${correlationId} auth-check`, {
        tokenSource: tokenSource || 'missing',
        hasAuthorizationHeader,
        hasExtractedToken: !!token,
      });

      if (!token) {
        console.warn(`[CHECKOUT] correlationId=${correlationId} NO_TOKEN`);
        return jsonResponse({
          ok: false, success: false, authenticated: false,
          error: 'NO_TOKEN', error_code: 'NO_TOKEN',
          message: 'No authentication token found. Please sign in.',
          message_fr: 'Aucun jeton trouvé. Veuillez vous connecter.',
          correlationId,
        }, 200);
      }

      const authResult = await verifyAndGetUser(req, undefined, { token, source: tokenSource });
      user = authResult.user;
      supabase = authResult.supabase;
    } catch (authError: any) {
      const errorCode = authError?.authErrorCode || 'INVALID_TOKEN';
      const elapsedMs = Date.now() - startTime;
      console.log(`[CHECKOUT][ERROR] correlationId=${correlationId} code=${errorCode} message=${authError.message} ms=${elapsedMs}`);
      return jsonResponse({
        ok: false, success: false, authenticated: false,
        error: errorCode, error_code: errorCode,
        message: errorCode === 'EXPIRED_TOKEN'
          ? 'Session expired. Please sign in again.'
          : errorCode === 'NO_TOKEN'
          ? 'Login required'
          : 'Authentication failed. Please sign in again.',
        message_fr: errorCode === 'EXPIRED_TOKEN'
          ? 'Session expirée. Veuillez vous reconnecter.'
          : 'Connexion requise',
        correlationId,
      }, 200);
    }
    
    perf.mark('auth');
    console.log(`[CHECKOUT] correlationId=${correlationId} userId=${user.id}`);

    const body = await req.json();
    perf.mark('body_parsed');
    const { cart_item_ids, notes } = body;

    // ============================================
    // PERF: Clean up stale checkout sessions (older than 30 min) to prevent constraint violations
    // This is a background cleanup, we don't wait for it to complete
    // ============================================
    supabase
      .from('checkout_sessions')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .in('status', ['pending', 'processing'])
      .lt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .then(({ error }) => {
        if (error) console.warn('[mobile-checkout] STALE_SESSION_CLEANUP_ERROR', error.message);
        else console.log('[mobile-checkout] STALE_SESSION_CLEANUP_DONE');
      });

    // ============================================
    // P0 CRITICAL: Check for existing checkout_session_id
    // If provided, REUSE the session instead of recomputing
    // ============================================
    const providedCheckoutSessionId = body.checkout_session_id || body.checkoutSessionId;
    
    if (providedCheckoutSessionId) {
      console.log('[mobile-checkout] CHECKOUT_SESSION_REUSE_ATTEMPT', { 
        checkout_session_id: providedCheckoutSessionId 
      });
      
      // Fetch the existing session
      const { data: existingSession, error: sessionError } = await supabase
        .from('checkout_sessions')
        .select('*')
        .eq('id', providedCheckoutSessionId)
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (sessionError || !existingSession) {
        console.warn('[mobile-checkout] CHECKOUT_SESSION_NOT_FOUND', { 
          checkout_session_id: providedCheckoutSessionId,
          error: sessionError?.message 
        });
        return jsonResponse({
          ok: false,
          success: false,
          code: 'CHECKOUT_SESSION_EXPIRED',
          message: 'Checkout session expired. Please refresh.',
          message_fr: 'Session de paiement expirée. Veuillez actualiser.',
        }, 200);
      }
      
      // Check if session is still valid (not completed/failed)
      if (existingSession.status === 'completed' || existingSession.status === 'paid') {
        console.warn('[mobile-checkout] CHECKOUT_SESSION_ALREADY_COMPLETED', { 
          checkout_session_id: providedCheckoutSessionId,
          status: existingSession.status 
        });
        return jsonResponse({
          ok: false,
          success: false,
          code: 'CHECKOUT_SESSION_COMPLETED',
          message: 'This checkout has already been completed.',
          message_fr: 'Ce paiement a déjà été effectué.',
          order_id: existingSession.order_id,
        }, 200);
      }
      
      // Check expiry (sessions expire after 30 minutes)
      const sessionCreatedAt = new Date(existingSession.created_at);
      const now = new Date();
      const sessionAgeMinutes = (now.getTime() - sessionCreatedAt.getTime()) / (1000 * 60);
      
      if (sessionAgeMinutes > 30) {
        console.warn('[mobile-checkout] CHECKOUT_SESSION_EXPIRED_BY_TIME', { 
          checkout_session_id: providedCheckoutSessionId,
          age_minutes: sessionAgeMinutes 
        });
        
        // Mark session as expired
        await supabase.from('checkout_sessions').update({ status: 'expired' }).eq('id', providedCheckoutSessionId);
        
        return jsonResponse({
          ok: false,
          success: false,
          code: 'CHECKOUT_SESSION_EXPIRED',
          message: 'Checkout session expired. Please refresh.',
          message_fr: 'Session de paiement expirée. Veuillez actualiser.',
        }, 200);
      }
      
      // Parse payment_method_preference for this call
      const paymentMethodPreference = (body.payment_method_preference || '').toUpperCase();
      
      // ============================================
      // VALIDATE payment_method_preference - ONLY CARD accepted
      // ============================================
      if (paymentMethodPreference && !VALID_PAYMENT_PREFERENCES.includes(paymentMethodPreference)) {
        console.warn('[mobile-checkout] PAYMENT_METHOD_NOT_SUPPORTED', { 
          provided: paymentMethodPreference,
          valid: VALID_PAYMENT_PREFERENCES 
        });
        return jsonResponse({
          ok: false,
          success: false,
          code: 'PAYMENT_METHOD_NOT_SUPPORTED',
          message: 'Payment method not supported.',
          message_fr: 'Mode de paiement non supporté.',
        }, 200);
      }
      
      // Session is valid - use stored cart snapshot and totals
      console.log('[mobile-checkout] CHECKOUT_SESSION_REUSED', {
        checkout_session_id: providedCheckoutSessionId,
        order_id: existingSession.order_id,
        grand_total: existingSession.grand_total,
        currency: existingSession.currency,
        payment_method_preference: paymentMethodPreference,
      });
      
      // PRICE LOCK GATE: block on expired / OOS / verify-failed; returns HTTP 200 JSON.
      const lockGate = await runCartLockGate(existingSession.order_id);
      if (!lockGate.ok) {
        console.warn('[mobile-checkout] price-lock gate blocked', { orderId: existingSession.order_id, code: lockGate.code });
        return jsonResponse({
          ok: false,
          success: false,
          code: lockGate.code,
          message: lockGate.message_en,
          message_en: lockGate.message_en,
          message_fr: lockGate.message_fr,
          changedItems: lockGate.changedItems,
        }, 200);
      }

      // Use stored totals from the session, then override USD with locked sum when complete.
      const storedTotals = existingSession.totals_breakdown as TotalsBreakdown;
      let payable_amount = existingSession.grand_total;
      const payable_currency = existingSession.currency;
      try {
        const locked = await computeLockedPayableUsd(existingSession.order_id, supabase);
        if (locked.allLocked && locked.usd && locked.usd > 0) {
          if ((payable_currency || 'USD').toUpperCase() === 'USD') {
            payable_amount = locked.usd;
          }
          console.log('[mobile-checkout] locked-totals applied', { orderId: existingSession.order_id, lockedUsd: locked.usd, items: locked.itemCount });
        } else {
          console.warn('[mobile-checkout] price-lock incomplete, using session total', { orderId: existingSession.order_id, missing: locked.missingLockCount });
        }
      } catch (e) {
        console.warn('[mobile-checkout] locked-totals lookup failed', { error: (e as Error).message });
      }
      
      // Fetch user profile for phone
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, name, phone, country')
        .eq('user_id', user.id)
        .maybeSingle();
      
      const profile = userProfile!;
      
      // Phone validation
      const rawPhone = (profile?.phone || '').trim();
      let normalizedPhone = rawPhone.replace(/[\s\-()]/g, '');
      if (!normalizedPhone.startsWith('+')) {
        if (normalizedPhone.startsWith('00')) {
          normalizedPhone = '+' + normalizedPhone.slice(2);
        } else if (normalizedPhone.startsWith('243')) {
          normalizedPhone = '+' + normalizedPhone;
        } else if (normalizedPhone.startsWith('0')) {
          normalizedPhone = '+243' + normalizedPhone.slice(1);
        } else if (/^[1-9]/.test(normalizedPhone)) {
          normalizedPhone = '+' + normalizedPhone;
        }
      }
      const validatedPhone = normalizedPhone;
      const { isDRC, isoCode } = detectBuyerCountry(profile || {}, body);
      
      // Fetch payment settings
      const paymentSettings = await getPaymentSettings(supabase);
      
      // Update session with the chosen payment method
      await supabase.from('checkout_sessions').update({ 
        pay_method: paymentMethodPreference,
        status: 'processing',
        updated_at: new Date().toISOString(),
      }).eq('id', providedCheckoutSessionId);
      
      // ============================================
      // CARD BRANCH: Use Stripe
      // ============================================
      if (paymentMethodPreference === 'CARD') {
        if (!paymentSettings.stripe_enabled) {
          return jsonResponse({
            ok: false,
            success: false,
            code: 'PAYMENT_METHOD_DISABLED',
            message: 'Card payments are currently disabled. Please use Bank Transfer.',
            message_fr: 'Les paiements par carte sont actuellement désactivés. Veuillez utiliser le virement bancaire.',
          }, 200);
        }
        
        // Check if Stripe is available
        const stripeProvider = await getActiveProvider(supabase, isoCode || 'COD', 'CARD');
        
        if (stripeProvider && stripeProvider.provider_key === 'stripe' && stripeProvider.is_enabled) {
          try {
            const { createPaymentIntent, getStripeConfig } = await import('../_shared/stripeAdapter.ts');
            const stripeConfig = getStripeConfig(stripeProvider);
            
            const stripeReference = generateProviderRef(existingSession.order_id);
            
            const stripeResult = await createPaymentIntent(stripeConfig, {
              orderId: existingSession.order_id,
              userId: user.id,
              intentId: stripeReference,
              amount: payable_amount,
              description: `AfriShop Order #${existingSession.order_id.slice(0, 8)}`,
            });
            
            if (stripeResult.success && stripeResult.client_secret) {
              // Create payment record
              await createPaymentRecord(supabase, {
                order_id: existingSession.order_id,
                provider_key: 'stripe',
                amount: payable_amount,
                currency: 'USD',
                reference: stripeReference,
                provider_deposit_id: stripeResult.provider_deposit_id,
                client_secret: stripeResult.client_secret,
                raw_request: stripeResult.raw_request,
                status: 'pending',
              });
              
              // Update session status
              await supabase.from('checkout_sessions').update({ 
                status: 'stripe_initiated',
                updated_at: new Date().toISOString(),
              }).eq('id', providedCheckoutSessionId);
              
              console.log('[mobile-checkout] CHECKOUT_STRIPE_SUCCESS (session reuse)', {
                order_id: existingSession.order_id,
                checkout_session_id: providedCheckoutSessionId,
                payment_flow: 'STRIPE',
                amount: payable_amount,
                reference: stripeReference,
              });
              
              return jsonResponse({
                success: true,
                order_id: existingSession.order_id,
                checkout_session_id: providedCheckoutSessionId,
                payment_flow: 'STRIPE' as PaymentFlow,
                currency: 'USD',
                amount: payable_amount,
                provider: 'stripe',
                clientSecret: stripeResult.client_secret,
                nextAction: {
                  type: 'stripe_payment_intent',
                  clientSecret: stripeResult.client_secret,
                },
                confirmationId: existingSession.order_id.substring(0, 8).toUpperCase(),
                totals_breakdown: storedTotals,
              });
            } else {
              console.error('[mobile-checkout] STRIPE_INIT_FAILED', {
                order_id: existingSession.order_id,
                error: stripeResult.error,
              });
              return jsonResponse({
                ok: false,
                success: false,
                code: 'STRIPE_INIT_FAILED',
                message: 'Unable to initialize card payment.',
                message_fr: 'Impossible d\'initialiser le paiement par carte.',
              }, 200);
            }
          } catch (stripeError: any) {
            console.error('[mobile-checkout] STRIPE_EXCEPTION', {
              order_id: existingSession.order_id,
              error: stripeError.message,
            });
            return jsonResponse({
              ok: false,
              success: false,
              code: 'STRIPE_INIT_FAILED',
              message: 'Unable to initialize card payment.',
              message_fr: 'Impossible d\'initialiser le paiement par carte.',
            }, 200);
          }
        }
        
        // No card provider available
        return jsonResponse({
          ok: false,
          success: false,
          code: 'CARD_NOT_AVAILABLE',
          message: 'Card payments are not available. Please contact support.',
          message_fr: 'Les paiements par carte ne sont pas disponibles. Veuillez contacter le support.',
        }, 200);
      }
      
      // BANK_TRANSFER removed — no longer supported
      
      
      // No valid preference provided for session reuse
      return jsonResponse({
        ok: false,
        success: false,
        code: 'PAYMENT_METHOD_NOT_SUPPORTED',
        message: 'Payment method not supported.',
        message_fr: 'Mode de paiement non supporté.',
      }, 200);
    }

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
        ok: false,
        success: false, 
        code: 'EMPTY_CART',
        message: 'Your cart is empty.',
        message_fr: 'Votre panier est vide.',
      }, 200);
    }

    // ============================================
    // PERF OPTIMIZATION: Parallel fetch of profile, order, settings, AND payment settings
    // Reduces latency by ~300-400ms by avoiding sequential queries
    // ============================================
    const providedCartId = body.cart_id || body.cartId || body.order_id || body.orderId;
    const clientCartVersion = Number(body.cart_version) || null;

    // Build parallel fetch promises
    const profilePromise = supabase
      .from('profiles')
      .select('user_id, email, full_name, name, phone, address_line1, address_line2, city, state_province, postal_code, country')
      .eq('user_id', user.id)
      .maybeSingle();

    // P0 FIX: Accept both DRAFT and PENDING_PAYMENT status orders
    // Web flow: mobile-create-order-from-cart runs first and sets status to PENDING_PAYMENT
    // Mobile flow: may still have DRAFT status
    const orderPromise = providedCartId
      ? supabase
          .from('orders')
          .select('id, cart_version')
          .eq('id', providedCartId)
          .eq('user_id', user.id)
          .in('status', ['DRAFT', 'PENDING_PAYMENT'])
          .maybeSingle()
      : supabase
          .from('orders')
          .select('id, cart_version')
          .eq('user_id', user.id)
          .in('status', ['DRAFT', 'PENDING_PAYMENT'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

    const settingsPromise = getCachedSettings(supabase);
    
    // PERF: Fetch payment settings in parallel instead of sequentially after totals
    const paymentSettingsPromise = getPaymentSettings(supabase);

    // Execute all queries in parallel (saves ~100-200ms)
    const [profileResult, orderResult, settings, paymentSettings] = await Promise.all([
      profilePromise,
      orderPromise,
      settingsPromise,
      paymentSettingsPromise,
    ]);

    perf.mark('parallel_fetch_complete');

    let { data: userProfile, error: profileError } = profileResult;
    const { data: orderData, error: orderFetchError } = orderResult;

    if (profileError) {
      console.error('[mobile-checkout] Error fetching profile:', profileError);
    }

    // Safety net: auto-create profile if missing (trigger didn't fire)
    if (!userProfile) {
      console.warn('[mobile-checkout] No profile found for user, auto-creating:', user.id);
      const fallbackName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
      await supabase.from('profiles').upsert({
        user_id: user.id,
        email: user.email || null,
        full_name: fallbackName,
        name: fallbackName,
        country: 'DR Congo',
        language: 'fr',
      }, { onConflict: 'user_id', ignoreDuplicates: true });

      // Re-fetch the profile
      const { data: refetched } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, name, phone, address_line1, address_line2, city, state_province, postal_code, country')
        .eq('user_id', user.id)
        .maybeSingle();
      userProfile = refetched;
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
        ok: false,
        success: false,
        code: 'PROFILE_INCOMPLETE',
        message: `Please add your ${missingFieldNames} to your profile before checkout.`,
        message_fr: `Veuillez ajouter votre ${missingFieldNames} à votre profil avant de payer.`,
        missingFields,
      }, 200);
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
        ok: false,
        success: false,
        code: 'PHONE_REQUIRED',
        message: 'Phone number missing in profile.',
        message_fr: 'Numéro de téléphone manquant dans le profil.',
      }, 200);
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
        ok: false,
        success: false,
        code: 'INVALID_PHONE',
        message: 'Phone number invalid. Please update your profile phone in international format like +243...',
        message_fr: 'Numéro de téléphone invalide. Veuillez mettre à jour votre profil avec un format international comme +243...',
      }, 200);
    }
    
    // Store normalized phone for later use
    const validatedPhone = normalizedPhone;
    const { isDRC, isoCode, countryCode } = detectBuyerCountry(profile, body);

    // Validate order fetch result
    if (orderFetchError) {
      console.error('[mobile-checkout] Error fetching cart:', orderFetchError);
      return jsonResponse({ ok: false, success: false, code: 'CART_FETCH_ERROR', message: 'Unable to load cart. Please try again.', message_fr: 'Impossible de charger le panier. Veuillez réessayer.' }, 200);
    }

    if (!orderData) {
      if (providedCartId) {
        return jsonResponse({
          ok: false,
          success: false,
          code: 'CART_NOT_FOUND',
          message: 'Cart not found or no longer active.',
          cart_id: providedCartId,
        }, 400);
      }
      return jsonResponse({ 
        success: false, 
        code: 'EMPTY_CART',
        error: 'Your cart is empty. Please add items before checkout.' 
      }, 400);
    }

    const existingOrder = orderData;

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

    perf.mark('order_fetched');

    // Detect if RN app sent non-UUID IDs (e.g. provider_product_id like "opt_1775...")
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const hasNonUuidIds = cart_item_ids.some((id: string) => !UUID_RE.test(id));

    let dbItems: any[] = [];
    let missingItemIds: string[] = [];

    if (hasNonUuidIds) {
      // RN app sent product IDs instead of order_items UUIDs — try provider_product_id lookup first
      console.warn('[mobile-checkout] NON_UUID_CART_ITEM_IDS detected, trying provider_product_id lookup', {
        sample: cart_item_ids.slice(0, 3),
      });
      const { data: byProvider, error: byProviderErr } = await supabase
        .from('order_items')
        .select('*')
        .in('provider_product_id', cart_item_ids)
        .eq('order_id', existingOrder.id)
        .eq('is_saved_for_later', false);
      
      if (!byProviderErr && byProvider && byProvider.length > 0) {
        dbItems = [...byProvider];
        const foundProviderIds = new Set(byProvider.map((i: any) => i.provider_product_id));
        missingItemIds = cart_item_ids.filter((id: string) => !foundProviderIds.has(id));
      }
      // If provider lookup also failed/empty, the desync fallback below will handle it
    } else {
      // Normal UUID-based lookup
      const { data: dbItemsRaw, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .in('id', cart_item_ids)
        .eq('order_id', existingOrder.id);

      if (itemsError) {
        console.error('[mobile-checkout] Error fetching items:', itemsError);
        return jsonResponse({ ok: false, success: false, code: 'CHECKOUT_ITEM_FETCH_FAILED', message: 'Failed to fetch cart items.', message_fr: 'Impossible de récupérer les articles du panier.' }, 200);
      }

      dbItems = Array.isArray(dbItemsRaw) ? [...dbItemsRaw] : [];
      const foundItemIds = new Set(dbItems.map(item => item.id));
      missingItemIds = cart_item_ids.filter((id: string) => !foundItemIds.has(id));
    }
    
    perf.mark('items_fetched');
    
    if (dbItems.length !== cart_item_ids.length) {
      console.warn('[mobile-checkout] CHECKOUT_CART_DESYNC', {
        requested: cart_item_ids.length,
        found: dbItems.length,
        missing: missingItemIds,
        fallback: 'reload_active_cart_items',
      });

      const { data: activeCartItems, error: activeCartItemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', existingOrder.id)
        .eq('is_saved_for_later', false)
        .order('created_at', { ascending: true });

      if (activeCartItemsError) {
        console.error('[mobile-checkout] Error fetching active cart items for desync recovery:', activeCartItemsError);
        return jsonResponse({ ok: false, success: false, code: 'CHECKOUT_ITEM_FETCH_FAILED', message: 'Failed to fetch cart items.', message_fr: 'Impossible de récupérer les articles.' }, 200);
      }

      if (!activeCartItems || activeCartItems.length === 0) {
        return jsonResponse({
          success: false,
          code: 'EMPTY_CART',
          message: 'Your cart is empty. Please add items before checkout.',
          message_fr: 'Votre panier est vide. Veuillez ajouter des articles avant de payer.',
          missing_item_ids: missingItemIds,
          cart_id: existingOrder.id,
        }, 200);
      }

      dbItems.length = 0;
      dbItems.push(...activeCartItems);
      cart_item_ids.length = 0;
      cart_item_ids.push(...activeCartItems.map((item: any) => item.id));

      console.log('[mobile-checkout] CHECKOUT_CART_DESYNC_RECOVERED', {
        requested: foundItemIds.size + missingItemIds.length,
        recovered: dbItems.length,
        recovered_item_ids: cart_item_ids,
        cart_id: existingOrder.id,
      });
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
    // PRICE DRIFT SAFETY NET
    // For items linked to a catalog product, run a fresh live-price check.
    // Block checkout if any item is flagged with a large drift (>10%).
    // ============================================
    try {
      const cartUrls = dbItems
        .map((it: any) => (typeof it.product_url === 'string' ? it.product_url : ''))
        .filter(Boolean);

      if (cartUrls.length > 0) {
        const { createClient } = await import("@supabase/supabase-js");
        const supabaseAdmin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        const { data: catalogMatches } = await supabaseAdmin
          .from('catalog_items')
          .select('id, product_url, price_usd, needs_price_review, last_price_check_at')
          .in('product_url', cartUrls)
          .limit(50);

        const matches = catalogMatches || [];
        // Items that need a fresh check: never checked, or older than 6h
        const sixHoursAgo = Date.now() - 6 * 3600_000;
        const idsToVerify = matches
          .filter((m: any) => !m.last_price_check_at || new Date(m.last_price_check_at).getTime() < sixHoursAgo)
          .map((m: any) => m.id);

        if (idsToVerify.length > 0) {
          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/price-checker`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ mode: 'items', itemIds: idsToVerify }),
          }).catch((e) => console.warn('[mobile-checkout] price-checker call failed', e));
        }

        // Re-read flags after verification
        const { data: refreshed } = await supabaseAdmin
          .from('catalog_items')
          .select('id, product_url, price_usd, needs_price_review, last_known_live_price_usd')
          .in('product_url', cartUrls)
          .eq('needs_price_review', true);

        const flaggedUrls = new Set((refreshed || []).map((r: any) => r.product_url));
        if (flaggedUrls.size > 0) {
          const flaggedItems = dbItems.filter((it: any) => flaggedUrls.has(it.product_url));
          console.log('[mobile-checkout] CHECKOUT_PRICE_DRIFT_BLOCKED', {
            count: flaggedItems.length,
          });
          return jsonResponse({
            ok: false,
            success: false,
            code: 'PRICE_DRIFT_DETECTED',
            message_fr: "Le prix d'un ou plusieurs articles a changé. Veuillez vérifier votre panier avant de payer.",
            message_en: "The price of one or more items has changed. Please review your cart before paying.",
            flaggedItems: flaggedItems.map((it: any) => {
              const live = (refreshed || []).find((r: any) => r.product_url === it.product_url);
              return {
                id: it.id,
                name: it.title || 'Unknown item',
                url: it.product_url,
                oldPrice: it.product_price ?? it.price_usd ?? null,
                newPrice: live?.last_known_live_price_usd ?? null,
              };
            }),
          }, 409);
        }
      }
    } catch (e) {
      console.warn('[mobile-checkout] price drift safety net error', (e as Error).message);
      // Do not fail checkout on safety-net errors
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
    if (duplicatesRemoved > 0) {
      dbItems.length = 0;
      dbItems.push(...deduped.map(item => ({
        ...item.original_item,
        quantity: item.quantity,
      })));
      console.warn('[mobile-checkout] CHECKOUT_DUPLICATES_COLLAPSED_FOR_TOTALS', {
        deduped_count: dbItems.length,
        quantities: dbItems.map(item => ({ id: item.id, quantity: item.quantity })),
      });
    }

    // SELF-HEAL: Some items get is_vehicle=true by mistake (e.g. legacy data, manual edits).
    // Before any vehicle-quote enforcement, drop the vehicle flag from items that have
    // no real vehicle signal at all (not from a vehicle store, no vehicle URL, no vehicle
    // keyword in title, no vehicle-specific fields). This unblocks checkout for users whose
    // cart contains, e.g., a watch or a phone wrongly tagged as a vehicle.
    const VEHICLE_STORE_NAMES = new Set(['CARVANA', 'CARGURUS', 'TESLA_USED', 'EDMUNDS']);
    const misclassifiedVehicleIds: string[] = [];
    for (const item of dbItems) {
      if (item.is_vehicle !== true) continue;
      const storeUpper = String(item.store || '').toUpperCase();
      const detection = detectVehicleFromItems([{ ...item, is_vehicle: false, vehicle_quote_applied: false }]);
      const looksLikeVehicle =
        VEHICLE_STORE_NAMES.has(storeUpper) ||
        (detection.isVehicle && detection.confidence === 'high');
      if (!looksLikeVehicle) {
        misclassifiedVehicleIds.push(item.id);
        item.is_vehicle = false;
        item.vehicle_quote_applied = false;
        item.requires_manual_quote = false;
      }
    }
    if (misclassifiedVehicleIds.length > 0) {
      console.warn('[mobile-checkout] AUTO_HEAL_MISCLASSIFIED_VEHICLES', {
        count: misclassifiedVehicleIds.length,
        ids: misclassifiedVehicleIds,
      });
      try {
        await supabase
          .from('order_items')
          .update({ is_vehicle: false, vehicle_quote_applied: false, requires_manual_quote: false })
          .in('id', misclassifiedVehicleIds);
      } catch (healErr) {
        console.error('[mobile-checkout] Failed to persist vehicle flag healing:', healErr);
      }
    }

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

    // Settings already fetched in parallel above - just mark timing
    perf.mark('settings_ready');
    const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent } = settings;

    // Vehicle detection and quote validation
    const vehicleDetection = detectVehicleFromItems(dbItems);
    // Only block mobile money for HIGH confidence vehicle detection
    // LOW confidence (title keyword only) should NOT block mobile money
    const containsVehicleHighConfidence = vehicleDetection.isVehicle && vehicleDetection.confidence === 'high';
    const containsVehicleLowConfidence = vehicleDetection.isVehicle && vehicleDetection.confidence === 'low';
    const containsVehicle = containsVehicleHighConfidence; // For payment routing, only high confidence matters
    
    if (containsVehicleLowConfidence) {
      console.warn('[mobile-checkout] LOW confidence vehicle detection (title keyword only) - allowing mobile money:', {
        vehicleReasons: vehicleDetection.reasons,
        confidence: vehicleDetection.confidence,
        itemCount: dbItems.length,
      });
    }
    
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
    perf.mark('totals_computed');
    
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
    // PRICING PROTECTION: Checkout-time margin safety gate
    // Re-validates that margin is still safe before allowing payment
    // ============================================
    if (settings.protection) {
      let totalProtectedUsd = 0;
      let protectionBlocked = false;
      const protectionReasons: string[] = [];
      
      for (const item of dbItems) {
        if (item.is_vehicle === true) continue; // Vehicles use quote-based pricing
        const isAllInclusive = item.price_source === 'all_inclusive_display' || item.price_source === 'hot_product';
        if (isAllInclusive) { totalProtectedUsd += Number(item.total_price_usd || 0); continue; }

        const basePriceUsd = Number(item.base_price_usd || 0);
        const qty = Number(item.quantity || 1);
        const baseTotal = round2(basePriceUsd * qty);
        const effectiveMarkup = item.is_vehicle ? settings.vehicleMarkupPercent : settings.markupPercent;
        const marginUsd = round2(baseTotal * (effectiveMarkup / 100));
        const shippingUsd = Number(item.shipping_fee_usd || 0);

        const protection = applyPricingProtection(
          baseTotal, marginUsd, shippingUsd, settings.exchangeRate,
          settings.protection,
          { categoryKey: null, isVehicle: false, requiresManualQuote: item.requires_manual_quote === true, quantity: qty },
        );

        totalProtectedUsd += protection.safeFinalPriceUsd;

        if (protection.pricingStatus === 'low_margin_blocked') {
          protectionBlocked = true;
          protectionReasons.push(`Item ${item.id}: profit $${protection.profitUsd} below threshold`);
        }

        // Fire-and-forget audit log
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const adminClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          );
          const auditEntry = buildAuditLogEntry(protection, orderId, item.id, item.product_url);
          adminClient.from('pricing_audit_log').insert(auditEntry).then(({ error }) => {
            if (error) console.warn('[CHECKOUT] pricing audit log error:', error.message);
          });
        } catch (e) { console.warn('[CHECKOUT] audit error:', (e as Error).message); }
      }

      if (protectionBlocked) {
        console.warn('[mobile-checkout] PRICING_PROTECTION_BLOCKED', { reasons: protectionReasons });
        return jsonResponse({
          ok: false, success: false,
          code: 'PRICE_PROTECTION_REQUIRED',
          message: 'Some items need price review before checkout. Please refresh your cart.',
          message_fr: 'Certains articles nécessitent une vérification de prix. Veuillez actualiser votre panier.',
          reasons: protectionReasons,
        }, 200);
      }

      console.log('[mobile-checkout] PRICING_PROTECTION_PASSED', {
        original_total: totalsBreakdown.grand_total,
        protected_total: totalProtectedUsd,
        delta: round2(totalProtectedUsd - totalsBreakdown.grand_total),
      });
    }

    // ============================================
    // PAYMENT SETTINGS ALREADY LOADED IN PARALLEL ABOVE
    // ============================================
    perf.mark('payment_settings_ready');
    
    // P0 CRITICAL: Log limits for debugging (safe - no secrets)
    console.log('[limits] mobile_money_max_usd=' + paymentSettings.mobile_money_max_usd + ', mobile_money_max_cdf=' + paymentSettings.mobile_money_max_cdf);
    
    console.log('[mobile-checkout] PAYMENT_SETTINGS_LOADED', {
      mobile_money_max_usd: paymentSettings.mobile_money_max_usd,
      mobile_money_max_cdf: paymentSettings.mobile_money_max_cdf,
      stripe_enabled: paymentSettings.stripe_enabled,
      pawapay_enabled: paymentSettings.pawapay_enabled,
    });

    // Parse payment_method_preference for large orders (new optional field)
    // P0 FIX: Support multiple field names from frontend (snake_case and camelCase)
    const rawPreference = (
      body.payment_method_preference || 
      body.paymentMethodPreference || 
      body.payment_method || 
      ''
    ).toString().toUpperCase();
    
    // Map 'CARD' to 'CARD', anything else is empty
    const paymentMethodPreference: '' | 'CARD' = 
      rawPreference === 'CARD' ? 'CARD' : '';
    
    // Log the preference parsing
    console.log('[mobile-checkout] PAYMENT_PREFERENCE_PARSED', {
      raw_preference: rawPreference,
      parsed_preference: paymentMethodPreference || 'none',
      body_keys: Object.keys(body).filter(k => k.toLowerCase().includes('payment') || k.toLowerCase().includes('method')),
    });
    
    // ============================================
    // VALIDATE payment_method_preference - ONLY CARD accepted
    // ============================================
    if (rawPreference && !['CARD', ''].includes(rawPreference)) {
      console.warn('[mobile-checkout] PAYMENT_METHOD_NOT_SUPPORTED', { 
        provided: rawPreference,
        valid: VALID_PAYMENT_PREFERENCES 
      });
      return jsonResponse({
        success: false,
        code: 'PAYMENT_METHOD_NOT_SUPPORTED',
        message: 'Payment method not supported.',
        message_fr: 'Mode de paiement non supporté.',
        error: `Invalid payment_method_preference. Valid values: ${VALID_PAYMENT_PREFERENCES.join(', ')}`,
      }, 400);
    }
    
    // Determine target currency for limit checking
    // P0 CRITICAL: Use grand_total in USD as the canonical amount for limit comparison
    const targetCurrency: 'USD' | 'CDF' = clientRequestedCurrency === 'CDF' ? 'CDF' : 'USD';
    
    // P0 FIX: Compute canonical amount for routing decision
    // Always compare USD grand_total against USD limit, CDF equivalent against CDF limit
    const amountForLimitCheck_USD = totalsBreakdown.grand_total;
    const amountForLimitCheck_CDF = totalsBreakdown.cdf_equivalent;
    
    // P0 FIX: Check BOTH limits - if either is exceeded, it's a large order
    const isOverUsdLimit = amountForLimitCheck_USD > paymentSettings.mobile_money_max_usd;
    const isOverCdfLimit = amountForLimitCheck_CDF > paymentSettings.mobile_money_max_cdf;
    const isOverLimit = targetCurrency === 'CDF' ? isOverCdfLimit : isOverUsdLimit;
    
    // Large order = vehicle OR over mobile money limit (either currency)
    const isLargeOrder = containsVehicle || isOverLimit;
    
    // P0 CRITICAL: Log routing decision for debugging
    console.log('[router] currency=' + targetCurrency + ' amount=' + (targetCurrency === 'CDF' ? amountForLimitCheck_CDF : amountForLimitCheck_USD) + ' limit_usd=' + paymentSettings.mobile_money_max_usd + ' limit_cdf=' + paymentSettings.mobile_money_max_cdf);
    console.log('[router] decision=' + (isLargeOrder ? 'CHOICE_REQUIRED' : 'PAWAPAY'));
    
    console.log('[mobile-checkout] CHECKOUT_LIMIT_CHECK', {
      amount_usd: amountForLimitCheck_USD,
      amount_cdf: amountForLimitCheck_CDF,
      target_currency: targetCurrency,
      limit_usd: paymentSettings.mobile_money_max_usd,
      limit_cdf: paymentSettings.mobile_money_max_cdf,
      is_over_usd_limit: isOverUsdLimit,
      is_over_cdf_limit: isOverCdfLimit,
      is_over_limit: isOverLimit,
      contains_vehicle: containsVehicle,
      is_large_order: isLargeOrder,
      payment_method_preference: paymentMethodPreference || 'none',
    });

    // ============================================
    // Create cart snapshot EARLY for checkout_session
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
      currency: targetCurrency,
      pay_method: REQUESTED_METHOD,
    });

    // ============================================
    // LARGE ORDER FLOW: CHOICE_REQUIRED or process preference
    // ============================================
    if (isLargeOrder) {
      // If no preference provided, return CHOICE_REQUIRED with checkout_session_id
      if (!paymentMethodPreference) {
        const availableOptions = getLargeOrderOptions(paymentSettings);
        
        if (availableOptions.length === 0) {
          console.error('[mobile-checkout] NO_LARGE_ORDER_OPTIONS', {
            stripe_enabled: paymentSettings.stripe_enabled,
          });
          return jsonResponse({
            success: false,
            code: 'NO_PAYMENT_OPTIONS',
            message: 'No payment methods available for large orders. Please contact support.',
            error: 'Large order payment methods are disabled.',
          }, 200);
        }
        
        // Create checkout_session to lock cart state
        const { data: choiceSession, error: choiceSessionError } = await supabase
          .from('checkout_sessions')
          .insert({
            user_id: user.id,
            order_id: existingOrder.id,
            cart_snapshot: cartSnapshot,
            totals_breakdown: totalsBreakdown,
            currency: 'USD', // Large orders always in USD
            pay_method: 'CHOICE_REQUIRED',
            grand_total: totalsBreakdown.grand_total,
            integrity_hash: integrityHash,
            status: 'choice_required',
            metadata: {
              is_large_order: true,
              reason: containsVehicle ? 'vehicle_order' : 'over_mobile_money_limit',
              available_options: availableOptions,
              cart_item_ids: cart_item_ids,
            },
          })
          .select('id')
          .single();
        
        perf.mark('choice_session_created');
        
        if (choiceSessionError) {
          console.error('[mobile-checkout] Failed to create choice checkout_session:', choiceSessionError);
        }
        
        console.log('[mobile-checkout] CHECKOUT_CHOICE_REQUIRED', {
          order_id: existingOrder.id,
          checkout_session_id: choiceSession?.id || null,
          amount: totalsBreakdown.grand_total,
          original_currency: targetCurrency,
          required_currency: 'USD',
          options: availableOptions,
          reason: containsVehicle ? 'vehicle_order' : 'over_mobile_money_limit',
          total_ms: perf.total(),
        });
        
        // Build structured available methods for frontend
        const available_methods = buildAvailableMethods(
          paymentSettings,
          totalsBreakdown.grand_total,
          containsVehicle
        );

        return jsonResponse({
          success: true,
          order_id: existingOrder.id,
          checkout_session_id: choiceSession?.id || null,
          payment_flow: 'CHOICE_REQUIRED' as PaymentFlow,
          amount: totalsBreakdown.grand_total,
          currency: targetCurrency, // Original user choice (informational)
          required_currency: 'USD', // Required for large orders
          cdf_equivalent: totalsBreakdown.cdf_equivalent,
          options: availableOptions,
          available_methods, // NEW: Structured payment methods with enabled/disabled reasons
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
      
      // ENFORCE USD for CARD payments
      if (paymentMethodPreference === 'CARD' && clientRequestedCurrency === 'CDF') {
        console.log('[mobile-checkout] USD_REQUIRED_FOR_CARD', {
          requested_currency: 'CDF',
          required_currency: 'USD',
        });
        return jsonResponse({
          success: false,
          code: 'USD_REQUIRED_FOR_CARD',
          message: 'Card payments require USD.',
          message_fr: 'Les paiements par carte nécessitent USD.',
          error: 'Card payments must be in USD.',
          required_currency: 'USD',
        }, 400);
      }
      
      // Check if selected method is enabled
      if (paymentMethodPreference === 'CARD' && !paymentSettings.stripe_enabled) {
        return jsonResponse({
          success: false,
          code: 'PAYMENT_METHOD_DISABLED',
          message: 'Card payments are currently disabled. Please contact support.',
          error: 'Stripe is not enabled.',
        }, 400);
      }
      
      // ============================================
      // P0 CRITICAL FIX: Process large order payment IMMEDIATELY
      // When preference is provided, do NOT fall through to standard order flow
      // ============================================
      console.log('[router] preference=' + paymentMethodPreference + ' -> processing large order payment immediately');
      
      // Create checkout order for large order with preference
      const timestamp = Date.now().toString(36);
      
      const { data: largeOrderCheckout, error: largeOrderError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          status: 'PENDING_PAYMENT',
          item_total_usd: round2(totalsBreakdown.subtotal_items),
          service_fee_usd: round2(totalsBreakdown.markup_fee),
          shipping_fee_usd: round2(totalsBreakdown.shipping_fee),
          total_usd: totalsBreakdown.grand_total,
          total_cdf: totalsBreakdown.cdf_equivalent,
          exchange_rate_used: settings.exchangeRate,
          // maisha_payment_status removed
          admin_notes: notes || null,
          shipping_city: mapToShippingCity(profile.city),
          contains_vehicle: containsVehicle,
          normalized_currency: 'USD',
          normalized_amount: totalsBreakdown.grand_total,
        })
        .select()
        .single();

      if (largeOrderError) {
        console.error('[mobile-checkout] Error creating large order checkout:', largeOrderError);
        return jsonResponse({ success: false, error: 'Failed to create order. Please try again.' }, 200);
      }

      const largeOrderReference = `AFRISHOP-${largeOrderCheckout.id.slice(0, 8)}-${timestamp}`;
      // Store reference in operator_ref_id (maisha_transaction_id removed)
      await supabase.from('orders').update({
        operator_ref_id: largeOrderReference,
      }).eq('id', largeOrderCheckout.id);

      // Copy items to the checkout order
      const { data: itemsToCopy, error: fetchItemsError } = await supabase
        .from('order_items')
        .select('*')
        .in('id', cart_item_ids);
      
      if (fetchItemsError || !itemsToCopy || itemsToCopy.length !== cart_item_ids.length) {
        console.error('[mobile-checkout] Error fetching items for large order:', fetchItemsError);
        await supabase.from('orders').delete().eq('id', largeOrderCheckout.id);
        return jsonResponse({ ok: false, success: false, code: 'CHECKOUT_ITEM_COPY_FAILED', message: 'Failed to process checkout. Please try again.', message_fr: 'Échec du traitement. Veuillez réessayer.' }, 200);
      }
      
      // Normalize pricing before copying (fixes legacy items with null pricing fields)
      const copiedItems = itemsToCopy.map(rawItem => {
        const item = normalizeItemPricing(rawItem, settings);
        return ({
        order_id: largeOrderCheckout.id,
        product_url: item.product_url,
        title: item.title,
        product_image_url: item.product_image_url,
        store: item.store,
        base_price_usd: item.base_price_usd,
        unit_price_usd: item.unit_price_usd,
        quantity: item.quantity,
        subtotal_usd: item.subtotal_usd,
        markup_fee_usd: item.markup_fee_usd,
        shipping_fee_usd: item.shipping_fee_usd,
        total_price_usd: item.total_price_usd,
        total_price_cdf: item.total_price_cdf,
        est_weight_kg: item.est_weight_kg,
        requires_manual_quote: item.requires_manual_quote,
        is_vehicle: item.is_vehicle,
        vehicle_quote_applied: item.vehicle_quote_applied,
        shipping_item_type_id: item.shipping_item_type_id,
        shipping_status: item.shipping_status,
        notes: item.notes,
        price_source: item.price_source,
        captured_price: item.captured_price,
        price_confirmation_id: item.price_confirmation_id,
        price_confirmation_status: item.price_confirmation_status,
        admin_adjusted_price: item.admin_adjusted_price,
        is_saved_for_later: false,
      });});
      
      const { error: copyItemsError } = await supabase
        .from('order_items')
        .insert(copiedItems);

      if (copyItemsError) {
        console.error('[mobile-checkout] Error copying items for large order:', copyItemsError);
        await supabase.from('orders').delete().eq('id', largeOrderCheckout.id);
        return jsonResponse({ success: false, error: 'Failed to process checkout. Please try again.' }, 200);
      }

      // POST-COPY VERIFICATION: Ensure items actually exist on the new order
      const { count: verifyCount } = await supabase
        .from('order_items')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', largeOrderCheckout.id);
      
      if (!verifyCount || verifyCount === 0) {
        console.error('[mobile-checkout] POST_COPY_VERIFY_FAILED: Large order has 0 items after copy', {
          order_id: largeOrderCheckout.id,
          expected_items: copiedItems.length,
        });
        await supabase.from('orders').delete().eq('id', largeOrderCheckout.id);
        return jsonResponse({ success: false, error: 'Failed to process checkout items. Please try again.' }, 200);
      }

      // Create checkout session
      const { data: largeOrderSession, error: sessionError } = await supabase
        .from('checkout_sessions')
        .insert({
          user_id: user.id,
          order_id: largeOrderCheckout.id,
          cart_snapshot: cartSnapshot,
          totals_breakdown: totalsBreakdown,
          currency: 'USD',
          pay_method: paymentMethodPreference,
          grand_total: totalsBreakdown.grand_total,
          integrity_hash: integrityHash,
          // maisha_reference removed
          status: 'processing',
          metadata: {
            is_large_order: true,
            payment_method_preference: paymentMethodPreference,
            source_order_id: existingOrder.id,
            original_cart_item_ids: cart_item_ids,
          },
        })
        .select('id')
        .single();

      if (sessionError) {
        console.warn('[mobile-checkout] Failed to create checkout session for large order:', sessionError);
      }

      // ============================================
      // CARD (STRIPE) BRANCH for large orders with preference
      // ============================================
      if (paymentMethodPreference === 'CARD') {
        console.log('[router] preference=CARD -> flow=STRIPE, initiating payment');
        
        const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!stripeSecretKey) {
          console.error('[router] preference=CARD -> STRIPE_SECRET_KEY=MISSING');
          return jsonResponse({
            success: false,
            code: 'STRIPE_NOT_CONFIGURED',
            message: 'Card payment is not configured. Please contact support.',
            message_fr: 'Le paiement par carte n\'est pas configuré. Veuillez contacter le support.',
            error: 'STRIPE_SECRET_KEY not configured.',
          }, 200);
        }
        
        const stripeProvider = await getActiveProvider(supabase, isoCode || 'COD', 'CARD');
        
        if (stripeProvider && stripeProvider.provider_key === 'stripe' && stripeProvider.is_enabled) {
          try {
            const { createPaymentIntent, getStripeConfig } = await import('../_shared/stripeAdapter.ts');
            const stripeConfig = getStripeConfig(stripeProvider);
            
            const stripeReference = generateProviderRef(largeOrderCheckout.id);
            
            const stripeResult = await createPaymentIntent(stripeConfig, {
              orderId: largeOrderCheckout.id,
              userId: user.id,
              intentId: stripeReference,
              amount: totalsBreakdown.grand_total,
              description: `AfriShop Order #${largeOrderCheckout.id.slice(0, 8)}`,
            });
            
            if (stripeResult.success && stripeResult.client_secret) {
              // Create payment record
              await createPaymentRecord(supabase, {
                order_id: largeOrderCheckout.id,
                provider_key: 'stripe',
                amount: totalsBreakdown.grand_total,
                currency: 'USD',
                reference: stripeReference,
                provider_deposit_id: stripeResult.provider_deposit_id,
                client_secret: stripeResult.client_secret,
                raw_request: stripeResult.raw_request,
                status: 'pending',
              });
              
              // Update session status
              if (largeOrderSession?.id) {
                await supabase.from('checkout_sessions').update({ 
                  status: 'stripe_initiated',
                  updated_at: new Date().toISOString(),
                }).eq('id', largeOrderSession.id);
              }
              
              console.log('[router] preference=CARD -> flow=STRIPE, hasClientSecret=true', {
                order_id: largeOrderCheckout.id,
                checkout_session_id: largeOrderSession?.id || null,
                amount: totalsBreakdown.grand_total,
                reference: stripeReference,
              });
              
              return jsonResponse({
                success: true,
                order_id: largeOrderCheckout.id,
                checkout_session_id: largeOrderSession?.id || null,
                payment_flow: 'STRIPE' as PaymentFlow,
                currency: 'USD',
                amount: totalsBreakdown.grand_total,
                provider: 'stripe',
                clientSecret: stripeResult.client_secret,
                nextAction: {
                  type: 'stripe_payment_intent',
                  clientSecret: stripeResult.client_secret,
                },
                confirmationId: largeOrderCheckout.id.substring(0, 8).toUpperCase(),
                reference: stripeReference,
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
              console.error('[router] preference=CARD -> flow=STRIPE, hasClientSecret=false', {
                order_id: largeOrderCheckout.id,
                error: stripeResult.error,
              });
              return jsonResponse({
                success: false,
                code: 'STRIPE_INIT_FAILED',
                message: 'Unable to initialize card payment. Please try again.',
                message_fr: 'Impossible d\'initialiser le paiement par carte. Veuillez réessayer.',
                error: stripeResult.error || 'Failed to create Stripe payment intent.',
                order_id: largeOrderCheckout.id,
              }, 200);
            }
          } catch (stripeError: any) {
            console.error('[router] preference=CARD -> STRIPE_EXCEPTION', {
              order_id: largeOrderCheckout.id,
              error: stripeError.message,
            });
            return jsonResponse({
              success: false,
              code: 'STRIPE_INIT_FAILED',
              message: 'Unable to initialize card payment. Please try again.',
              message_fr: 'Impossible d\'initialiser le paiement par carte. Veuillez réessayer.',
              error: stripeError.message,
              order_id: largeOrderCheckout.id,
            }, 200);
          }
        }
        
        // No Stripe provider available
        console.warn('[router] preference=CARD -> flow=STRIPE, provider_available=false');
        return jsonResponse({
          success: false,
          code: 'CARD_NOT_AVAILABLE',
          message: 'Card payments are not available. Please contact support.',
          message_fr: 'Les paiements par carte ne sont pas disponibles. Veuillez contacter le support.',
          error: 'Card payment provider not configured.',
        }, 200);
      }
      
      // Should never reach here - preference was validated above
      console.error('[mobile-checkout] UNEXPECTED_STATE: isLargeOrder with preference but no matching branch', {
        paymentMethodPreference,
      });
      return jsonResponse({
        success: false,
        code: 'UNEXPECTED_STATE',
        message: 'An unexpected error occurred. Please try again.',
        error: 'Invalid state in large order processing.',
      }, 200);
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
        code: 'PAYMENT_NOT_AVAILABLE',
        message: 'Mobile money payments are currently unavailable. Please try again later.',
        error: 'pawaPay is disabled.',
      }, 200);
    }

    // ============================================
    // DETERMINE FINAL CURRENCY: Based on DRC + method enforcement
    // ============================================
    let payable_currency: 'USD' | 'CDF' = targetCurrency;
    let currencyReason = 'client_requested';

    // Force USD for large orders or CARD payments
    if (isLargeOrder || REQUESTED_METHOD === 'CARD' || paymentMethodPreference === 'CARD') {
      payable_currency = 'USD';
      currencyReason = isLargeOrder ? 'large_order_requires_usd' : 'card_requires_usd';
    }
    
    // P0: Compute payable_amount = server grand_total (NO CLIENT AMOUNTS)
    const payable_amount = payable_currency === 'CDF' 
      ? round2(totalsBreakdown.cdf_equivalent)
      : round2(totalsBreakdown.grand_total);

    // Display formatting
    const displayAmount = payable_currency === 'CDF'
      ? `${payable_amount.toLocaleString('fr-CD')} CDF`
      : `$${payable_amount.toFixed(2)} USD`;

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
    // CART STATE LOGGING (BEFORE CHECKOUT)
    // ============================================
    console.log('[checkout] cart_id before/after (should be same)', {
      cart_id: existingOrder.id,
      cart_version: existingOrder.cart_version,
      item_ids_count: cart_item_ids.length,
    });

    // ============================================
    // PERF OPTIMIZED: Create checkout order with reference in single insert
    // This eliminates the separate update call (saves ~40ms)
    // ============================================
    const orderCreateStart = Date.now();
    const timestamp = Date.now().toString(36);
    const tempOrderId = crypto.randomUUID();
    const reference = `AFRISHOP-${tempOrderId.slice(0, 8)}-${timestamp}`;
    
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
        // maisha columns removed
        operator_ref_id: reference,
        admin_notes: notes || null,
        shipping_city: mapToShippingCity(profile.city),
        contains_vehicle: containsVehicle,
        normalized_currency: payable_currency,
        normalized_amount: payable_amount,
      })
      .select()
      .single();

    perf.mark('order_created');
    console.log(`[CHECKOUT_PERF] order_create_ms=${Date.now() - orderCreateStart}`);

    if (createOrderError) {
      console.error('[mobile-checkout] Error creating checkout order:', createOrderError);
      return jsonResponse({ success: false, error: 'Failed to create order. Please try again.' }, 200);
    }

    // Update reference with actual order ID
    const finalReference = `AFRISHOP-${checkoutOrder.id.slice(0, 8)}-${timestamp}`;
    if (finalReference !== reference) {
      await supabase.from('orders').update({
        operator_ref_id: finalReference,
      }).eq('id', checkoutOrder.id);
    }

    // ============================================
    // P0 CRITICAL FIX: COPY items to checkout order (NOT MOVE)
    // Cart items remain in DRAFT order until payment is verified
    // This prevents CART_DESYNC when user cancels and retries
    // ============================================
    const itemsCopyStart = Date.now();
    
    // Fetch full item data to copy
    const { data: itemsToCopy, error: fetchItemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('id', cart_item_ids);
    
    if (fetchItemsError || !itemsToCopy || itemsToCopy.length !== cart_item_ids.length) {
      console.error('[mobile-checkout] Error fetching items to copy:', fetchItemsError);
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ ok: false, success: false, code: 'CHECKOUT_ITEM_COPY_FAILED', message: 'Failed to process checkout. Please try again.', message_fr: 'Échec du traitement. Veuillez réessayer.' }, 200);
    }
    
    // Normalize pricing before copying (fixes legacy items with null pricing fields)
    const copiedItems = itemsToCopy.map(rawItem => {
      const item = normalizeItemPricing(rawItem, settings);
      return ({
      order_id: checkoutOrder.id,
      product_url: item.product_url,
      title: item.title,
      product_image_url: item.product_image_url,
      store: item.store,
      base_price_usd: item.base_price_usd,
      unit_price_usd: item.unit_price_usd,
      quantity: item.quantity,
      subtotal_usd: item.subtotal_usd,
      markup_fee_usd: item.markup_fee_usd,
      shipping_fee_usd: item.shipping_fee_usd,
      total_price_usd: item.total_price_usd,
      total_price_cdf: item.total_price_cdf,
      est_weight_kg: item.est_weight_kg,
      requires_manual_quote: item.requires_manual_quote,
      is_vehicle: item.is_vehicle,
      vehicle_quote_applied: item.vehicle_quote_applied,
      shipping_item_type_id: item.shipping_item_type_id,
      shipping_status: item.shipping_status,
      notes: item.notes,
      price_source: item.price_source,
      captured_price: item.captured_price,
      price_confirmation_id: item.price_confirmation_id,
      price_confirmation_status: item.price_confirmation_status,
      admin_adjusted_price: item.admin_adjusted_price,
      is_saved_for_later: false, // Checkout items are never saved for later
      // Do NOT copy: id (auto-generated), created_at, updated_at, saved_at, last_reminder_at
    });});
    
    const { data: insertedItems, error: copyItemsError } = await supabase
      .from('order_items')
      .insert(copiedItems)
      .select('id');

    perf.mark('items_copied');
    console.log(`[CHECKOUT_PERF] items_copy_ms=${Date.now() - itemsCopyStart}`);

    if (copyItemsError || !insertedItems) {
      console.error('[mobile-checkout] Error copying items to checkout order:', copyItemsError);
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ success: false, error: 'Failed to process checkout. Please try again.' }, 200);
    }

    // POST-COPY VERIFICATION: Ensure items actually exist on the new order
    const { count: verifyItemCount } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', checkoutOrder.id);
    
    if (!verifyItemCount || verifyItemCount === 0) {
      console.error('[mobile-checkout] POST_COPY_VERIFY_FAILED: Checkout order has 0 items after copy', {
        order_id: checkoutOrder.id,
        expected_items: copiedItems.length,
        inserted_items_response: insertedItems?.length,
      });
      await supabase.from('orders').delete().eq('id', checkoutOrder.id);
      return jsonResponse({ success: false, error: 'Failed to process checkout items. Please try again.' }, 200);
    }
    
    // Log cart state after checkout (DRAFT cart should be unchanged)
    console.log('[checkout] item ids count before/after (should be same)', {
      original_cart_id: existingOrder.id,
      checkout_order_id: checkoutOrder.id,
      original_item_ids: cart_item_ids,
      copied_item_ids: insertedItems.map(i => i.id),
      items_remain_in_cart: true,
    });

    // ============================================
    // PAYMENT STATE MACHINE FIX: Create checkout_session with awaiting_provider_selection
    // NO PROVIDER API CALLS HERE - provider is selected in select-payment-provider endpoint
    // ============================================
    const sessionCreateStart = Date.now();
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
        // maisha_reference removed
        status: 'awaiting_provider_selection', // CRITICAL: No provider called yet
        selected_provider: null, // Set by select-payment-provider
        metadata: {
          client_cart_version: clientCartVersion,
          server_cart_version: existingOrder.cart_version,
          isDRC,
          isoCode,
          currencyReason,
          // P0 CRITICAL: Store original cart item IDs and source order for cleanup on success
          source_order_id: existingOrder.id, // DRAFT order where original items live
          original_cart_item_ids: cart_item_ids, // Items to delete from DRAFT on payment success
          cart_item_ids: cart_item_ids, // Legacy field (keep for compatibility)
          requested_method: REQUESTED_METHOD,
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

    perf.mark('session_created');
    console.log(`[CHECKOUT_PERF] session_create_ms=${Date.now() - sessionCreateStart}`);

    if (sessionError) {
      console.warn('[mobile-checkout] Failed to create checkout_session (non-fatal):', sessionError);
    }

    // Log final performance summary
    console.log('[CHECKOUT_PERF] TOTAL_MS=' + perf.total() + ' checkpoints=' + JSON.stringify(perf.checkpoints()));

    console.log('[PAYMENT_FLOW] CHECKOUT_SESSION_CREATED', {
      checkout_session_id: checkoutSession?.id || null,
      order_id: checkoutOrder.id,
      user_id: user.id.slice(0, 8) + '***',
      amount: payable_amount,
      currency: payable_currency,
      status: 'awaiting_provider_selection',
      provider_called: 'NONE',
      endpoint: 'mobile-checkout',
    });

    // Generate confirmationId early for use in response
    const confirmationId = checkoutOrder.id.substring(0, 8).toUpperCase();

    // ============================================
    // INLINE PROVIDER SELECTION: If provider is specified in request body,
    // call select-payment-provider server-to-server to eliminate fragile 3rd frontend call
    // ============================================
    // AUTO-INFER provider for standard orders: MOBILE_MONEY → pawapay, CARD → stripe
    // This eliminates the need for a separate select-payment-provider call
    let inlineProvider = (body.provider || '').toLowerCase();
    if (!inlineProvider && !isLargeOrder) {
      if (REQUESTED_METHOD === 'MOBILE_MONEY' && paymentSettings.pawapay_enabled) {
        inlineProvider = 'pawapay';
        console.log('[CHECKOUT_INLINE_PROVIDER] Auto-inferred provider=pawapay from MOBILE_MONEY method');
      } else if (REQUESTED_METHOD === 'CARD' && paymentSettings.stripe_enabled) {
        inlineProvider = 'stripe';
        console.log('[CHECKOUT_INLINE_PROVIDER] Auto-inferred provider=stripe from CARD method');
      }
    }
    const inlinePhone = body.phone || validatedPhone;
    const inlineOperator = body.operator || '';

    if (inlineProvider && checkoutSession?.id && (inlineProvider === 'pawapay' || inlineProvider === 'stripe')) {
      console.log('[CHECKOUT_INLINE_PROVIDER] Initiating inline provider selection', {
        provider: inlineProvider,
        checkout_session_id: checkoutSession.id,
        order_id: checkoutOrder.id,
        has_phone: !!inlinePhone,
        has_operator: !!inlineOperator,
      });

      perf.mark('inline_provider_start');

      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error('[CHECKOUT_INLINE_PROVIDER] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
          // Fall through to return awaiting_provider_selection
        } else {
          const selectProviderPayload = {
            checkout_session_id: checkoutSession.id,
            provider: inlineProvider,
            ...(inlineProvider === 'pawapay' && inlinePhone ? { phone: inlinePhone } : {}),
            ...(inlineProvider === 'pawapay' && inlineOperator ? { operator: inlineOperator } : {}),
          };

          const { token: inlineToken, source: inlineTokenSource } = await extractRequestToken(req);
          const forwardHeaders = new Headers();
          const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
          if (authHeader) {
            forwardHeaders.set('Authorization', authHeader);
          } else if (inlineToken) {
            forwardHeaders.set('Authorization', `Bearer ${inlineToken}`);
          }
          forwardHeaders.set('Content-Type', 'application/json');
          forwardHeaders.set('apikey', Deno.env.get('SUPABASE_ANON_KEY') || '');
          for (const h of [
            'x-auth-token',
            'x-session-token',
            'x-access-token',
            'x-jwt',
            'x-supabase-auth',
            'x-device-id',
            'x-client-info',
            'user-agent',
            'X-Afrishop-Environment',
          ]) {
            const value = req.headers.get(h);
            if (value) forwardHeaders.set(h, value);
          }

          console.log('[CHECKOUT_INLINE_PROVIDER] forwarding auth headers', {
            downstreamFunction: 'select-payment-provider',
            tokenSource: inlineTokenSource || 'missing',
            hasAuthorizationHeader: !!authHeader,
            hasExtractedToken: !!inlineToken,
            alternateHeaders: {
              'x-auth-token': !!req.headers.get('x-auth-token'),
              'x-session-token': !!req.headers.get('x-session-token'),
              'x-access-token': !!req.headers.get('x-access-token'),
              'x-jwt': !!req.headers.get('x-jwt'),
              'x-supabase-auth': !!req.headers.get('x-supabase-auth'),
            },
          });

          const providerResponse = await fetch(`${supabaseUrl}/functions/v1/select-payment-provider`, {
            method: 'POST',
            headers: forwardHeaders,
            body: JSON.stringify(selectProviderPayload),
          });

          const providerData = await providerResponse.json();
          perf.mark('inline_provider_done');

          console.log('[CHECKOUT_INLINE_PROVIDER] Provider response', {
            status: providerResponse.status,
            success: providerData?.success,
            provider: providerData?.provider,
            has_clientSecret: !!providerData?.clientSecret,
            has_deposit_id: !!providerData?.deposit_id,
            total_ms: perf.total(),
          });

          // If provider selection succeeded, return the combined result
          if (providerData?.success) {
            return jsonResponse({
              ...providerData,
              // Ensure these fields are always present
              order_id: providerData.order_id || checkoutOrder.id,
              checkout_session_id: providerData.checkout_session_id || checkoutSession.id,
              totals_breakdown: providerData.totals_breakdown || {
                subtotal: totalsBreakdown.subtotal_items,
                shipping: totalsBreakdown.shipping_fee,
                markup: totalsBreakdown.markup_fee,
                taxes: totalsBreakdown.taxes_fee,
                grand_total: totalsBreakdown.grand_total,
                currency: payable_currency,
                cdf_equivalent: totalsBreakdown.cdf_equivalent,
                exchange_rate: totalsBreakdown.exchange_rate,
              },
              inline_provider_used: true,
            });
          } else {
            // Provider selection failed — include the error in the response
            // but still return the session so frontend can retry
            console.warn('[CHECKOUT_INLINE_PROVIDER] Provider selection failed, returning with error', {
              code: providerData?.code,
              message: providerData?.message,
            });

            return jsonResponse({
              success: true,
              order_id: checkoutOrder.id,
              checkout_session_id: checkoutSession.id,
              status: 'awaiting_provider_selection',
              provider_error: {
                code: providerData?.code || 'PROVIDER_FAILED',
                message: providerData?.message || 'Payment provider failed',
                message_fr: providerData?.message_fr || 'Le fournisseur de paiement a échoué',
              },
              amount: payable_amount,
              currency: payable_currency,
              confirmationId,
              totals_breakdown: {
                subtotal: totalsBreakdown.subtotal_items,
                shipping: totalsBreakdown.shipping_fee,
                markup: totalsBreakdown.markup_fee,
                taxes: totalsBreakdown.taxes_fee,
                grand_total: totalsBreakdown.grand_total,
                currency: payable_currency,
                cdf_equivalent: totalsBreakdown.cdf_equivalent,
                exchange_rate: totalsBreakdown.exchange_rate,
              },
            });
          }
        }
      } catch (inlineError: any) {
        console.error('[CHECKOUT_INLINE_PROVIDER] Exception during inline provider call', {
          error: inlineError.message,
        });
        // Fall through to return awaiting_provider_selection (backward compatible)
      }
    }

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
    // PAYMENT STATE MACHINE FIX: Return awaiting_provider_selection for ALL methods
    // NO PROVIDER API CALLS - user must explicitly select provider via select-payment-provider
    // ============================================
    
    // Determine available providers based on order characteristics
    const availableProviders: string[] = [];
    
    if (!isLargeOrder && paymentSettings.pawapay_enabled) {
      availableProviders.push('pawapay');
    }
    if (paymentSettings.stripe_enabled) {
      availableProviders.push('stripe');
    }
    
    // Build structured available methods for frontend (eliminates secondary API call)
    const available_methods = buildAvailableMethods(
      paymentSettings,
      totalsBreakdown.grand_total,
      containsVehicle
    );

    // Return session ready for provider selection
    return jsonResponse({
      success: true,
      order_id: checkoutOrder.id,
      checkout_session_id: checkoutSession?.id || null,
      status: 'awaiting_provider_selection',
      payment_flow: isLargeOrder ? 'CHOICE_REQUIRED' : 'AWAITING_SELECTION' as any,
      amount: payable_amount,
      currency: payable_currency,
      cdf_equivalent: totalsBreakdown.cdf_equivalent,
      available_providers: availableProviders,
      available_methods,
      is_large_order: isLargeOrder,
      reason: isLargeOrder 
        ? (containsVehicle ? 'vehicle_order' : 'over_mobile_money_limit')
        : 'standard_order',
      confirmationId,
      message: 'Please select your payment method.',
      message_fr: 'Veuillez sélectionner votre mode de paiement.',
      next_step: {
        endpoint: '/functions/v1/select-payment-provider',
        method: 'POST',
        required_fields: {
          checkout_session_id: checkoutSession?.id || null,
          provider: 'pawapay | stripe',
          phone: 'required for pawapay',
        },
      },
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
    });

  } catch (error: any) {
    const elapsedMs = typeof perf !== 'undefined' ? perf.total() : Date.now() - startTime;
    console.error(`[CHECKOUT][ERROR] correlationId=${correlationId} code=INTERNAL_ERROR message=${error.message} ms=${elapsedMs}`);
    
    // ALWAYS return HTTP 200 with JSON (never non-2xx for application errors)
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        ok: false,
        success: false, 
        code: 'AUTH_ERROR',
        error: error.message,
        correlationId,
      }, 200);
    }
    
    return jsonResponse({ 
      ok: false,
      success: false, 
      code: 'RETRY',
      message: 'Temporary issue, please retry.',
      message_fr: 'Problème temporaire, veuillez réessayer.',
      error: 'An unexpected error occurred. Please try again.',
      correlationId,
    }, 200);
  }
});

function mapToShippingCity(city: string | null): 'KINSHASA' | 'LUBUMBASHI' | 'OTHER' | null {
  if (!city) return null;
  const normalized = city.toUpperCase().trim();
  if (normalized === 'KINSHASA') return 'KINSHASA';
  if (normalized === 'LUBUMBASHI') return 'LUBUMBASHI';
  return 'OTHER';
}
