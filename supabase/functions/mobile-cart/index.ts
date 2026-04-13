/**
 * mobile-cart — Consolidated Cart Router (INLINED)
 * 
 * Routes by `action` field in POST body:
 *   get_cart, add_item, update_item, delete_item, sync, merge_guest, guest_snapshot
 * 
 * GET requests default to get_cart action.
 * 
 * AUTH: All actions require JWT except guest_snapshot.
 * 
 * Batch 9: Business logic inlined from:
 *   - mobile-get-cart
 *   - mobile-add-cart-item
 *   - mobile-update-cart-item
 *   - mobile-delete-cart-item
 *   - cart-sync-from-client
 *   - merge-guest-cart
 *   - cart-guest-snapshot
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  corsHeaders,
  extractBearerToken,
  extractRequestToken,
  createAdminPostgrestClient,
  createAdminClient,
} from "../_shared/auth.ts";
import { PostgrestClient } from "../_shared/postgrest.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
import { calculateVehicleFinalPrice, parseTiers } from "../_shared/vehiclePricing.ts";
import { normalizeCategorySlug, getCategoryLabel, determineShippingCategory } from "../_shared/shippingCategory.ts";
import { isBlockedImageUrl } from "../_shared/imageValidation.ts";
import { sanitizeImageUrl } from "../_shared/imageValidator.ts";
import { lookupCartItemMediaCounts } from "../_shared/mediaCache.ts";
import { 
  calculateItemPricing, 
  updateOrderTotals,
  detectStore as cartDetectStore,
  isVehicleItem,
  normalizeProductUrl,
  canonicalizeProductUrl,
  getOrCreateSingleDraftOrder,
} from "../_shared/cartHelpers.ts";
import {
  validateAddCartItemInput,
  isUserEditedPrice as addCartIsUserEdited,
  coalesceImageUrl as addCartCoalesceImage,
  normalizeImageUrl as addCartNormalizeImage,
  detectStore as addCartDetectStore,
} from "../_shared/cart/validate.ts";
import {
  calculateItemPricing as cartPricingCalc,
  calculateShippingFee,
  calculateWeightBasedShippingFee,
  buildItemResponse,
  round2 as cartRound2,
  ShippingCategoryInfo,
  buildAuditLogEntry,
} from "../_shared/cart/pricing.ts";
import {
  scrapeProductInfo,
  getImageFromCache,
  validateImageUrl,
} from "../_shared/cart/images.ts";
import {
  getOrCreateDraftOrder,
  findExistingCartItem,
  updateCartItem,
  insertCartItem,
  getShippingType,
  getShippingTypeForCategory,
  getCachedSettings as cartDbGetSettings,
} from "../_shared/cart/db.ts";
import { updateOrderTotals as sharedUpdateOrderTotals } from "../_shared/cartHelpers.ts";

// ─── Shared Helpers ───────────────────────────────────────

const HEAVY_THRESHOLD_KG = 9;
const EXTRA_PER_KG_USD = 8;

function calculateItemShipping(
  subtotalUsd: number, estWeightKg: number,
  shippingBaseFeeUsd: number, shippingPercent: number
): number {
  const normalizedPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
  const basePart = shippingBaseFeeUsd + (subtotalUsd * normalizedPercent);
  const extraWeight = Math.max(0, estWeightKg - 1);
  const extraPart = extraWeight * EXTRA_PER_KG_USD;
  return round2(basePart + extraPart);
}

/**
 * Fetch LIVE base price from provider API (Rainforest for Amazon, eBay API for eBay).
 * This bypasses stale catalog_items cache and gets the real current price.
 * Returns null if the lookup fails (caller should fall back to other methods).
 */
async function fetchLiveBasePrice(
  productUrl: string,
  store: string,
  correlationId: string
): Promise<{ basePriceUsd: number; title: string | null; imageUrl: string | null } | null> {
  try {
    if (store === 'AMAZON') {
      const asinMatch = productUrl.match(/(?:\/dp\/|\/gp\/(?:product|aw\/d)\/)([A-Z0-9]{10})/i);
      if (!asinMatch) return null;
      const asin = asinMatch[1].toUpperCase();
      const apiKey = Deno.env.get("RAINFOREST_API_KEY");
      if (!apiKey) {
        console.warn(`[CART_ADD][${correlationId}] fetchLiveBasePrice: no RAINFOREST_API_KEY`);
        return null;
      }
      const url = `https://api.rainforestapi.com/request?api_key=${apiKey}&type=product&amazon_domain=amazon.com&asin=${asin}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) {
          console.warn(`[CART_ADD][${correlationId}] fetchLiveBasePrice: Rainforest HTTP ${resp.status}`);
          return null;
        }
        const data = await resp.json();
        if (!data.product) return null;
        const p = data.product;
        // Extract price from multiple fields
        const priceObj = p.buybox_winner?.price ?? p.price ?? p.current_price ?? p.prices?.[0] ?? p.rrp;
        const priceValue = typeof priceObj?.value === 'number' && priceObj.value > 0 ? priceObj.value : null;
        if (!priceValue) {
          console.warn(`[CART_ADD][${correlationId}] fetchLiveBasePrice: no price in Rainforest response for ${asin}`);
          return null;
        }
        const title = p.title || null;
        const imageUrl = p.main_image?.link || null;
        console.log(`[CART_ADD][${correlationId}] fetchLiveBasePrice: LIVE price for ${asin} = $${priceValue}`);
        
        // Update catalog_items with fresh price (fire-and-forget)
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceKey) {
          const catalogId = `amazon_${asin}`;
          const adminDb = createClient(supabaseUrl, serviceKey);
          adminDb.from('catalog_items').update({
            price_usd: priceValue,
            price_updated_at: new Date().toISOString(),
            data_updated_at: new Date().toISOString(),
          }).eq('id', catalogId).then(({ error }) => {
            if (error) console.warn(`[CART_ADD][${correlationId}] catalog_items update failed: ${error.message}`);
            else console.log(`[CART_ADD][${correlationId}] catalog_items updated ${catalogId} price to $${priceValue}`);
          });
        }
        
        return { basePriceUsd: priceValue, title, imageUrl };
      } catch (e) {
        clearTimeout(timeout);
        console.warn(`[CART_ADD][${correlationId}] fetchLiveBasePrice: exception ${(e as Error).message}`);
        return null;
      }
    }
    // For eBay or other stores, fall back to null (use existing methods)
    return null;
  } catch (e) {
    console.warn(`[CART_ADD][${correlationId}] fetchLiveBasePrice: outer exception ${(e as Error).message}`);
    return null;
  }
}

/**
 * Scrape current price from Amazon product page (lightweight, no API key needed).
 * Used as staleness guard when catalog_items price is >24h old.
 */
async function scrapeAmazonPriceForCart(asin: string): Promise<number | null> {
  try {
    const url = `https://www.amazon.com/dp/${asin}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const patterns = [
      /corePrice[^{]*\{[^}]*"value"\s*:\s*([\d.]+)/,
      /id="priceblock_ourprice"[^>]*>\s*\$\s*([\d,]+\.?\d*)/i,
      /"price"\s*:\s*"?\$?([\d,]+\.?\d*)"?/,
      /class="a-price-whole"[^>]*>([\d,]+)<.*?class="a-price-fraction"[^>]*>(\d+)/s,
      /\$\s*([\d,]+\.\d{2})\s*<\/span>/,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        const raw = m[2] ? `${m[1]}.${m[2]}` : m[1];
        const v = parseFloat(raw.replace(/,/g, ''));
        if (v > 0 && v < 100000) return v;
      }
    }
    const jsonLd = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of jsonLd) {
      try {
        const j = JSON.parse(m[1]);
        const p = j?.offers?.price || j?.offers?.lowPrice;
        if (p) { const v = parseFloat(String(p)); if (v > 0) return v; }
      } catch { /* skip */ }
    }
    return null;
  } catch { return null; }
}

function normalizeImageUrl(raw: unknown, productUrl?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("data:") || s.startsWith("blob:")) return null;
  if (s.startsWith("//")) s = "https:" + s;
  if (s.startsWith("/") || (!s.startsWith("http://") && !s.startsWith("https://"))) {
    if (productUrl) {
      try { const base = new URL(productUrl); s = new URL(s, base.origin).toString(); }
      catch { return null; }
    } else return null;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const validatedUrl = u.toString();
    if (isBlockedImageUrl(validatedUrl)) return null;
    return validatedUrl;
  } catch { return null; }
}

function coalesceImageUrl(item: any): { imageUrl: string | null; incomingKeys: string[] } {
  const incomingKeys: string[] = [];
  for (const k of ['productImageUrl', 'image_url', 'imageUrl', 'product_image_url', 'thumbnail', 'photo', 'picture', 'productImage', 'image']) {
    if (item[k]) incomingKeys.push(k);
  }
  const rawImageUrl = item.productImageUrl ?? item.image_url ?? item.imageUrl ?? item.product_image_url ?? 
    item.thumbnail ?? item.photo ?? item.picture ?? item.productImage ?? item.image ?? null;
  const productUrl = item.productUrl ?? item.product_url ?? null;
  return { imageUrl: normalizeImageUrl(rawImageUrl, productUrl), incomingKeys };
}

function isUserEditedPrice(body: any): boolean {
  const priceEditedFlag = body?.priceEdited === true || String(body?.priceEdited ?? "").toLowerCase() === "true" ||
    body?.manual_price === true || String(body?.manual_price ?? "").toLowerCase() === "true";
  const priceSource = String(body?.price_source ?? body?.priceSource ?? "").toLowerCase();
  const isManualSource = priceSource === "manual_user" || priceSource === "manual";
  const confirmStatus = String(body?.price_confirmation_status ?? body?.priceConfirmationStatus ?? "").toLowerCase();
  const isPendingFromFrontend = confirmStatus === "pending";
  const capturedPrice = body?.capturedPrice ?? body?.captured_price ?? body?.capturedPriceUsd ?? body?.captured_price_usd ?? null;
  const productPrice = body?.productPrice ?? body?.price ?? body?.base_price_usd ?? null;
  const hasPriceDifference = capturedPrice !== null && productPrice !== null && Math.abs(Number(productPrice) - Number(capturedPrice)) > 0.01;
  return priceEditedFlag || isManualSource || isPendingFromFrontend || hasPriceDifference;
}

// Format item for get_cart response
function formatItem(
  item: any, markupPercent: number, vehicleMarkupPercent: number, exchangeRate: number,
  shippingRatePerKg: number,
  mediaInfo?: { image_count: number; image_count_status: "cached" | "pending" },
  vehiclePricingTiers?: any,
  protectionSettings?: any,
) {
  const basePriceUsd = Number(item.base_price_usd || 0);
  const quantity = item.quantity || 1;
  const estWeightKg = Number(item.est_weight_kg || 1);
  const isVehicle = item.is_vehicle === true;
  const vehicleQuoteApplied = item.vehicle_quote_applied === true;
  const quoteRequest = item.quote_requests?.[0];
  const quoteStatus = quoteRequest?.status || (isVehicle && !vehicleQuoteApplied ? 'NONE' : null);
  const quotedShippingUsd = quoteRequest?.quoted_shipping_usd ?? null;
  const quotedTotalUsd = quoteRequest?.quoted_total_usd ?? null;
  const priceConfirmationStatus = item.price_confirmation_status ?? null;
  const adminAdjustedPrice = item.admin_adjusted_price ?? null;
  const priceConfirmationId = item.price_confirmation_id ?? null;
  const priceSource = item.price_source ?? null;
  const capturedPrice = item.captured_price ?? null;
  const hasPendingPriceConfirmation = String(priceConfirmationStatus || '').toUpperCase().trim() === 'PENDING';
  const safeImageUrl = sanitizeImageUrl(item.product_image_url) ?? normalizeImageUrl(item.product_image_url, item.product_url);
  const imageCount = mediaInfo?.image_count ?? 1;
  const imageCountStatus = mediaInfo?.image_count_status ?? "pending";
  
  const baseFields = {
    id: item.id, type: isVehicle ? 'vehicle' : 'product',
    productUrl: item.product_url, productTitle: item.title || null, title: item.title || null,
    productImageUrl: safeImageUrl, mainImageUrl: safeImageUrl, image_url: safeImageUrl,
    store: item.store, quantity: isVehicle ? 1 : quantity, estWeightKg,
    isSavedForLater: item.is_saved_for_later || false, savedAt: item.saved_at || null,
    updatedAt: item.updated_at || null, image_count: imageCount, imageCount,
    image_count_status: imageCountStatus, quoteStatus, quotedShippingUsd, quotedTotalUsd,
    isVehicle, vehicleQuoteApplied,
    item_type: isVehicle ? 'vehicle_quote' : 'product',
    shippingType: isVehicle ? 'vehicle' : null, requiresVehicleQuote: isVehicle,
    priceConfirmationStatus, adminAdjustedPrice, priceConfirmationId, priceSource, capturedPrice,
    hasPendingPriceConfirmation, deviceId: item.device_id || null,
  };
  
  if (isVehicle && vehicleQuoteApplied) {
    const storedBase = Number(item.base_price_usd || 0);
    const storedMargin = Number(item.markup_fee_usd || 0);
    const storedShipping = Number(item.shipping_fee_usd || 0);
    const storedTotal = Number(item.total_price_usd || 0);
    const subtotalBeforeShipping = round2(storedBase + storedMargin);
    return {
      ...baseFields, basePriceUsd: storedBase, unitPriceUsd: storedBase, itemBaseTotalUsd: storedBase,
      itemMarginUsd: storedMargin, markupFeeUsd: storedMargin, markup_fee_usd: storedMargin,
      itemShippingUsd: storedShipping, shippingFeeUsd: storedShipping, shipping_fee_usd: storedShipping, shippingCost: storedShipping,
      shippingStatus: 'QUOTED', itemSubtotalUsd: subtotalBeforeShipping, subtotalUsd: subtotalBeforeShipping, subtotal_usd: subtotalBeforeShipping,
      itemTotalUsd: storedTotal, totalPriceUsd: storedTotal, total_price_usd: storedTotal, lineTotalUsd: storedTotal,
      lineTotalCdf: round2(storedTotal * exchangeRate), priceUsd: storedTotal, price: storedTotal,
      itemSubtotalCdf: round2(storedTotal * exchangeRate), requiresManualQuote: false, isQuoteRequired: false,
      shippingItemType: null, effectiveMarkupPercent: vehicleMarkupPercent, markupPercent: vehicleMarkupPercent,
    };
  }
  
  if (isVehicle && !vehicleQuoteApplied) {
    // Auto-calculate using tiered pricing for legacy items without auto-pricing
    const tiers = parseTiers(vehiclePricingTiers);
    const vp = calculateVehicleFinalPrice(basePriceUsd, 'running', 'roro', tiers);
    return {
      ...baseFields, basePriceUsd, unitPriceUsd: basePriceUsd, itemBaseTotalUsd: basePriceUsd,
      itemMarginUsd: vp.totalFeeUsd, markupFeeUsd: vp.totalFeeUsd, markup_fee_usd: vp.totalFeeUsd,
      itemShippingUsd: 0, shippingFeeUsd: 0, shipping_fee_usd: 0, shippingCost: 0,
      shippingStatus: 'INCLUDED', itemSubtotalUsd: vp.finalPriceUsd, subtotalUsd: vp.finalPriceUsd, subtotal_usd: vp.finalPriceUsd,
      itemTotalUsd: vp.finalPriceUsd, totalPriceUsd: vp.finalPriceUsd, total_price_usd: vp.finalPriceUsd, lineTotalUsd: vp.finalPriceUsd,
      lineTotalCdf: round2(vp.finalPriceUsd * exchangeRate), priceUsd: vp.finalPriceUsd, price: vp.finalPriceUsd,
      itemSubtotalCdf: round2(vp.finalPriceUsd * exchangeRate), requiresManualQuote: false, isQuoteRequired: false,
      shippingItemType: null, vehicleMarkupPercent, effectiveMarkupPercent: vp.totalPercent, markupPercent: vp.totalPercent,
      vehiclePricingBreakdown: { tierPercent: vp.tierPercent, conditionSurcharge: vp.conditionSurcharge, shippingSurcharge: vp.shippingSurcharge, totalPercent: vp.totalPercent },
      fees_included: true, is_all_inclusive_display: true, pricing_mode: 'vehicle_tiered',
    };
  }
  
  const itemRequiresQuote = item.requires_manual_quote === true;
  const itemBaseTotalUsd = round2(basePriceUsd * quantity);

  // ALWAYS recalculate from stored base_price_usd using current settings.
  // This ensures prices are never stale — base is the raw provider price,
  // and we apply current markup + shipping on top every time.
  const storedPriceSource = (item.price_source ?? "").toLowerCase();
  const isStoredAllInclusive = storedPriceSource === 'all_inclusive_display' || storedPriceSource === 'hot_product';

  // For all-inclusive (legacy frozen app items): trust stored values (markup/shipping baked in)
  // For everything else: recalculate from base using current settings
  let itemMarginUsd: number;
  let itemShippingUsd: number;

  if (isStoredAllInclusive) {
    // Legacy: trust stored values
    itemMarginUsd = Number(item.markup_fee_usd || 0);
    itemShippingUsd = Number(item.shipping_fee_usd || 0);
  } else {
    // RECALCULATE from raw base price + current settings
    itemMarginUsd = round2(itemBaseTotalUsd * (markupPercent / 100));
    // Shipping: use category data if available, else stored value, else 0
    const sit = item.shipping_item_types;
    if (sit && sit.est_weight_kg != null) {
      const catInfo: ShippingCategoryInfo = {
        est_weight_kg: Number(sit.est_weight_kg),
        flat_shipping_usd: sit.flat_shipping_usd != null ? Number(sit.flat_shipping_usd) : null,
        shipping_buffer_percent: Number(sit.shipping_buffer_percent ?? 25),
        requires_manual_quote: false,
      };
      itemShippingUsd = calculateWeightBasedShippingFee(catInfo, shippingRatePerKg, quantity);
    } else {
      // Use stored shipping if no category data
      itemShippingUsd = Number(item.shipping_fee_usd || 0);
    }
  }

  const itemSubtotalUsd = isStoredAllInclusive
    ? (Number(item.total_price_usd || 0) > 0 ? Number(item.total_price_usd) : itemBaseTotalUsd)
    : round2(itemBaseTotalUsd + itemMarginUsd);
  let itemTotalUsd = round2(itemSubtotalUsd + (isStoredAllInclusive ? 0 : itemShippingUsd));
  const itemSubtotalCdf = round2(itemSubtotalUsd * exchangeRate);

  // Apply pricing protection for non-all-inclusive items
  let protectionMeta: Record<string, unknown> = {};
  if (protectionSettings && !isStoredAllInclusive && !itemRequiresQuote) {
    const { applyPricingProtection } = await import("../_shared/cart/pricingProtection.ts");
    // Determine price age from last update
    const priceAgeHours = item.price_updated_at
      ? (Date.now() - new Date(item.price_updated_at).getTime()) / (1000 * 60 * 60)
      : (item.updated_at
        ? (Date.now() - new Date(item.updated_at).getTime()) / (1000 * 60 * 60)
        : 0);
    const catKey = item.shipping_item_types?.key
      ? normalizeCategorySlug(item.shipping_item_types.key)
      : null;
    const protection = applyPricingProtection(
      itemBaseTotalUsd, itemMarginUsd, itemShippingUsd, exchangeRate,
      protectionSettings,
      { categoryKey: catKey, priceAgeHours, isVehicle: false, requiresManualQuote: itemRequiresQuote, quantity },
    );
    itemTotalUsd = protection.safeFinalPriceUsd;
    protectionMeta = {
      pricing_protection: {
        status: protection.pricingStatus,
        confidence: protection.pricingConfidence,
        requires_review: protection.requiresManualReview,
        profit_usd: protection.profitUsd,
        margin_percent: protection.marginPercent,
        total_protection_usd: protection.totalProtectionUsd,
        reason_codes: protection.reasonCodes,
        min_profit_floor_applied: protection.minProfitFloorApplied,
      },
    };
  }

  // FROZEN APP FIX: Always show all-inclusive price as "basePriceUsd" so the frozen app
  // (which may read basePriceUsd for display) shows the correct all-inclusive total.
  const displayBasePriceUsd = isStoredAllInclusive ? basePriceUsd : round2(itemTotalUsd / quantity);

  return {
    ...baseFields, basePriceUsd: displayBasePriceUsd, unitPriceUsd: displayBasePriceUsd, itemBaseTotalUsd: itemTotalUsd,
    itemMarginUsd, markupFeeUsd: itemMarginUsd, markup_fee_usd: itemMarginUsd,
    itemShippingUsd, shippingFeeUsd: itemShippingUsd, shipping_fee_usd: itemShippingUsd, shippingCost: itemShippingUsd,
    itemSubtotalUsd: itemTotalUsd, subtotalUsd: itemTotalUsd, subtotal_usd: itemTotalUsd,
    itemTotalUsd, totalPriceUsd: itemTotalUsd, total_price_usd: itemTotalUsd, lineTotalUsd: itemTotalUsd,
    lineTotalCdf: round2(itemTotalUsd * exchangeRate), priceUsd: itemTotalUsd, price: itemTotalUsd, itemSubtotalCdf,
    requiresManualQuote: itemRequiresQuote, isQuoteRequired: false,
    shippingItemType: item.shipping_item_types ? {
      key: normalizeCategorySlug(item.shipping_item_types.key) || item.shipping_item_types.key,
      label: getCategoryLabel(normalizeCategorySlug(item.shipping_item_types.key)) || item.shipping_item_types.label,
    } : null,
    effectiveMarkupPercent: isStoredAllInclusive ? 0 : markupPercent,
    markupPercent: isStoredAllInclusive ? 0 : markupPercent,
    fees_included: true, is_all_inclusive_display: true,
    pricing_mode: 'all_inclusive',
    ...protectionMeta,
  };
}

// ─── Action: get_cart ─────────────────────────────────────

async function handleGetCart(req: Request): Promise<Response> {
  const startTime = Date.now();
  const { token, source: tokenSource } = await extractRequestToken(req);
  const hasAuthorizationHeader = !!req.headers.get("authorization") || !!req.headers.get("Authorization");
  const deviceId = req.headers.get("x-device-id") || "";
  console.log(`[CART_GET] action=get_cart tokenSource=${tokenSource ?? "none"} hasAuthorizationHeader=${hasAuthorizationHeader} tokenPresent=${!!token} deviceId=${deviceId || "none"}`);

  const { user, supabase } = await verifyAndGetUser(req, undefined, { token, source: tokenSource });
  const authTime = Date.now() - startTime;
  console.log(`[CART_GET] verifyUserSuccess=true user_id=${user.id} authMs=${authTime}`);

  // Platform detection (fire-and-forget)
  try {
    const ua = (req.headers.get("user-agent") || "").toLowerCase();
    const isMobile = !!(deviceId.trim()) || ua.includes("okhttp") || ua.includes("expo") || ua.includes("dart") ||
      ua.includes("flutter") || ua.includes("reactnative") || ua.includes("react-native");
    supabase.from('profiles').update({ last_active_platform: isMobile ? 'mobile' : 'web' }).eq('user_id', user.id).then(() => {});
  } catch { /* ignore */ }

  const settings = await getCachedSettings(supabase);
  const { exchangeRate, markupPercent, vehicleMarkupPercent, shippingBaseFeeUsd, shippingPercent, shippingRatePerKg } = settings;

  // Fetch draft orders with retry to handle read-replica lag after add_item writes
  let drafts: any[] | null = null;
  let orderError: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await supabase
      .from('orders')
      .select('id, item_total_usd, service_fee_usd, shipping_fee_usd, total_usd, total_cdf, exchange_rate_used, requires_manual_quote, created_at, cart_version')
      .eq('user_id', user.id).eq('status', 'DRAFT').order('created_at', { ascending: false });
    drafts = result.data;
    orderError = result.error;
    if (drafts && drafts.length > 0) break;
    if (attempt < 2) {
      console.log(`[CART_GET] user_id=${user.id} draftRows=0 attempt=${attempt + 1} retrying after 400ms`);
      await new Promise(r => setTimeout(r, 400));
    }
  }

  console.log(`[CART_GET] user_id=${user.id} deviceId=${deviceId || "none"} authPresent=${!!token} draftRows=${drafts?.length ?? 0} orderError=${orderError?.message ?? "none"}`);

  if (!drafts || drafts.length === 0) {
    return jsonResponse({
      ok: true, activeItems: [], savedItems: [],
      summary: { cartId: null, itemCount: 0, itemsTotalUsd: 0, markupFeeUsd: 0, shippingFeeUsd: 0,
        totalUsd: 0, totalCdf: 0, exchangeRate, requiresManualQuote: false, hasVehicleItems: false,
        vehicleQuoteStatus: 'none', canProceedToPayment: true, hasPendingPriceConfirmation: false, pendingPriceConfirmationCount: 0 }
    });
  }

  let order = drafts[0];
  if (drafts.length > 1) {
    const primaryId = order.id;
    const secondaryIds = drafts.slice(1).map((d: any) => d.id);
    const { error: mergeError } = await supabase.rpc('merge_draft_orders', { p_primary_id: primaryId, p_secondary_ids: secondaryIds });
    if (mergeError) {
      for (const oldDraft of drafts.slice(1)) {
        await supabase.from('order_items').update({ order_id: primaryId }).eq('order_id', oldDraft.id);
        await supabase.from('orders').delete().eq('id', oldDraft.id);
      }
    }
  }

  let items: any[] | null = null;
  let itemsError: any = null;

  const selectWithRelations = 'id,product_url,title,product_image_url,store,base_price_usd,unit_price_usd,quantity,subtotal_usd,markup_fee_usd,shipping_fee_usd,total_price_usd,total_price_cdf,est_weight_kg,requires_manual_quote,is_saved_for_later,saved_at,updated_at,is_vehicle,vehicle_quote_applied,device_id,price_confirmation_status,admin_adjusted_price,price_confirmation_id,price_source,captured_price,shipping_item_types(key,label,est_weight_kg,flat_shipping_usd,shipping_buffer_percent),quote_requests(status,quoted_shipping_usd,quoted_total_usd)';
  const selectBase = 'id,product_url,title,product_image_url,store,base_price_usd,unit_price_usd,quantity,subtotal_usd,markup_fee_usd,shipping_fee_usd,total_price_usd,total_price_cdf,est_weight_kg,requires_manual_quote,is_saved_for_later,saved_at,updated_at,is_vehicle,vehicle_quote_applied,device_id,price_confirmation_status,admin_adjusted_price,price_confirmation_id,price_source,captured_price';

  // Fetch items with retry to handle read-replica lag after add_item writes
  for (let itemAttempt = 0; itemAttempt < 3; itemAttempt++) {
    const result1 = await supabase
      .from('order_items')
      .select(selectWithRelations)
      .eq('order_id', order.id);

    items = result1.data;
    itemsError = result1.error;

    if (itemsError || !items || items.length === 0) {
      // Fallback: try without relations
      const result2 = await supabase
        .from('order_items')
        .select(selectBase)
        .eq('order_id', order.id);

      if (!result2.error) {
        items = result2.data;
        itemsError = null;
      } else {
        itemsError = result2.error;
        items = result2.data ?? null;
      }
    }

    if (items && items.length > 0) break;
    if (itemAttempt < 2) {
      console.log(`[CART_GET] user_id=${user.id} order_id=${order.id} itemRows=0 itemAttempt=${itemAttempt + 1} retrying after 400ms`);
      await new Promise(r => setTimeout(r, 400));
    }
  }

  if (itemsError) {
    console.error(`[CART_GET] user_id=${user.id} order_id=${order.id} itemsError=${JSON.stringify(itemsError)}`);
  }

  console.log(`[CART_GET] user_id=${user.id} order_id=${order.id} itemRows=${items?.length ?? 0} itemsError=${itemsError?.message ?? "none"}`);

  const productUrls = (items || []).map((item: any) => item.product_url).filter(Boolean);
  const mediaLookup = await lookupCartItemMediaCounts(supabase, productUrls);

  const activeItems: any[] = [];
  const savedItems: any[] = [];
  let regularItemCount = 0, regularItemsBaseTotal = 0, regularItemsMarginTotal = 0, regularItemsSubtotal = 0, regularRequiresQuote = false;
  let vehicleCount = 0, vehicleBasePriceTotal = 0, vehicleMarginTotal = 0, vehicleShippingTotal = 0, vehicleTotalUsd = 0;
  let hasVehicleItems = false, allVehiclesQuoted = true, anyVehicleNoQuoteRequest = false;
  let vehiclesWithPendingQuotes: string[] = [];
  let pendingPriceConfirmations: string[] = [];
  let hasPendingPriceConfirmation = false;

  (items || []).forEach((item: any) => {
    const mediaInfo = mediaLookup.get(item.product_url);
    const formattedItem = formatItem(item, markupPercent, vehicleMarkupPercent, exchangeRate, settings.shippingRatePerKg, mediaInfo, settings.vehiclePricingTiers);
    if (item.is_saved_for_later) { savedItems.push(formattedItem); return; }
    activeItems.push(formattedItem);
    if (formattedItem.hasPendingPriceConfirmation) { hasPendingPriceConfirmation = true; pendingPriceConfirmations.push(item.id); }
    if (formattedItem.isVehicle) {
      vehicleCount++; hasVehicleItems = true;
      if (formattedItem.vehicleQuoteApplied) {
        vehicleBasePriceTotal += formattedItem.itemBaseTotalUsd; vehicleMarginTotal += formattedItem.itemMarginUsd;
        vehicleShippingTotal += formattedItem.itemShippingUsd; vehicleTotalUsd += formattedItem.itemTotalUsd;
      } else {
        allVehiclesQuoted = false;
        if (formattedItem.quoteStatus === 'NONE') anyVehicleNoQuoteRequest = true;
        vehiclesWithPendingQuotes.push(item.id);
        vehicleBasePriceTotal += formattedItem.itemBaseTotalUsd; vehicleMarginTotal += formattedItem.itemMarginUsd;
      }
    } else {
      regularItemCount += formattedItem.quantity;
      // Use RAW base price from DB, not the display-overridden basePriceUsd/itemBaseTotalUsd from formatItem
      regularItemsBaseTotal += round2(Number(item.base_price_usd || 0) * (formattedItem.quantity || 1));
      regularItemsMarginTotal += formattedItem.itemMarginUsd; regularItemsSubtotal += formattedItem.itemSubtotalUsd;
      if (formattedItem.requiresManualQuote) regularRequiresQuote = true;
    }
  });

  // Shipping was already correctly calculated per-item in formatItem.
  // Just accumulate from the formatted items — do NOT recalculate or mutate items here,
  // as formatItem's itemSubtotalUsd/itemTotalUsd already include the correct shipping.
  let regularShippingTotal = 0;
  activeItems.forEach((item: any) => {
    if (item.isVehicle) return;
    regularShippingTotal += item.itemShippingUsd || 0;
  });
  regularShippingTotal = round2(regularShippingTotal);

  const totalItemCount = regularItemCount + vehicleCount;
  const itemsBaseTotalUsd = round2(regularItemsBaseTotal + vehicleBasePriceTotal);
  const totalMarginUsd = round2(regularItemsMarginTotal + vehicleMarginTotal);
  const totalShippingUsd = round2(regularShippingTotal + vehicleShippingTotal);
  const grandTotalUsd = round2(itemsBaseTotalUsd + totalMarginUsd + totalShippingUsd);
  const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

  // With tiered auto-pricing, all vehicles are effectively "quoted" automatically
  let vehicleQuoteStatus: 'none' | 'pending' | 'quoted' = 'none';
  if (hasVehicleItems) { vehicleQuoteStatus = 'quoted'; allVehiclesQuoted = true; }

  const canProceedToPayment = !regularRequiresQuote && !hasPendingPriceConfirmation;

  const summary: Record<string, any> = {
    cartId: order.id, cartVersion: order.cart_version || 1, itemCount: totalItemCount,
    itemsTotalUsd: itemsBaseTotalUsd, markupFeeUsd: totalMarginUsd, shippingFeeUsd: totalShippingUsd,
    shippingStatus: regularRequiresQuote ? 'PENDING_QUOTE' : 'CALCULATED',
    totalUsd: grandTotalUsd, totalCdf: grandTotalCdf, exchangeRate,
    requiresManualQuote: regularRequiresQuote, savedItemCount: savedItems.length,
    hasVehicleItems, vehicleQuoteStatus, allVehiclesQuoted: true,
    vehiclesWithPendingQuotes: 0, canProceedToPayment,
    hasPendingPriceConfirmation, pendingPriceConfirmationCount: pendingPriceConfirmations.length,
    pendingPriceConfirmationItemIds: pendingPriceConfirmations,
    vehicleTotals: hasVehicleItems ? { basePriceUsd: vehicleBasePriceTotal, marginUsd: vehicleMarginTotal, shippingUsd: vehicleShippingTotal, totalUsd: vehicleTotalUsd } : null,
    generalMarkupPercent: markupPercent, vehicleMarkupPercent,
    effectiveMarkupPercent: (hasVehicleItems && regularItemCount === 0) ? vehicleMarkupPercent : markupPercent,
    markupPercent: (hasVehicleItems && regularItemCount === 0) ? vehicleMarkupPercent : markupPercent,
  };
  if (hasPendingPriceConfirmation) { summary.message = "Le prix d'un ou plusieurs articles est en attente de confirmation."; }
  
  summary.shipping_debug = {
    raw_shippingPercent: shippingPercent,
    shippingBaseFeeUsd, shippingRatePerKg, regularItemsBaseTotal, regularShippingTotal, vehicleShippingTotal,
    mode: 'weight_based_per_item',
    important_note: 'Shipping is calculated per-item in formatItem using weight-based categories. Use summary.shippingFeeUsd directly.',
  };

  return jsonResponse({ ok: true, activeItems, items: activeItems, savedItems, summary });
}

// ─── Action: add_item ─────────────────────────────────────

async function handleAddItem(req: Request, body: any): Promise<Response> {
  const correlationId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  const db = createAdminPostgrestClient();
  const { token, source: tokenSource } = await extractRequestToken(req);
  const hasAuthorizationHeader = !!req.headers.get("authorization") || !!req.headers.get("Authorization");

  let userId: string | null = null;
  if (token) {
    const result = await db.getUser(token);
    if (result.data?.user) {
      userId = (result.data.user as { id: string }).id;
      console.log(`[CART_ADD][${correlationId}] verifyUserSuccess=true user_id=${userId} tokenSource=${tokenSource ?? "none"} hasAuthorizationHeader=${hasAuthorizationHeader}`);
    } else {
      console.log(`[CART_ADD][${correlationId}] verifyUserSuccess=false tokenPresent=true tokenSource=${tokenSource ?? "none"} hasAuthorizationHeader=${hasAuthorizationHeader} downstreamStatus=200`);
      return jsonResponse({ ok: false, success: false, authenticated: false, code: "SESSION_EXPIRED", message: "Session expired. Please login again.", activeItems: [], savedItems: [] }, 200);
    }
  }
  const isGuest = userId === null;

  const { action: _a, ...addBody } = body;
  const rawImageUrl = addCartCoalesceImage(addBody);
  const coalescedImageUrl = addCartNormalizeImage(rawImageUrl, addBody.productUrl);
  addBody.productImageUrl = coalescedImageUrl ?? undefined;

  const validation = validateAddCartItemInput(addBody);
  if (validation.error) {
    console.log(`[CART_ADD][${correlationId}] verifyUserSuccess=${!isGuest} user_id=${userId ?? "guest"} deviceId=${String(addBody.deviceId ?? addBody.device_id ?? "none")} productId=${String(addBody.productUrl ?? addBody.product_url ?? "none")} quantity=${String(addBody.quantity ?? 1)} authPresent=${!!token} responseStatus=400 error=${validation.error}`);
    return errorResponse(validation.error, 400);
  }

  const { productUrl, productPrice, quantity, shippingItemTypeId, productTitle: inputTitle, productImageUrl: inputImageUrl } = validation.data;
  const deviceId = addBody.deviceId ?? addBody.device_id ?? null;
  const userEdited = addCartIsUserEdited(addBody);
  const isFixedPrice = addBody.isFixedPrice === true || addBody.is_fixed_price === true;
  console.log(`[CART_ADD][${correlationId}] endpoint=mobile-cart/add_item payload=${JSON.stringify({ productUrl, productPrice, quantity, shippingItemTypeId: shippingItemTypeId ?? null, deviceId: deviceId ?? null, isFixedPrice, priceEdited: userEdited })}`);
  console.log(`[CART_ADD][${correlationId}] user_id=${userId ?? "guest"} deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=${!!token} tokenSource=${tokenSource ?? "none"} hasAuthorizationHeader=${hasAuthorizationHeader}`);

  if (userEdited && isGuest) {
    console.log(`[CART_ADD][${correlationId}] user_id=guest deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=false responseStatus=200 error=AUTH_REQUIRED_FOR_MANUAL_PRICE`);
    return jsonResponse({ ok: false, authenticated: false, code: "AUTH_REQUIRED_FOR_MANUAL_PRICE", error: "Authentication required to submit modified prices.", activeItems: [], savedItems: [] }, 200);
  }

  const settingsResult = await cartDbGetSettings(db, correlationId);
  if (settingsResult.error || !settingsResult.data) {
    console.log(`[CART_ADD][${correlationId}] user_id=${userId ?? "guest"} deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=${!!token} responseStatus=500 error=SETTINGS_LOAD_FAILED`);
    return errorResponse("Failed to load settings", 500);
  }
  const settings = settingsResult.data;

  // BASE-FIRST PRICING: Extract the REAL raw base price from the provider,
  // store it, then apply all-inclusive fees (markup + shipping) on top.
  // This ensures prices are always fresh and accurate.
  let basePriceUsd = productPrice;
  let resolvedFromCatalog = false;
  let priceSource = 'auto'; // tracks how we resolved the base price

  const feesIncluded = addBody.feesIncluded === true || addBody.fees_included === true;
  const isAllInclusive = isFixedPrice || feesIncluded;
  let effectiveMarkup = isFixedPrice ? 0 : settings.markupPercent;
  const store = addCartDetectStore(productUrl);

  let productTitle = inputTitle ?? null;
  let productImageUrl = inputImageUrl ?? null;

  // STEP 1: Try to get LIVE base price from provider API (most accurate)
  if (!isFixedPrice && !isAllInclusive && !userEdited) {
    const liveResult = await fetchLiveBasePrice(productUrl, store, correlationId);
    if (liveResult && liveResult.basePriceUsd > 0) {
      basePriceUsd = liveResult.basePriceUsd;
      resolvedFromCatalog = true;
      priceSource = 'live_provider';
      console.log(`[CART_ADD][${correlationId}] LIVE base price resolved: $${basePriceUsd} (was sent $${productPrice})`);
      // Also use live title/image if we don't have them
      if (!productTitle && liveResult.title) productTitle = liveResult.title;
      if (!productImageUrl && liveResult.imageUrl) productImageUrl = liveResult.imageUrl;
    }
  }

  // STEP 2: If live lookup failed, try catalog_items with staleness guard
  if (!resolvedFromCatalog && !isFixedPrice && !isAllInclusive && !userEdited) {
    let providerProductId: string | null = null;
    if (store === 'AMAZON') {
      const asinMatch = productUrl.match(/(?:\/dp\/|\/gp\/(?:product|aw\/d)\/)([A-Z0-9]{10})/i);
      providerProductId = asinMatch ? asinMatch[1].toUpperCase() : null;
    } else if (store === 'EBAY') {
      const ebayMatch = productUrl.match(/\/itm\/(\d+)/);
      providerProductId = ebayMatch ? ebayMatch[1] : null;
    }
    if (providerProductId) {
      const catalogId = store === 'AMAZON' ? `amazon_${providerProductId}` : providerProductId;
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const adminDb = createClient(supabaseUrl, serviceKey);
        const { data: catalogItem } = await adminDb.from('catalog_items')
          .select('price_usd, price_updated_at, title, image_url')
          .eq('id', catalogId).maybeSingle();
        if (catalogItem?.price_usd && catalogItem.price_usd > 0) {
          // STALENESS GUARD: If price is >24h old, try scraping for fresh price
          const priceAgeHours = catalogItem.price_updated_at
            ? (Date.now() - new Date(catalogItem.price_updated_at).getTime()) / (1000 * 60 * 60)
            : Infinity;
          
          if (priceAgeHours > 24 && store === 'AMAZON' && providerProductId) {
            console.log(`[CART_ADD][${correlationId}] catalog price stale (${priceAgeHours.toFixed(1)}h), scraping fresh price for ${providerProductId}`);
            try {
              const scrapedPrice = await scrapeAmazonPriceForCart(providerProductId);
              if (scrapedPrice && scrapedPrice > 0) {
                basePriceUsd = scrapedPrice;
                resolvedFromCatalog = true;
                priceSource = 'scraped_fresh';
                console.log(`[CART_ADD][${correlationId}] scraped fresh price: $${scrapedPrice} (was $${catalogItem.price_usd})`);
                // Update catalog_items with fresh price (fire-and-forget)
                adminDb.from('catalog_items').update({
                  price_usd: scrapedPrice,
                  price_updated_at: new Date().toISOString(),
                }).eq('id', catalogId).then(() => {}).catch(() => {});
              } else {
                // Scrape failed — use cached price anyway
                basePriceUsd = catalogItem.price_usd;
                resolvedFromCatalog = true;
                priceSource = 'catalog_base';
                console.log(`[CART_ADD][${correlationId}] scrape failed, using stale catalog price: $${basePriceUsd}`);
              }
            } catch {
              basePriceUsd = catalogItem.price_usd;
              resolvedFromCatalog = true;
              priceSource = 'catalog_base';
            }
          } else {
            basePriceUsd = catalogItem.price_usd;
            resolvedFromCatalog = true;
            priceSource = 'catalog_base';
            console.log(`[CART_ADD][${correlationId}] catalog_items base price: $${basePriceUsd} (${priceAgeHours.toFixed(1)}h old)`);
          }
          if (!productTitle && catalogItem.title) productTitle = catalogItem.title;
          if (!productImageUrl && catalogItem.image_url) productImageUrl = catalogItem.image_url;
        }
      }
    }
  }

  // Scrape for missing title/image
  if (!productImageUrl || !productTitle) {
    const scraped = await scrapeProductInfo(productUrl, correlationId);
    if (!productImageUrl && scraped.imageUrl) productImageUrl = scraped.imageUrl;
    if (!productTitle && scraped.title) productTitle = scraped.title;
  }
  if (!productImageUrl) {
    const cached = await getImageFromCache(db, productUrl, correlationId);
    if (!productImageUrl && cached.imageUrl) productImageUrl = cached.imageUrl;
    if (!productTitle && cached.title) productTitle = cached.title;
  }

  let estWeightKg = 1, requiresManualQuote = false, isVehicleDetected = false;
  let finalShippingTypeId = shippingItemTypeId ?? null;
  if (shippingItemTypeId) {
    const typeResult = await getShippingType(db, shippingItemTypeId, correlationId);
    if (typeResult.data) estWeightKg = typeResult.data.estWeightKg;
  }

  const detection = determineShippingCategory({ title: productTitle || "", url: productUrl, store, existingCategory: null });
  let vehiclePricingResult: any = null;
  if (detection.category === "vehicle" && detection.requiresQuote) {
    isVehicleDetected = true;
    requiresManualQuote = false;
    finalShippingTypeId = null;
    const tiers = parseTiers(settings.vehiclePricingTiers);
    vehiclePricingResult = calculateVehicleFinalPrice(basePriceUsd, 'running', 'roro', tiers);
    effectiveMarkup = vehiclePricingResult.totalPercent;
  } else if (detection.category && detection.category !== "vehicle") {
    let refinedCategory = detection.category;
    if (detection.category === 'laptop_tablet') {
      const titleLower = (productTitle || "").toLowerCase();
      const isTablet = /\b(ipad|tablet|tablette|galaxy tab|fire tablet|surface go)\b/i.test(titleLower);
      refinedCategory = isTablet ? 'tablet' : 'laptop_tablet';
    }
    const catTypeResult = await getShippingTypeForCategory(db, refinedCategory, correlationId);
    if (catTypeResult.data) {
      finalShippingTypeId = catTypeResult.data.id;
      estWeightKg = catTypeResult.data.estWeightKg;
      requiresManualQuote = catTypeResult.data.requiresManualQuote;
    }
  }

  // STEP 3: If we still don't have a resolved base (live + catalog both failed),
  // reverse-calculate from the all-inclusive sent price as last resort
  let detectedCategoryData: { estWeightKg: number; flatShippingUsd: number | null; shippingBufferPercent: number; requiresManualQuote: boolean } | null = null;
  let shippingFeeUsd: number;

  if (isFixedPrice || isAllInclusive) {
    shippingFeeUsd = 0;
  } else if (isVehicleDetected) {
    shippingFeeUsd = 0;
  } else if (requiresManualQuote) {
    shippingFeeUsd = 0;
  } else {
    // Get category data for shipping calculation
    if (finalShippingTypeId && detection.category && detection.category !== "vehicle") {
      let refinedCat2 = detection.category;
      if (detection.category === 'laptop_tablet') {
        const titleLower2 = (productTitle || "").toLowerCase();
        const isTablet2 = /\b(ipad|tablet|tablette|galaxy tab|fire tablet|surface go)\b/i.test(titleLower2);
        refinedCat2 = isTablet2 ? 'tablet' : 'laptop_tablet';
      }
      const catRefetch = await getShippingTypeForCategory(db, refinedCat2, correlationId);
      if (catRefetch.data) {
        detectedCategoryData = catRefetch.data;
      }
    }

    if (!resolvedFromCatalog && detectedCategoryData) {
      // Last resort: reverse-calculate base from all-inclusive sent price
      const catInfo: ShippingCategoryInfo = {
        est_weight_kg: detectedCategoryData.estWeightKg,
        flat_shipping_usd: detectedCategoryData.flatShippingUsd,
        shipping_buffer_percent: detectedCategoryData.shippingBufferPercent,
        requires_manual_quote: detectedCategoryData.requiresManualQuote,
      };
      const shippingPerUnit = calculateWeightBasedShippingFee(catInfo, settings.shippingRatePerKg, 1);
      const markupRate = settings.markupPercent / 100;
      const derivedBase = cartRound2((productPrice - shippingPerUnit) / (1 + markupRate));
      if (derivedBase > 0) {
        basePriceUsd = derivedBase;
        resolvedFromCatalog = true;
        priceSource = 'reverse_calculated';
        console.log(`[CART_ADD][${correlationId}] reverseCalcBase=true sentPrice=${productPrice} shippingPerUnit=${shippingPerUnit} derivedBase=${derivedBase}`);
      }
    } else if (!resolvedFromCatalog) {
      // Legacy fallback reverse-calculation
      const normalizedPercent = settings.shippingPercent > 1 ? settings.shippingPercent / 100 : settings.shippingPercent;
      const markupRate = settings.markupPercent / 100;
      const derivedBase = cartRound2((productPrice - settings.shippingBaseFeeUsd) / (1 + markupRate + normalizedPercent));
      if (derivedBase > 0) {
        basePriceUsd = derivedBase;
        resolvedFromCatalog = true;
        priceSource = 'reverse_calculated';
        console.log(`[CART_ADD][${correlationId}] reverseCalcBaseLegacy=true sentPrice=${productPrice} derivedBase=${derivedBase}`);
      }
    }

    // Now calculate shipping from the resolved base price
    if (detectedCategoryData) {
      const catInfo: ShippingCategoryInfo = {
        est_weight_kg: detectedCategoryData.estWeightKg,
        flat_shipping_usd: detectedCategoryData.flatShippingUsd,
        shipping_buffer_percent: detectedCategoryData.shippingBufferPercent,
        requires_manual_quote: detectedCategoryData.requiresManualQuote,
      };
      shippingFeeUsd = calculateWeightBasedShippingFee(catInfo, settings.shippingRatePerKg, quantity);
    } else {
      const normalizedPercent = settings.shippingPercent > 1 ? settings.shippingPercent / 100 : settings.shippingPercent;
      shippingFeeUsd = calculateShippingFee(cartRound2(basePriceUsd * quantity), settings.shippingBaseFeeUsd, normalizedPercent, false);
    }
  }

  console.log(`[CART_ADD][${correlationId}] FINAL basePrice=$${basePriceUsd} priceSource=${priceSource} shippingFee=$${shippingFeeUsd} sentPrice=$${productPrice}`);

  // Recalculate pricing with the (potentially reverse-calculated) base price
  effectiveMarkup = isFixedPrice ? 0 : (isVehicleDetected ? 0 : settings.markupPercent);
  let pricing = cartPricingCalc(basePriceUsd, quantity, effectiveMarkup, settings.exchangeRate);

  if (isGuest) {
    const protectionOpts = { categoryKey: detectedCategoryData?.category ?? null, isVehicle: isVehicleDetected, requiresManualQuote };
    const response = buildItemResponse(null, productUrl, productTitle, productImageUrl, store, pricing, shippingFeeUsd, settings.exchangeRate, false, effectiveMarkup, settings.protection, protectionOpts);
    console.log(`[CART_ADD][${correlationId}] dbInsertAttempted=false user_id=guest deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=false responseStatus=200 isGuest=true`);
    return jsonResponse({ success: true, isGuest: true, item: response, isVehicle: isVehicleDetected, requiresQuote: requiresManualQuote });
  }

  const draftResult = await getOrCreateDraftOrder(db, userId!, correlationId);
  if (draftResult.error || !draftResult.data) {
    console.log(`[CART_ADD][${correlationId}] user_id=${userId} deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=true responseStatus=500 error=DRAFT_LOOKUP_FAILED dbError=${draftResult.error?.message ?? "none"}`);
    return errorResponse("Failed to get/create cart", 500);
  }
  const draft = draftResult.data;

  const existingResult = await findExistingCartItem(db, draft.id, productUrl, correlationId);
  let merged = false, itemId: string;

  if (existingResult.data) {
    const existingItem = existingResult.data;
    const newQuantity = existingItem.quantity + quantity;
    console.log(`[CART_ADD][${correlationId}] dbInsertAttempted=false dbUpdateAttempted=true orderId=${draft.id} existingItemId=${existingItem.id}`);
    const updateFields: Record<string, unknown> = {
      quantity: newQuantity, base_price_usd: basePriceUsd, product_image_url: productImageUrl,
      is_vehicle: isVehicleDetected || existingItem.is_vehicle,
      requires_manual_quote: false,
      updated_at: new Date().toISOString(),
      price_source: isFixedPrice ? "hot_product" : (isVehicleDetected ? "auto_vehicle_tiered" : priceSource),
      shipping_fee_usd: shippingFeeUsd,
      markup_fee_usd: pricing.itemMarginUsd,
      total_price_usd: cartRound2(pricing.itemSubtotalUsd + shippingFeeUsd),
      total_price_cdf: cartRound2(cartRound2(pricing.itemSubtotalUsd + shippingFeeUsd) * settings.exchangeRate),
    };
    // If vehicle, update pricing fields
    if (isVehicleDetected && vehiclePricingResult) {
      updateFields.markup_fee_usd = vehiclePricingResult.totalFeeUsd;
      updateFields.shipping_fee_usd = 0;
      updateFields.total_price_usd = vehiclePricingResult.finalPriceUsd;
      updateFields.total_price_cdf = cartRound2(vehiclePricingResult.finalPriceUsd * settings.exchangeRate);
      updateFields.vehicle_quote_applied = true;
      updateFields.price_source = 'auto_vehicle_tiered';
    }
    const updateResult = await updateCartItem(db, existingItem.id, updateFields, correlationId);
    if (updateResult.error || !updateResult.data) {
      console.log(`[CART_ADD][${correlationId}] user_id=${userId} deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=true responseStatus=500 error=ITEM_UPDATE_FAILED dbError=${updateResult.error?.message ?? "none"}`);
      return errorResponse("Failed to update cart item", 500);
    }
    itemId = existingItem.id; merged = true;
  } else {
    let providerProductId: string | null = null;
    if (store === 'AMAZON') {
      const asinMatch = productUrl.match(/(?:\/dp\/|\/gp\/(?:product|aw\/d)\/)([A-Z0-9]{10})/i);
      providerProductId = asinMatch ? asinMatch[1].toUpperCase() : null;
    } else if (store === 'EBAY') {
      const ebayMatch = productUrl.match(/\/itm\/(\d+)/);
      providerProductId = ebayMatch ? ebayMatch[1] : null;
    }
    let canonicalUrl = productUrl;
    if (store === 'AMAZON' && providerProductId) {
      const hasSlugged = /\/[^/]+\/dp\/[A-Z0-9]{10}/i.test(productUrl);
      if (hasSlugged) {
        canonicalUrl = productUrl;
      } else {
        const titleStr = (productTitle || '').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-').substring(0, 120);
        canonicalUrl = (titleStr.length > 2)
          ? `https://www.amazon.com/${titleStr}/dp/${providerProductId}`
          : `https://www.amazon.com/dp/${providerProductId}`;
      }
    }

    // For vehicles, use tiered pricing; for regular items, use standard pricing
    const isVehicleInsert = isVehicleDetected && vehiclePricingResult;
    const totalPriceUsd = isVehicleInsert
      ? vehiclePricingResult.finalPriceUsd
      : cartRound2(pricing.itemSubtotalUsd + shippingFeeUsd);
    const totalPriceCdf = cartRound2(totalPriceUsd * settings.exchangeRate);
    const newItem: Record<string, unknown> = {
      order_id: draft.id, product_url: productUrl, title: productTitle, product_image_url: productImageUrl,
      store, quantity, base_price_usd: basePriceUsd,
      unit_price_usd: cartRound2(basePriceUsd),
      subtotal_usd: pricing.itemBaseTotalUsd,
      markup_fee_usd: isFixedPrice ? 0 : (isVehicleInsert ? vehiclePricingResult.totalFeeUsd : pricing.itemMarginUsd),
      shipping_fee_usd: isFixedPrice ? 0 : (isVehicleInsert ? 0 : shippingFeeUsd),
      total_price_usd: isFixedPrice ? pricing.itemBaseTotalUsd : totalPriceUsd,
      total_price_cdf: isFixedPrice ? cartRound2(pricing.itemBaseTotalUsd * settings.exchangeRate) : totalPriceCdf,
      shipping_item_type_id: finalShippingTypeId,
      est_weight_kg: estWeightKg, is_vehicle: isVehicleDetected,
      requires_manual_quote: false, // Never requires manual quote now
      vehicle_quote_applied: isVehicleInsert ? true : false,
      is_saved_for_later: false,
      price_source: isFixedPrice ? "hot_product" : (isVehicleInsert ? "auto_vehicle_tiered" : priceSource),
      price_confirmation_status: userEdited ? "pending" : null,
      captured_price: userEdited ? (addBody.capturedPrice ?? addBody.captured_price ?? null) : null,
      provider_product_id: providerProductId,
      canonical_url: canonicalUrl,
    };
    console.log(`[CART_ADD][${correlationId}] dbInsertAttempted=true orderId=${draft.id} insertPayload=${JSON.stringify({ order_id: draft.id, product_url: productUrl, quantity, device_id: deviceId ?? null, user_id: userId, is_vehicle: isVehicleDetected, requires_manual_quote: false, price_source: newItem.price_source })}`);
    const insertResult = await insertCartItem(db, newItem, correlationId);
    if (insertResult.error || !insertResult.data) {
      console.log(`[CART_ADD][${correlationId}] user_id=${userId} deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=true responseStatus=500 error=ITEM_INSERT_FAILED dbError=${insertResult.error?.message ?? "none"}`);
      return errorResponse("Failed to add item to cart", 500);
    }
    itemId = insertResult.data.id;
  }

  try {
    const adminClient = createAdminClient();
    await sharedUpdateOrderTotals(adminClient, draft.id, settings.shippingBaseFeeUsd, settings.shippingPercent, settings.exchangeRate);
  } catch (e) { console.warn(`[CART_ADD] ${correlationId} Failed to update totals:`, (e as Error).message); }

  const protectionOpts = { categoryKey: detectedCategoryData?.category ?? null, isVehicle: isVehicleDetected, requiresManualQuote };
  const response = buildItemResponse(itemId, productUrl, productTitle, productImageUrl, store, pricing, shippingFeeUsd, settings.exchangeRate, merged, effectiveMarkup, settings.protection, protectionOpts);

  // Fire-and-forget: Log pricing protection audit
  try {
    const protection = (response as any).pricing_protection;
    if (protection) {
      const adminClient = createAdminClient();
      const auditEntry = buildAuditLogEntry(
        {
          sourceCostUsd: pricing.itemBaseTotalUsd,
          shippingUsedUsd: shippingFeeUsd,
          markupAppliedUsd: pricing.itemMarginUsd,
          paymentFeeEstimateUsd: 0, operationalBufferUsd: 0, exchangeBufferUsd: 0,
          riskBufferUsd: 0, emergencyBufferUsd: 0, minProfitFloorApplied: protection.min_profit_floor_applied,
          targetProfitUsd: 0, rawTotalUsd: 0,
          totalProtectionUsd: protection.total_protection_usd,
          safeFinalPriceUsd: Number(response.lineTotalUsd),
          safeFinalPriceCdf: Number(response.lineTotalCdf),
          profitUsd: protection.profit_usd, marginPercent: protection.margin_percent,
          pricingStatus: protection.status, pricingConfidence: protection.confidence,
          requiresManualReview: protection.requires_review, reasonCodes: protection.reason_codes,
          categoryKey: detectedCategoryData?.category ?? null,
        },
        draft.id, itemId, productUrl,
      );
      adminClient.from('pricing_audit_log').insert(auditEntry).then(({ error: auditErr }) => {
        if (auditErr) console.warn(`[CART_ADD] audit log failed: ${auditErr.message}`);
      });
    }
  } catch (e) { console.warn(`[CART_ADD] audit log error:`, (e as Error).message); }

  console.log(`[CART_ADD][${correlationId}] user_id=${userId} deviceId=${deviceId ?? "none"} productId=${productUrl} quantity=${quantity} authPresent=true responseStatus=200 orderId=${draft.id} itemId=${itemId} merged=${merged} elapsedMs=${Date.now() - startTime}`);
  return jsonResponse({ success: true, merged, isGuest: false, item: response, orderId: draft.id, isVehicle: isVehicleDetected, requiresQuote: requiresManualQuote });
}

// ─── Action: update_item ──────────────────────────────────

async function handleUpdateItem(req: Request, body: any): Promise<Response> {
  const { user, supabase } = await verifyAndGetUser(req);
  const itemId = body.item_id || body.itemId;
  if (!itemId) return errorResponse('Item ID is required', 400);

  const { action: _u, item_id: _i, itemId: _i2, ...updateBody } = body;

  // Coalesce image
  const coalescedImageUrl = (() => {
    const rawImageUrl = updateBody.productImageUrl ?? updateBody.image_url ?? updateBody.imageUrl ?? updateBody.product_image_url ?? 
      updateBody.thumbnail ?? updateBody.photo ?? updateBody.picture ?? updateBody.productImage ?? updateBody.image ?? null;
    const clientProductUrl = updateBody.productUrl ?? updateBody.product_url ?? null;
    return normalizeImageUrl(rawImageUrl, clientProductUrl);
  })();

  const { data: item, error: itemError } = await supabase
    .from('order_items')
    .select('id, base_price_usd, quantity, saved_at, price_confirmation_status, captured_price, product_image_url, product_url, title, orders!inner(user_id, status, id)')
    .eq('id', itemId).single();

  if (itemError || !item) return errorResponse('Item not found', 404);

  const orderData = item.orders as unknown as { user_id: string; status: string; id: string };
  if (orderData.user_id !== user.id) return errorResponse('Unauthorized', 403);
  if (orderData.status !== 'DRAFT') return errorResponse('Cannot update submitted order', 400);

  const orderId = orderData.id;
  const settings = await getCachedSettings(supabase);
  const { markupPercent, exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

  const updateData: Record<string, any> = {};
  if (coalescedImageUrl) updateData.product_image_url = coalescedImageUrl;
  
  const newTitle = updateBody.productTitle ?? updateBody.title ?? updateBody.product_title ?? null;
  if (newTitle && typeof newTitle === 'string' && newTitle.trim() !== '') updateData.title = newTitle.trim();

  const savedForLaterValue = updateBody.isSavedForLater ?? updateBody.is_saved_for_later;
  if (typeof savedForLaterValue === 'boolean') {
    updateData.is_saved_for_later = savedForLaterValue;
    updateData.saved_at = savedForLaterValue ? new Date().toISOString() : null;
  }

  if (typeof updateBody.quantity === 'number' && updateBody.quantity > 0) {
    const newQuantity = Math.floor(updateBody.quantity);
    const pricing = calculateItemPricing(item.base_price_usd, newQuantity, markupPercent, exchangeRate);
    updateData.quantity = newQuantity;
    updateData.subtotal_usd = pricing.itemBaseTotalUsd;
    updateData.markup_fee_usd = pricing.itemMarginUsd;
    updateData.total_price_usd = pricing.itemSubtotalUsd;
    updateData.total_price_cdf = pricing.itemSubtotalCdf;
  }

  const newPrice = updateBody.productPrice ?? updateBody.price ?? updateBody.base_price_usd;
  if (typeof newPrice === 'number' && newPrice > 0) {
    const quantity = updateBody.quantity ?? item.quantity ?? 1;
    const pricing = calculateItemPricing(newPrice, quantity, markupPercent, exchangeRate);
    updateData.base_price_usd = round2(newPrice); updateData.unit_price_usd = round2(newPrice);
    updateData.subtotal_usd = pricing.itemBaseTotalUsd; updateData.markup_fee_usd = pricing.itemMarginUsd;
    updateData.total_price_usd = pricing.itemSubtotalUsd; updateData.total_price_cdf = pricing.itemSubtotalCdf;
    
    const userEdited = isUserEditedPrice(updateBody);
    const capturedPrice = updateBody.capturedPrice ?? updateBody.captured_price ?? item.captured_price ?? null;
    const currency = updateBody.currency ?? 'USD';
    
    if (userEdited) {
      updateData.price_confirmation_status = 'PENDING'; updateData.price_source = 'manual_user';
      if (capturedPrice !== null) updateData.captured_price = capturedPrice;
      
      const { data: itemDetails } = await supabase.from('order_items').select('product_url, store, title, device_id').eq('id', itemId).single();
      const deviceId = updateBody.deviceId ?? updateBody.device_id ?? itemDetails?.device_id ?? null;
      
      const { data: priceConfirmation, error: pcError } = await supabase.from('price_confirmations').upsert({
        user_id: user.id, user_email: user.email || null, device_id: deviceId, cart_item_id: itemId,
        product_url: itemDetails?.product_url || '', store: (itemDetails?.store || 'OTHER').toUpperCase(),
        proposed_price: newPrice, proposed_currency: currency.toUpperCase(),
        extracted_price: capturedPrice, extracted_currency: capturedPrice ? currency.toUpperCase() : null,
        extraction_source: capturedPrice ? 'structured' : 'manual', extraction_confidence: capturedPrice ? 0.8 : null,
        status: 'PENDING', updated_at: new Date().toISOString(),
      }, { onConflict: 'cart_item_id', ignoreDuplicates: false }).select('id').single();
      
      if (pcError) return jsonResponse({ ok: false, code: 'PRICE_CONFIRMATION_INSERT_FAILED', error: pcError.message }, 500);
      updateData.price_confirmation_id = priceConfirmation.id;
      
      await supabase.from('admin_notifications').insert({
        type: 'PRICE_REVIEW', title: 'Price confirmation needed',
        body: `User updated price for cart item. Review required.`,
        payload: { cart_item_id: itemId, user_id: user.id, captured_price: capturedPrice, user_price: newPrice, currency, price_confirmation_id: priceConfirmation.id },
      });
    }
  }

  if (Object.keys(updateData).length === 0) return errorResponse('No valid fields to update.', 400);

  const { data: updatedItem, error: updateError } = await supabase.from('order_items').update(updateData).eq('id', itemId)
    .select('id, title, store, product_image_url, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf, is_saved_for_later, price_confirmation_status, price_source').single();

  if (updateError) return errorResponse('Failed to update item', 500);

  const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

  return jsonResponse({
    success: true,
    item: {
      id: updatedItem.id, title: updatedItem.title, store: updatedItem.store,
      imageUrl: updatedItem.product_image_url, basePriceUsd: updatedItem.base_price_usd,
      quantity: updatedItem.quantity, subtotalUsd: updatedItem.subtotal_usd,
      totalUsd: updatedItem.total_price_usd, totalCdf: updatedItem.total_price_cdf,
      isSavedForLater: updatedItem.is_saved_for_later || false,
      priceConfirmationStatus: updatedItem.price_confirmation_status, priceSource: updatedItem.price_source,
    },
    summary,
  });
}

// ─── Action: delete_item ──────────────────────────────────

async function handleDeleteItem(req: Request, body: any): Promise<Response> {
  const { user, supabase } = await verifyAndGetUser(req);
  const itemId = body.item_id || body.itemId || body.cart_item_id || body.cartItemId || body.id;
  console.log(`[CART_DELETE] rawKeys=${JSON.stringify(Object.keys(body))} resolvedItemId=${itemId ?? "none"}`);
  if (!itemId || typeof itemId !== 'string' || itemId.length < 10) {
    return jsonResponse({ success: false, code: 'INVALID_REQUEST', message: 'Valid item ID is required' }, 400);
  }

  const settings = await getCachedSettings(supabase);
  const { exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

  const { data: draftOrder } = await supabase.from('orders').select('id').eq('user_id', user.id).eq('status', 'DRAFT')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (!draftOrder) {
    return jsonResponse({ success: true, itemId, status: 'already_deleted', message: 'Item already removed (no active cart)',
      summary: { itemsTotal: 0, markupFeeUsd: 0, shippingFeeUsd: 0, totalUsd: 0, totalCdf: 0, exchangeRate, itemCount: 0 } });
  }

  const orderId = draftOrder.id;
  const { data: item } = await supabase.from('order_items').select('id').eq('id', itemId).eq('order_id', orderId).maybeSingle();

  if (!item) {
    const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);
    return jsonResponse({ success: true, itemId, status: 'already_deleted', message: 'Item already removed',
      summary: { itemsTotal: summary?.itemTotalUsd ?? 0, markupFeeUsd: summary?.serviceFeeUsd ?? 0, shippingFeeUsd: summary?.shippingFeeUsd ?? 0,
        totalUsd: summary?.totalUsd ?? 0, totalCdf: summary?.totalCdf ?? 0, exchangeRate: summary?.exchangeRate ?? exchangeRate, itemCount: summary?.activeItemCount ?? 0 } });
  }

  const { error: deleteError } = await supabase.from('order_items').delete().eq('id', itemId).eq('order_id', orderId);
  if (deleteError) return jsonResponse({ success: false, code: 'DB_ERROR', message: 'Failed to delete item' }, 500);

  try { await supabase.from('quote_requests').delete().eq('order_item_id', itemId); } catch { /* non-fatal */ }

  const summary = await updateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);
  return jsonResponse({ success: true, itemId, status: 'deleted',
    summary: { itemsTotal: summary?.itemTotalUsd ?? 0, markupFeeUsd: summary?.serviceFeeUsd ?? 0, shippingFeeUsd: summary?.shippingFeeUsd ?? 0,
      totalUsd: summary?.totalUsd ?? 0, totalCdf: summary?.totalCdf ?? 0, exchangeRate: summary?.exchangeRate ?? exchangeRate, itemCount: summary?.activeItemCount ?? 0 } });
}

// ─── Action: sync ─────────────────────────────────────────

async function handleSync(req: Request, body: any): Promise<Response> {
  const { z } = await import("https://deno.land/x/zod@v3.22.4/mod.ts");
  const { token, source: tokenSource } = await extractRequestToken(req);
  console.log(`[mobile-cart:sync] token=${!!token} source=${tokenSource}`);
  if (!token) return jsonResponse({ ok: false, success: false, authenticated: false, code: 'AUTH_REQUIRED', message: 'Authentication required. Please login to sync cart.', activeItems: [], savedItems: [] }, 200);

  const supabase = createAdminClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return jsonResponse({ ok: false, success: false, authenticated: false, code: 'SESSION_EXPIRED', message: 'Invalid or expired session. Please login again.', activeItems: [], savedItems: [] }, 200);

  const { action: _s, ...syncBody } = body;
  const items = syncBody.items;
  if (!items || !Array.isArray(items) || items.length === 0) return errorResponse('No items to sync', 400);

  const settings = await getCachedSettings(supabase);
  const { markupPercent, vehicleMarkupPercent, exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

  const { cartId, created } = await getOrCreateSingleDraftOrder(supabase, user.id, exchangeRate);

  const { data: existingItems } = await supabase.from('order_items').select('id, product_url, is_vehicle, vehicle_quote_applied').eq('order_id', cartId);
  const existingItemsByNormalizedUrl = new Map<string, { id: string; hasQuote: boolean }>();
  (existingItems || []).forEach((item: any) => {
    const normalizedUrl = normalizeProductUrl(item.product_url);
    const existing = existingItemsByNormalizedUrl.get(normalizedUrl);
    if (!existing || (item.vehicle_quote_applied && !existing.hasQuote)) {
      existingItemsByNormalizedUrl.set(normalizedUrl, { id: item.id, hasQuote: item.vehicle_quote_applied === true });
    }
  });

  const syncedItems: any[] = [];
  for (const item of items) {
    const store = item.store?.toUpperCase() || cartDetectStore(item.productUrl);
    const vehicleDetection = determineShippingCategory({ title: item.title || "", url: item.productUrl, store, existingCategory: null });
    const isVehicle = vehicleDetection.category === "vehicle" && vehicleDetection.requiresQuote;

    const meta = item.meta || {};
    const priceSourceTop = String(item.price_source ?? item.priceSource ?? "").toLowerCase();
    const priceSourceMeta = String(meta.price_source ?? meta.priceSource ?? "").toLowerCase();
    const isManualSource = ["manual_user", "manual"].includes(priceSourceTop) || ["manual_user", "manual"].includes(priceSourceMeta);
    const confirmStatus = String(item.price_confirmation_status ?? item.priceConfirmationStatus ?? meta.price_confirmation_status ?? meta.priceConfirmationStatus ?? "").toLowerCase();
    const priceEditedFlag = item.priceEdited === true || String(item.priceEdited ?? "").toLowerCase() === "true" || item.manual_price === true || String(item.manual_price ?? "").toLowerCase() === "true" || meta.priceEdited === true;
    const capturedPrice = item.captured_price_usd ?? item.capturedPriceUsd ?? meta.capturedPrice ?? meta.capturedPriceUsd ?? null;
    const hasPriceDifference = capturedPrice !== null && Math.abs(item.unitPrice - Number(capturedPrice)) > 0.01;
    const priceEdited = isManualSource || confirmStatus === "pending" || priceEditedFlag || meta.originalPriceUsd !== undefined || hasPriceDifference;

    const pricing = calculateItemPricing(item.unitPrice, item.quantity, markupPercent, exchangeRate, isVehicle, vehicleMarkupPercent);
    const { imageUrl: resolvedImageUrl } = coalesceImageUrl(item);

    const cleanProductUrl = canonicalizeProductUrl(item.productUrl);
    // Extract provider product ID and canonical URL for all order paths
    let syncProviderProductId: string | null = null;
    if (store === 'AMAZON') {
      const asinMatch = item.productUrl.match(/(?:\/dp\/|\/gp\/(?:product|aw\/d)\/)([A-Z0-9]{10})/i);
      syncProviderProductId = asinMatch ? asinMatch[1].toUpperCase() : null;
    } else if (store === 'EBAY') {
      const ebayMatch = item.productUrl.match(/\/itm\/(\d+)/);
      syncProviderProductId = ebayMatch ? ebayMatch[1] : null;
    }
    let syncCanonicalUrl = cleanProductUrl;
    if (store === 'AMAZON' && syncProviderProductId) {
      const hasSlugged = /\/[^/]+\/dp\/[A-Z0-9]{10}/i.test(cleanProductUrl);
      if (hasSlugged) {
        syncCanonicalUrl = cleanProductUrl;
      } else {
        const titleStr = (item.title || '').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-').substring(0, 120);
        syncCanonicalUrl = (titleStr.length > 2)
          ? `https://www.amazon.com/${titleStr}/dp/${syncProviderProductId}`
          : `https://www.amazon.com/dp/${syncProviderProductId}`;
      }
    }

    const itemData: Record<string, any> = {
      order_id: cartId, product_url: cleanProductUrl, title: item.title || null,
      product_image_url: resolvedImageUrl, store, base_price_usd: pricing.basePriceUsd,
      unit_price_usd: pricing.basePriceUsd, quantity: pricing.quantity,
      subtotal_usd: pricing.itemBaseTotalUsd, markup_fee_usd: pricing.itemMarginUsd,
      total_price_usd: pricing.itemSubtotalUsd, total_price_cdf: pricing.itemSubtotalCdf,
      est_weight_kg: 1, is_saved_for_later: false, is_vehicle: isVehicle, requires_manual_quote: isVehicle,
      provider_product_id: syncProviderProductId,
      canonical_url: syncCanonicalUrl,
    };

    if (priceEdited) {
      itemData.price_confirmation_status = 'PENDING';
      const { data: pc, error: pcError } = await supabase.from('price_confirmations').insert({
        user_id: user.id, product_url: item.productUrl, store,
        proposed_price: item.unitPrice, proposed_currency: (item.currency || 'USD').toUpperCase(),
        extracted_price: capturedPrice, extracted_currency: capturedPrice ? (item.currency || 'USD').toUpperCase() : null,
        extraction_source: capturedPrice ? 'structured' : 'manual', extraction_confidence: capturedPrice ? 0.8 : null, status: 'PENDING',
      }).select('id').single();
      if (!pcError && pc) { itemData.price_confirmation_id = pc.id; }
      await supabase.from('admin_notifications').insert({
        type: 'PRICE_REVIEW', title: 'Price Review Required',
        body: `User submitted manual price: $${item.unitPrice.toFixed(2)} for ${item.title || item.productUrl}`,
        payload: { user_id: user.id, product_url: item.productUrl, title: item.title, captured_price: capturedPrice, user_price: item.unitPrice, currency: item.currency || 'USD', price_confirmation_id: pc?.id },
      });
    }

    const normalizedUrl = normalizeProductUrl(item.productUrl);
    const existingItem = existingItemsByNormalizedUrl.get(normalizedUrl);

    if (existingItem) {
      if (existingItem.hasQuote) {
        const { data: existing } = await supabase.from('order_items').select('id, product_url, title, product_image_url, store, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf').eq('id', existingItem.id).single();
        if (existing) syncedItems.push(existing);
        continue;
      }
      const { data: updated, error: updateError } = await supabase.from('order_items').update(itemData).eq('id', existingItem.id)
        .select('id, product_url, title, product_image_url, store, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf').single();
      if (!updateError && updated) syncedItems.push(updated);
    } else {
      const { data: inserted, error: insertError } = await supabase.from('order_items').insert(itemData)
        .select('id, product_url, title, product_image_url, store, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf').single();
      if (!insertError && inserted) { syncedItems.push(inserted); existingItemsByNormalizedUrl.set(normalizedUrl, { id: inserted.id, hasQuote: false }); }
    }
  }

  const totals = await updateOrderTotals(supabase, cartId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

  return jsonResponse({
    success: true, cartId,
    cart: {
      id: cartId, userId: user.id, status: 'DRAFT',
      items: syncedItems.map((item: any) => ({
        id: item.id, productUrl: item.product_url, title: item.title, imageUrl: item.product_image_url,
        store: item.store, unitPrice: Number(item.base_price_usd), quantity: item.quantity,
        subtotal: Number(item.subtotal_usd), markupFee: Number(item.markup_fee_usd),
        totalUsd: Number(item.total_price_usd), totalCdf: Number(item.total_price_cdf),
      })),
      totals: totals ? { itemsTotal: totals.itemTotalUsd, markupFee: totals.serviceFeeUsd, shippingFee: totals.shippingFeeUsd,
        totalUsd: totals.totalUsd, totalCdf: totals.totalCdf, exchangeRate: totals.exchangeRate, requiresManualQuote: totals.requiresManualQuote } : null,
    },
  });
}

// ─── Action: merge_guest ──────────────────────────────────

async function handleMergeGuest(req: Request, body: any): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, code: 'CONFIG_ERROR', message: 'Server configuration error' }, 500);

  const { token: mergeToken, source: mergeTokenSource } = await extractRequestToken(req);
  console.log(`[mobile-cart:merge_guest] token=${!!mergeToken} source=${mergeTokenSource}`);
  if (!mergeToken) return jsonResponse({ ok: false, success: false, authenticated: false, code: 'AUTH_REQUIRED', message: 'Authentication required to merge cart', activeItems: [], savedItems: [] }, 200);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(mergeToken);
  if (authError || !user) return jsonResponse({ ok: false, success: false, authenticated: false, code: 'SESSION_EXPIRED', message: 'Invalid or expired session', activeItems: [], savedItems: [] }, 200);

  const { action: _m, ...mergeBody } = body;
  const guestItems = mergeBody.guest_items || [];
  const guestDeviceId = mergeBody.guest_device_id;
  const idempotencyKey = mergeBody.idempotency_key;

  if (idempotencyKey) {
    const { data: rateCheck } = await supabase.rpc('check_rate_limit', { p_key: `merge_cart:${user.id}:${idempotencyKey}`, p_limit: 1, p_window_minutes: 60 });
    if (rateCheck && !rateCheck.allowed) {
      const { data: existingOrder } = await supabase.from('orders').select('id, total_usd, total_cdf, item_total_usd, shipping_fee_usd, requires_manual_quote')
        .eq('user_id', user.id).eq('status', 'DRAFT').order('created_at', { ascending: false }).limit(1).single();
      return jsonResponse({ success: true, idempotent: true, merged_count: 0, skipped_count: guestItems.length, cart_id: existingOrder?.id || null,
        totals: existingOrder ? { item_total_usd: existingOrder.item_total_usd, shipping_fee_usd: existingOrder.shipping_fee_usd, total_usd: existingOrder.total_usd, total_cdf: existingOrder.total_cdf, requires_manual_quote: existingOrder.requires_manual_quote } : null,
        message: 'Request already processed (idempotent)', requestId });
    }
  }

  if (!guestItems.length) return jsonResponse({ success: true, merged_count: 0, message: 'No items to merge', requestId });

  const { getCachedGlobalSettings } = await import("../_shared/settingsMemoryCache.ts");
  const settings = await getCachedGlobalSettings(supabase) as Record<string, any>;
  const markupPercent = Number(settings?.markup_percent) || 15;
  const exchangeRate = Number(settings?.exchange_rate_usd_to_cdf) || 2500;
  const shippingBaseFee = Number(settings?.shipping_base_fee_usd) || 10;
  const rawShippingPercent = Number(settings?.shipping_percent) || 0.10;
  const shippingPercent = rawShippingPercent > 1 ? rawShippingPercent / 100 : rawShippingPercent;

  let { data: draftOrder } = await supabase.from('orders').select('id, cart_version').eq('user_id', user.id).eq('status', 'DRAFT')
    .order('created_at', { ascending: false }).limit(1).single();

  // RACE CONDITION FIX: If no DRAFT exists, check for a recent PENDING_PAYMENT order
  // before creating a new one. This prevents duplicates when cart sync runs right after
  // checkout converts the DRAFT → PENDING_PAYMENT.
  if (!draftOrder) {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: pendingOrder } = await supabase.from('orders').select('id, cart_version')
      .eq('user_id', user.id).eq('status', 'PENDING_PAYMENT')
      .gte('updated_at', thirtyMinutesAgo)
      .order('updated_at', { ascending: false }).limit(1).single();
    
    if (pendingOrder) {
      console.log(`[MERGE_GUEST] Reusing recent PENDING_PAYMENT order: ${pendingOrder.id}`);
      draftOrder = pendingOrder;
    }
  }

  if (!draftOrder) {
    const { data: newOrder, error: createError } = await supabase.from('orders').insert({ user_id: user.id, status: 'DRAFT', cart_version: 1, exchange_rate_used: exchangeRate })
      .select('id, cart_version').single();
    if (createError) return jsonResponse({ success: false, code: 'CREATE_ORDER_FAILED', message: 'Failed to create cart' }, 500);
    draftOrder = newOrder;
  }

  const { data: existingItems } = await supabase.from('order_items').select('id, product_url, vehicle_quote_applied').eq('order_id', draftOrder!.id);
  const existingByUrl = new Map<string, { id: string; hasQuote: boolean }>();
  (existingItems || []).forEach((item: any) => {
    const normalizedUrl = normalizeProductUrl(item.product_url);
    existingByUrl.set(normalizedUrl, { id: item.id, hasQuote: item.vehicle_quote_applied === true });
  });

  const seenNormalizedUrls = new Set<string>();
  const dedupedGuestItems = guestItems.filter((item: any) => {
    if (!item.productUrl) return false;
    const normalized = normalizeProductUrl(item.productUrl);
    if (seenNormalizedUrls.has(normalized)) return false;
    seenNormalizedUrls.add(normalized);
    return true;
  });

  let mergedCount = 0, skippedCount = 0;
  for (const guestItem of dedupedGuestItems) {
    if (!guestItem.productUrl || guestItem.unitPrice <= 0) { skippedCount++; continue; }
    const normalizedUrl = normalizeProductUrl(guestItem.productUrl);
    const existingItem = existingByUrl.get(normalizedUrl);
    if (existingItem?.hasQuote) { skippedCount++; continue; }

    const store = guestItem.store?.toUpperCase() || cartDetectStore(guestItem.productUrl);
    const isVehicleDetected = isVehicleItem(guestItem.productUrl, store);
    const quantity = Math.max(1, Math.min(100, guestItem.quantity || 1));
    const basePrice = Math.round(guestItem.unitPrice * 100) / 100;
    const baseTotalUsd = Math.round(basePrice * quantity * 100) / 100;
    const marginUsd = Math.round(baseTotalUsd * (markupPercent / 100) * 100) / 100;
    const subtotalUsd = Math.round((baseTotalUsd + marginUsd) * 100) / 100;
    const subtotalCdf = Math.round(subtotalUsd * exchangeRate);

    const cleanGuestUrl = canonicalizeProductUrl(guestItem.productUrl);
    // Extract provider product ID and canonical URL for guest merge path
    let guestProviderProductId: string | null = null;
    if (store === 'AMAZON') {
      const asinMatch = guestItem.productUrl.match(/(?:\/dp\/|\/gp\/(?:product|aw\/d)\/)([A-Z0-9]{10})/i);
      guestProviderProductId = asinMatch ? asinMatch[1].toUpperCase() : null;
    } else if (store === 'EBAY') {
      const ebayMatch = guestItem.productUrl.match(/\/itm\/(\d+)/);
      guestProviderProductId = ebayMatch ? ebayMatch[1] : null;
    }
    let guestCanonicalUrl = cleanGuestUrl;
    if (store === 'AMAZON' && guestProviderProductId) {
      const hasSlugged = /\/[^/]+\/dp\/[A-Z0-9]{10}/i.test(cleanGuestUrl);
      if (hasSlugged) {
        guestCanonicalUrl = cleanGuestUrl;
      } else {
        const titleStr = (guestItem.title || '').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-').substring(0, 120);
        guestCanonicalUrl = (titleStr.length > 2)
          ? `https://www.amazon.com/${titleStr}/dp/${guestProviderProductId}`
          : `https://www.amazon.com/dp/${guestProviderProductId}`;
      }
    }

    const itemData = {
      order_id: draftOrder!.id, product_url: cleanGuestUrl, title: guestItem.title || null,
      product_image_url: guestItem.imageUrl || null, store, base_price_usd: basePrice, unit_price_usd: basePrice,
      quantity, subtotal_usd: baseTotalUsd, markup_fee_usd: marginUsd,
      total_price_usd: subtotalUsd, total_price_cdf: subtotalCdf,
      is_vehicle: isVehicleDetected, requires_manual_quote: isVehicleDetected, is_saved_for_later: false,
      provider_product_id: guestProviderProductId,
      canonical_url: guestCanonicalUrl,
    };

    if (existingItem) {
      const { error } = await supabase.from('order_items').update(itemData).eq('id', existingItem.id);
      if (!error) mergedCount++;
    } else {
      const { data: insertedItem, error } = await supabase.from('order_items').insert(itemData).select('id').single();
      if (!error) { mergedCount++; existingByUrl.set(normalizedUrl, { id: insertedItem.id, hasQuote: false }); }
    }
  }

  // Recalculate totals
  const { data: allItems } = await supabase.from('order_items').select('subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf, requires_manual_quote')
    .eq('order_id', draftOrder!.id).eq('is_saved_for_later', false);
  let itemTotalUsd = 0, totalMarginUsd = 0, totalUsd = 0, totalCdf = 0, requiresManualQuote = false;
  (allItems || []).forEach((item: any) => {
    itemTotalUsd += Number(item.subtotal_usd) || 0; totalMarginUsd += Number(item.markup_fee_usd) || 0;
    totalUsd += Number(item.total_price_usd) || 0; totalCdf += Number(item.total_price_cdf) || 0;
    if (item.requires_manual_quote) requiresManualQuote = true;
  });
  const shippingFeeUsd = Math.round((shippingBaseFee + (itemTotalUsd * shippingPercent)) * 100) / 100;
  const grandTotalUsd = Math.round((totalUsd + shippingFeeUsd) * 100) / 100;
  const grandTotalCdf = Math.round(grandTotalUsd * exchangeRate);
  await supabase.from('orders').update({
    item_total_usd: itemTotalUsd, service_fee_usd: totalMarginUsd, shipping_fee_usd: shippingFeeUsd,
    total_usd: grandTotalUsd, total_cdf: grandTotalCdf, exchange_rate_used: exchangeRate,
    requires_manual_quote: requiresManualQuote, cart_version: (draftOrder!.cart_version || 0) + 1, updated_at: new Date().toISOString(),
  }).eq('id', draftOrder!.id);

  return jsonResponse({
    success: true, merged_count: mergedCount, skipped_count: skippedCount,
    deduped_from: guestItems.length, deduped_to: dedupedGuestItems.length,
    cart_id: draftOrder!.id,
    totals: { item_total_usd: itemTotalUsd, shipping_fee_usd: shippingFeeUsd, total_usd: grandTotalUsd, total_cdf: grandTotalCdf, requires_manual_quote: requiresManualQuote },
    message: mergedCount > 0 ? `Successfully merged ${mergedCount} item(s) into your cart` : 'All items already in cart', requestId,
  });
}

// ─── Action: guest_snapshot ───────────────────────────────

async function handleGuestSnapshot(body: any): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, code: 'CONFIG_ERROR', message: 'Server configuration error' }, 500);

  const { action: _g, ...snapshotBody } = body;
  const { device_id, cart } = snapshotBody;
  if (!device_id || typeof device_id !== 'string' || device_id.trim() === '') return jsonResponse({ success: false, code: 'INVALID_DEVICE_ID', message: 'device_id is required' }, 400);
  if (!Array.isArray(cart)) return jsonResponse({ success: false, code: 'INVALID_CART', message: 'cart must be an array' }, 400);

  const sanitizedDeviceId = device_id.trim().substring(0, 255);
  const sanitizedCart = cart.slice(0, 100).map((item: any) => ({
    productUrl: (item.productUrl || '').substring(0, 2000), title: item.title ? item.title.substring(0, 500) : null,
    imageUrl: item.imageUrl ? item.imageUrl.substring(0, 2000) : null, store: item.store ? item.store.substring(0, 50) : null,
    unitPrice: typeof item.unitPrice === 'number' ? Math.max(0, item.unitPrice) : 0,
    quantity: typeof item.quantity === 'number' ? Math.max(1, Math.min(100, item.quantity)) : 1,
    currency: item.currency ? item.currency.substring(0, 10) : 'USD',
  })).filter((item: any) => item.productUrl && item.unitPrice > 0);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error: upsertError } = await supabase.from('guest_cart_snapshots').upsert({ device_id: sanitizedDeviceId, cart_json: sanitizedCart, updated_at: new Date().toISOString() }, { onConflict: 'device_id' });
  if (upsertError) return jsonResponse({ success: false, code: 'DB_ERROR', message: 'Failed to save cart snapshot' }, 500);

  return jsonResponse({ success: true, message: 'Cart snapshot saved', item_count: sanitizedCart.length, requestId });
}

// ─── Router ───────────────────────────────────────────────

const PUBLIC_ACTIONS = new Set(['guest_snapshot']);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let action = 'get_cart';
    let body: any = {};

    if (req.method === 'GET') {
      action = 'get_cart';
    } else {
      try { body = await req.json(); action = body.action || 'get_cart'; }
      catch { return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400); }
    }

    console.log(`[mobile-cart] action=${action}`);

    switch (action) {
      case 'get_cart': return await handleGetCart(req);
      case 'add_item': return await handleAddItem(req, body);
      case 'update_item': return await handleUpdateItem(req, body);
      case 'delete_item': return await handleDeleteItem(req, body);
      case 'sync': return await handleSync(req, body);
      case 'merge_guest': return await handleMergeGuest(req, body);
      case 'guest_snapshot': return await handleGuestSnapshot(body);
      default: return jsonResponse({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mobile-cart] Error:', msg);
    if ((error as any)?.name === 'AuthError') {
      return jsonResponse({ ok: false, authenticated: false, code: 'SESSION_EXPIRED', message: msg, activeItems: [], savedItems: [] }, 200);
    }
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
