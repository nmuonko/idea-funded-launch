import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { 
  normalizeSectionTitles, 
  getResponseLanguage, 
  calculateTotalItems,
  CACHE_SCHEMA_VERSION,
  TITLE_MAP,
  nonEmpty
} from "../_shared/titleNormalizer.ts";
import { buildStrictMobileSections, type SectionItem } from "../_shared/sectionProfiles.ts";
import { sanitizeImageUrl, bestProductImage } from "../_shared/imageValidator.ts";
import { serveMobileSections, emptyMobileSectionsResponse } from "../_shared/mobileSectionsCache.ts";
import { loadPricingSettings, applyAllInclusivePricingToItems } from "../_shared/allInclusivePricing.ts";
import {
  readMobileCache,
  readWebCache,
  buildMobileHomepage,
  buildWebHomepage,
  writeMobileCache,
  writeWebCache,
  loadRefreshSettings,
} from "../_shared/homeRecipeBuilder.ts";

/**
 * catalog-home - Single unified homepage feed with cache-first loading
 * 
 * PRODUCTION HOTFIX: This function is designed to NEVER fail:
 * - Always returns HTTP 200 with proper CORS
 * - Uses 3-tier fallback: Cache → Stale Cache → DB Bootstrap
 * - Mobile ALWAYS gets ok:true with 8 sections to prevent "Catalogue Indisponible"
 * - Title normalization runs RIGHT BEFORE returning to guarantee no empty titles
 * - Cache schema versioning ignores old cached rows with empty titles
 * 
 * Web: Single "featured" section (1000 items, paged at 100)
 * Mobile: 8 sections with localized titles (phones, electronics, vehicles, etc.)
 * 
 * Cache TTL is admin-controlled via admin_settings table.
 */

import { buildCorsHeaders, corsPreflightResponse, logStartupRequest } from "../_shared/mobileCors.ts";

// Dynamic CORS headers — built per-request to echo Access-Control-Request-Headers
// We keep a static fallback for non-preflight requests
const staticCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-afrishop-client, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type, x-correlation-id, x-env-used",
};

// Keep backward compat: corsHeaders used throughout the file
const corsHeaders = staticCorsHeaders;

function isEbayClothingItem(item: Record<string, unknown>): boolean {
  const provider = String(item.provider || "").toLowerCase();
  if (provider !== "ebay") return false;

  const category = String(item.unified_category || item.category || item.category_key || "").toLowerCase();
  const segment = String(item.segment || item._recipeKey || "").toLowerCase();
  const title = String(item.title || "").toLowerCase();

  if (category.includes("clothing") || segment.includes("clothing") || segment === "fashion") return true;
  return /\b(shirt|t-shirt|hoodie|jacket|coat|pants|jeans|dress|skirt|shoes|sneakers|boots|sandals)\b/i.test(title);
}

function withoutEbayClothing<T extends Record<string, unknown>>(items: T[]): T[] {
  return items.filter(item => !isEbayClothingItem(item));
}

// ===== CLIENT DETECTION =====
type ClientType = "mobile" | "web";

interface DetectionResult {
  clientType: ClientType;
  detectedBy: string;
}

/**
 * Detect if client is mobile (React Native / Expo) or web
 * AGGRESSIVE: If it doesn't look like a browser, assume mobile
 * This ensures mobile app NEVER gets web response format
 */
function detectClientType(req: Request): DetectionResult {
  const h = req.headers;
  const url = new URL(req.url);
  
  // PRIORITY 0: Explicit ?client=mobile or ?client=web query param
  const clientParam = url.searchParams.get("client")?.toLowerCase() || "";
  if (clientParam === "mobile") {
    return { clientType: "mobile", detectedBy: "query-param" };
  }
  if (clientParam === "web") {
    return { clientType: "web", detectedBy: "query-param-web" };
  }
  
  // PRIORITY 1: x-device-id header (mobile app should send this)
  const deviceId = h.get("x-device-id") || h.get("X-Device-Id") || "";
  if (deviceId && deviceId.trim().length > 0) {
    return { clientType: "mobile", detectedBy: "x-device-id" };
  }
  
  // PRIORITY 2: Platform header
  const platform = (h.get("x-supabase-client-platform") || h.get("X-Supabase-Client-Platform") || "").toLowerCase();
  if (platform.includes("android") || platform.includes("ios")) {
    return { clientType: "mobile", detectedBy: "platform" };
  }
  
  // PRIORITY 3: User-Agent - check for mobile patterns
  const userAgent = (h.get("user-agent") || "").toLowerCase();
  if (userAgent.includes("okhttp")) {
    return { clientType: "mobile", detectedBy: "ua-okhttp" };
  }
  if (userAgent.includes("expo")) {
    return { clientType: "mobile", detectedBy: "ua-expo" };
  }
  if (userAgent.includes("reactnative") || userAgent.includes("react-native")) {
    return { clientType: "mobile", detectedBy: "ua-reactnative" };
  }
  if (userAgent.includes("dart") || userAgent.includes("flutter")) {
    return { clientType: "mobile", detectedBy: "ua-flutter" };
  }
  
  // PRIORITY 4: Client info headers
  const clientInfo = (
    h.get("x-supabase-client-info") || 
    h.get("X-Supabase-Client-Info") || 
    h.get("x-client-info") ||
    h.get("X-Client-Info") ||
    ""
  ).toLowerCase();
  if (clientInfo.includes("expo") || clientInfo.includes("react-native") || clientInfo.includes("reactnative") || clientInfo.includes("supabase-flutter")) {
    return { clientType: "mobile", detectedBy: "client-info" };
  }
  
  // PRIORITY 5: AfriShop client header
  const afrishopClient = (h.get("x-afrishop-client") || h.get("X-Afrishop-Client") || "").toLowerCase();
  if (afrishopClient.includes("mobile")) {
    return { clientType: "mobile", detectedBy: "afrishop-client" };
  }
  
  // PRIORITY 6: AGGRESSIVE - If User-Agent doesn't contain typical browser signatures, assume mobile
  // Browsers always send: Mozilla, Chrome, Safari, Firefox, Edge, Opera, etc.
  const isBrowserUA = userAgent.includes("mozilla") || 
                      userAgent.includes("chrome") || 
                      userAgent.includes("safari") || 
                      userAgent.includes("firefox") || 
                      userAgent.includes("edge") ||
                      userAgent.includes("opera") ||
                      userAgent.includes("webkit");
  
  if (!isBrowserUA && userAgent.length > 0) {
    return { clientType: "mobile", detectedBy: "non-browser-ua" };
  }
  
  // PRIORITY 7: Check for mobile device in UA (Android/iOS browsers)
  if (userAgent.includes("android") || userAgent.includes("iphone") || userAgent.includes("ipad")) {
    // This is a mobile browser - but for catalog, still return mobile format
    // since mobile browsers on phones should get the app-like experience
    return { clientType: "mobile", detectedBy: "mobile-browser" };
  }
  
  // Default: Web (only if it's clearly a desktop browser)
  return { clientType: "web", detectedBy: "browser" };
}

// Mobile section definitions for sectioned experience
interface MobileSection {
  key: string;
  title_fr: string;
  title_en: string;
  keywords: string[];
  target: number;
}

// EXACT SECTIONS EXPECTED BY MOBILE APP - DO NOT CHANGE KEYS/TITLES
const MOBILE_SECTIONS: MobileSection[] = [
  { key: "phones", title_fr: "Téléphones", title_en: "Phones", keywords: ["iphone", "samsung", "galaxy", "pixel", "phone", "smartphone", "android", "mobile", "unlocked"], target: 20 },
  { key: "electronics", title_fr: "Électronique", title_en: "Electronics", keywords: ["airpods", "headphones", "earbuds", "speaker", "tv", "camera", "tablet", "laptop", "audio", "bluetooth", "charger", "monitor"], target: 20 },
  { key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", keywords: ["toyota", "honda", "bmw", "ford", "mercedes", "car", "truck", "suv", "vehicle", "auto", "motorcycle"], target: 20 },
  { key: "video_games", title_fr: "Jeux Vidéo", title_en: "Video Games", keywords: ["ps5", "xbox", "nintendo", "switch", "playstation", "console", "controller", "gaming", "game"], target: 20 },
  { key: "clothing_fashion", title_fr: "Vêtements et Mode", title_en: "Clothing & Fashion", keywords: ["nike", "adidas", "jordan", "shoes", "sneakers", "jacket", "hoodie", "dress", "jeans", "shirt"], target: 20 },
  { key: "home_garden", title_fr: "Maison et Jardin", title_en: "Home & Garden", keywords: ["sofa", "couch", "dining table", "living room", "sectional", "cabinet", "bookshelf", "dresser", "recliner", "furniture set"], target: 20 },
  { key: "kitchen", title_fr: "Électroménager Cuisine", title_en: "Kitchen Appliances", keywords: ["air fryer", "blender", "coffee maker", "rice cooker", "pressure cooker", "kettle", "toaster", "microwave", "instant pot", "espresso", "juicer", "mixer", "food processor"], target: 20 },
  { key: "sporting_goods", title_fr: "Articles de Sport", title_en: "Sporting Goods", keywords: ["basketball", "football", "soccer", "yoga", "fitness", "gym", "running", "sports", "exercise", "tennis"], target: 20 },
  { key: "jewelry_watches", title_fr: "Bijoux & Montres", title_en: "Jewelry & Watches", keywords: ["ring", "necklace", "bracelet", "watch", "jewelry", "gold", "silver", "diamond", "pendant", "earring", "rolex", "seiko", "casio"], target: 20 },
];

// Default settings (overridden by admin_settings)
const DEFAULT_POOL_SIZE = 300;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TTL_SECONDS = 172800; // 2 days
const MOBILE_SMARTPHONE_PAGE_SIZE = 50;
const MOBILE_PHONE_ROW_SIZE = 4;
const MOBILE_PHONE_BRAND_SEQUENCE = ["iphone", "pixel", "galaxy"] as const;
const MOBILE_PHONE_EXTRA_FILL = 2;
const MOBILE_PHONE_RESERVED_COUNT = MOBILE_PHONE_ROW_SIZE * MOBILE_PHONE_BRAND_SEQUENCE.length + MOBILE_PHONE_EXTRA_FILL;
const MOBILE_PHONE_ACCESSORY_RE = /\b(case|cover|protector|tempered glass|charger|cable|usb-?c|lightning|magsafe|airpods|earbud|earphone|power bank|holder|mount|stand|adapter|wireless charger|screen|skin|wrap|sleeve|pouch|wallet|lanyard|strap|grip|popsocket|stylus|lens|tripod|selfie|car mount|otterbox|spigen|for iphone|for samsung|for galaxy|for pixel|compatible with iphone|compatible with samsung|compatible with galaxy|compatible with pixel|replacement|repair|battery|sim |sim-|sim card|tray|button|speaker only|microphone|housing|frame|bezel|backplate|back plate|back glass|lcd|digitizer|oem part|ssd|portable ssd|external ssd|drive|storage|verre|protection|étui|coque)\b/i;

interface FeedSettings {
  poolSize: number;
  pageSize: number;
  ttlSeconds: number;
  mobileTtlSeconds: number;
  enabled: boolean;
}

interface SegmentConfig {
  name: string;
  target: number;
  seeds: string[];
  excludePatterns: RegExp[];
  minPrice?: number;
}

interface CatalogItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  priceUsd: number | null;
  currency: string;
  image_url: string | null;
  imageUrl: string | null;
  product_url: string | null;
  productUrl: string | null;
  in_stock: boolean;
  segment?: string;
}

interface CacheEntry {
  id: string;
  env: string;
  items: CatalogItem[];
  created_at: string;
  expires_at: string;
  meta: Record<string, unknown>;
  schema_version?: number;
}

let ebayTokenCache: { token: string; expiresAt: number } | null = null;

function generateCorrelationId(): string {
  return `ch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Flatten grouped mobile sections into a single "For you" feed.
 * Mobile homepage shows one continuous product grid (matching web behavior).
 * Order is preserved (phones → electronics → vehicles → kitchen → gaming → refurbished).
 * Set ?flat=0 to keep grouped sections.
 */
function hasValidImage(it: Record<string, unknown>): boolean {
  const candidates: unknown[] = [
    it.imageUrl,
    it.image_url,
    it.image,
    it.thumbnail,
    Array.isArray(it.images) && it.images.length > 0 ? (it.images as unknown[])[0] : null,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const url = c.trim();
    if (!url) continue;
    if (url === "/placeholder.svg" || url.endsWith("placeholder.svg")) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (/no[-_]?image|noimage|missing|spacer|1x1|pixel\.gif/i.test(url)) continue;
    return true;
  }
  return false;
}

function flattenMobilePayload(
  body: Record<string, unknown>,
  locale: string,
  shouldFlatten: boolean,
): Record<string, unknown> {
  const sections = (body.sections as Array<Record<string, unknown>>) || [];

  // ALWAYS drop imageless items (mobile must never see blank tiles)
  const cleanedSections = sections.map(s => ({
    ...s,
    items: ((s.items as Array<Record<string, unknown>>) || []).filter(hasValidImage),
  }));

  // Strip any banner/ad/promo fields that frozen mobile builds might render
  const stripped = {
    ...body,
    sections: cleanedSections,
    banners: [],
    promos: [],
    ads: [],
    hero: null,
    promotions: [],
  };

  if (!shouldFlatten || sections.length <= 1) {
    return {
      ...stripped,
      meta: {
        ...((body.meta as Record<string, unknown>) || {}),
        bannersStripped: true,
        imagelessFiltered: true,
      },
    };
  }

  const mergedItems: unknown[] = [];
  const seenIds = new Set<string>();
  for (const s of cleanedSections) {
    const items = (s.items as Array<Record<string, unknown>>) || [];
    for (const it of items) {
      const id = String(it.id ?? "");
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      mergedItems.push(it);
    }
  }

  const title_en = "For you";
  const title_fr = "Pour vous";
  const flatSection = {
    key: "for_you",
    title: locale === "en" ? title_en : title_fr,
    title_en,
    title_fr,
    items: mergedItems,
  };

  return {
    ...stripped,
    sections: [flatSection],
    totalItems: mergedItems.length,
    meta: {
      ...((body.meta as Record<string, unknown>) || {}),
      flattened: true,
      originalSectionCount: sections.length,
      bannersStripped: true,
      imagelessFiltered: true,
    },
  };
}

function isHomepageSmartphoneHandset(title: string): boolean {
  const lower = title.toLowerCase();
  const iphoneMatch = /\biphone\s?(se|1[1-6]|xr|xs|x)\b/.test(lower);
  const pixelMatch = /\bpixel\s?(6|7|8|9)\b/.test(lower);
  const galaxyMatch = /\b(samsung\s+)?galaxy\s+(s\d{1,2}|note\s?\d*|z\s?(fold|flip))\b/.test(lower);
  const oneplusMatch = /\boneplus\s+\d+/i.test(lower);
  return iphoneMatch || pixelMatch || galaxyMatch || oneplusMatch;
}

function getHomepageSmartphoneBucket(item: Pick<CatalogItem, "title">): "iphone" | "pixel" | "galaxy" | "other" {
  const title = (item.title || "").toLowerCase();
  if (title.includes("iphone")) return "iphone";
  if (title.includes("pixel")) return "pixel";
  if (title.includes("galaxy") || title.includes("samsung")) return "galaxy";
  return "other";
}

function prioritizeHomepageSmartphoneRows(items: CatalogItem[]): CatalogItem[] {
  const buckets: Record<"iphone" | "pixel" | "galaxy" | "other", CatalogItem[]> = {
    iphone: [],
    pixel: [],
    galaxy: [],
    other: [],
  };

  for (const item of items) {
    buckets[getHomepageSmartphoneBucket(item)].push(item);
  }

  const lead: CatalogItem[] = [];
  for (const brand of MOBILE_PHONE_BRAND_SEQUENCE) {
    const row = buckets[brand].slice(0, MOBILE_PHONE_ROW_SIZE);
    while (row.length < MOBILE_PHONE_ROW_SIZE && buckets.other.length > 0) {
      row.push(buckets.other.shift()!);
    }
    lead.push(...row);
  }

  const used = new Set(lead.map((item) => `${item.provider}:${item.provider_product_id}`));
  const rest = items.filter((item) => !used.has(`${item.provider}:${item.provider_product_id}`));
  return [...lead, ...rest];
}

async function fetchHomepagePhoneRows(
  supabaseUrl: string,
  serviceRoleKey: string,
  orFilter: string,
  offset: number,
  limit: number,
  withCount = false,
): Promise<{ rows: Array<Record<string, unknown>>; count: number | null }> {
  const params = new URLSearchParams();
  params.set("select", "id,provider,provider_product_id,title,image_url,images,product_url,price_usd,in_stock");
  params.set("is_active", "eq.true");
  params.set("is_disallowed", "eq.false");
  params.append("price_usd", "gte.80");
  params.append("price_usd", "lte.1800");
  params.set("provider", "in.(amazon,rainforest)");
  params.set("or", `(${orFilter})`);
  // Cheapest first per page (web parity). Tie-break by recency for stability.
  params.set("order", "price_usd.asc.nullslast,updated_at.desc.nullslast");
  params.set("offset", String(offset));
  params.set("limit", String(limit));

  const response = await fetch(`${supabaseUrl}/rest/v1/catalog_items?${params.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
      ...(withCount ? { Prefer: "count=exact" } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`phone rows fetch failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const rows = await response.json();
  const contentRange = response.headers.get("content-range") || "";
  const countMatch = contentRange.match(/\/(\d+)$/);
  return {
    rows: Array.isArray(rows) ? rows : [],
    count: countMatch ? parseInt(countMatch[1], 10) : null,
  };
}

function mapHomepagePhoneRows(rows: Array<Record<string, unknown>>): CatalogItem[] {
  const mapped: CatalogItem[] = [];
  for (const row of rows) {
    const title = String(row.title || "").trim();
    if (!title) continue;
    const lowerTitle = title.toLowerCase();
    if (MOBILE_PHONE_ACCESSORY_RE.test(lowerTitle)) continue;
    if (!isHomepageSmartphoneHandset(title)) continue;
    // Hard-block any tile whose title smells like an ad/banner row
    if (/\b(shop now|buy now|sponsored|advertisement|promo|deal of the day|limited time|love grown|cereal)\b/i.test(lowerTitle)) continue;

    // Strict: only accept the PRIMARY image after sanitization. No gallery fallback —
    // gallery fallbacks are how banner thumbnails sneak into product tiles.
    const primary = typeof row.image_url === "string" ? row.image_url : null;
    const image = sanitizeImageUrl(primary);
    if (!image) continue;

    const provider = String(row.provider || "amazon");
    const providerProductId = String(row.provider_product_id || row.id || "").trim();
    if (!providerProductId) continue;

    const rawPrice = typeof row.price_usd === "number" ? row.price_usd : Number(row.price_usd || 0);
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
    if (price === null) continue; // cheapest-first ordering requires a price
    const productUrl = typeof row.product_url === "string" ? row.product_url : null;

    mapped.push({
      id: providerProductId,
      provider,
      provider_product_id: providerProductId,
      title,
      price_usd: price,
      priceUsd: price,
      currency: "USD",
      image_url: image,
      imageUrl: image,
      product_url: productUrl,
      productUrl: productUrl,
      in_stock: row.in_stock !== false,
    });
  }
  // Final cheapest-first guarantee at the mapper level (defensive, in case
  // upstream merging from multiple brand-seed queries reorders items).
  mapped.sort((a, b) => (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity));
  return mapped;
}

async function buildMobileHomepagePhonesResponse(
  page: number,
  locale: string,
  correlationId: string,
  envUsed: string,
  envRequested: string,
  detectedBy: string,
): Promise<Response | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  const iphonePhoneOr = [
    "title.ilike.%iphone 11%",
    "title.ilike.%iphone 12%",
    "title.ilike.%iphone 13%",
    "title.ilike.%iphone 14%",
    "title.ilike.%iphone 15%",
    "title.ilike.%iphone 16%",
    "title.ilike.%iphone se%",
  ].join(",");
  const galaxyPhoneOr = [
    "title.ilike.%galaxy s21%",
    "title.ilike.%galaxy s22%",
    "title.ilike.%galaxy s23%",
    "title.ilike.%galaxy s24%",
    "title.ilike.%galaxy s25%",
    "title.ilike.%galaxy note%",
    "title.ilike.%galaxy z fold%",
    "title.ilike.%galaxy z flip%",
  ].join(",");
  const pixelPhoneOr = [
    "title.ilike.%pixel 7%",
    "title.ilike.%pixel 8%",
    "title.ilike.%pixel 9%",
  ].join(",");
  const phoneOr = [iphonePhoneOr, galaxyPhoneOr, pixelPhoneOr, "title.ilike.%oneplus %"].join(",");

  try {
    const safePage = Math.max(1, page || 1);
    const zeroBasedPage = safePage - 1;
    const offset = zeroBasedPage * MOBILE_SMARTPHONE_PAGE_SIZE;
    const generalLimit = zeroBasedPage === 0
      ? MOBILE_SMARTPHONE_PAGE_SIZE + MOBILE_PHONE_RESERVED_COUNT + 24
      : MOBILE_SMARTPHONE_PAGE_SIZE;
    const brandSeedLimit = MOBILE_PHONE_ROW_SIZE * 8;

    const [generalRes, iphoneRes, pixelRes, galaxyRes] = await Promise.all([
      fetchHomepagePhoneRows(supabaseUrl, serviceRoleKey, phoneOr, offset, generalLimit, true),
      zeroBasedPage === 0
        ? fetchHomepagePhoneRows(supabaseUrl, serviceRoleKey, iphonePhoneOr, 0, brandSeedLimit)
        : Promise.resolve({ rows: [], count: null }),
      zeroBasedPage === 0
        ? fetchHomepagePhoneRows(supabaseUrl, serviceRoleKey, pixelPhoneOr, 0, brandSeedLimit)
        : Promise.resolve({ rows: [], count: null }),
      zeroBasedPage === 0
        ? fetchHomepagePhoneRows(supabaseUrl, serviceRoleKey, galaxyPhoneOr, 0, brandSeedLimit)
        : Promise.resolve({ rows: [], count: null }),
    ]);

    const rawRows = zeroBasedPage === 0
      ? [...iphoneRes.rows, ...pixelRes.rows, ...galaxyRes.rows, ...generalRes.rows]
      : generalRes.rows;

    let items = deduplicateItems(mapHomepagePhoneRows(rawRows));
    // Apply all-inclusive pricing (markup + shipping + rounding) so the homepage
    // tile price matches the product detail page and cart exactly.
    try {
      const pSettings = await loadPricingSettings();
      items = applyAllInclusivePricingToItems(
        items as unknown as Record<string, unknown>[],
        pSettings,
      ) as typeof items;
    } catch (e) {
      console.error(`[CATALOG_HOME] mobile_phones pricing transform error:`, e);
    }
    // Re-sort cheapest-first AFTER all-inclusive pricing (markup can shift order).
    items.sort((a, b) => (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity));
    items = items.slice(0, MOBILE_SMARTPHONE_PAGE_SIZE);

    const totalItems = Math.max(generalRes.count || 0, items.length);
    const totalPages = Math.max(1, Math.ceil(totalItems / MOBILE_SMARTPHONE_PAGE_SIZE));
    const langKey: "fr" | "en" = locale === "en" ? "en" : "fr";
    const title_en = "Smartphones";
    const title_fr = "Smartphones";

    return jsonResponse({
      ok: true,
      sections: normalizeSectionTitles([
        {
          key: "phones",
          title: langKey === "en" ? title_en : title_fr,
          title_en,
          title_fr,
          hideTitle: true,
          items,
        },
      ], langKey),
      page: safePage,
      pageSize: MOBILE_SMARTPHONE_PAGE_SIZE,
      totalPages,
      totalItems,
      hasMore: safePage < totalPages,
      hasMoreCached: safePage < totalPages,
      banners: [],
      promos: [],
      ads: [],
      hero: null,
      promotions: [],
      correlationId,
      meta: {
        client: "mobile",
        detectedBy,
        envUsed,
        envRequested,
        source: "mobile_homepage_phones_db",
        pageMode: "numeric",
        matchesWebHomepagePhones: true,
      },
    });
  } catch (error) {
    console.warn(`[CATALOG_HOME] mobile_homepage_phones_error correlationId=${correlationId} error=${error}`);
    return null;
  }
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const finalHeaders: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...extraHeaders };

  if (status >= 400) {
    // Never cache error responses
    finalHeaders["Cache-Control"] = "no-store, no-cache, must-revalidate";
    finalHeaders["Surrogate-Control"] = "no-store";
    finalHeaders["Pragma"] = "no-cache";
  } else {
    // Force no-store for all success responses too — prevents OkHttp/native HTTP caches
    // from serving stale data. Server-side caching (DB) handles performance.
    finalHeaders["Cache-Control"] = "no-store, no-cache, must-revalidate";
    finalHeaders["Pragma"] = "no-cache";
  }

  return new Response(JSON.stringify(data), {
    status,
    headers: finalHeaders,
  });
}

/**
 * Normalize environment from request - handles mobile header casing variants
 * Falls back to "production" if env is invalid or unrecognized
 */
function normalizeEnv(req: Request): { envRequested: string; envUsed: string } {
  const url = new URL(req.url);

  let envRequested = url.searchParams.get("env")
    || req.headers.get("X-Afrishop-Environment")
    || req.headers.get("x-afrishop-environment")
    || "production";

  envRequested = envRequested.toLowerCase().trim();
  const explicitStagingQuery = (url.searchParams.get("env") || "").toLowerCase().trim() === "staging";

  let envUsed = envRequested;
  if (envUsed === "prod") envUsed = "production";
  if (envUsed !== "production" && envUsed !== "staging" && envUsed !== "dev") envUsed = "production";

  // Frozen mobile builds send ?env=staging — force production for ALL mobile requests
  const { clientType } = detectClientType(req);
  if (envUsed === "staging" && clientType === "mobile") {
    console.warn("[CATALOG_HOME] Mobile request sent staging env (header or query param); forcing production fallback");
    envUsed = "production";
  }

  return { envRequested, envUsed };
}

// Segment-to-section mapping: cache segments → mobile section keys
/**
 * Build GUARANTEED mobile sections response with strict profile filtering
 * ALWAYS returns ok:true with sections (even if items are empty)
 * This PREVENTS "Catalogue Indisponible" on mobile
 */
async function buildMobileSectionsResponse(
  items: CatalogItem[],
  locale: string,
  correlationId: string,
  source: string,
  isStale: boolean,
  envUsed: string,
  envRequested: string,
  detectedBy: string = "unknown",
  mobileTtlSeconds?: number
): Promise<Response> {
  const lang: "fr" | "en" = locale === "en" ? "en" : "fr";
  
  // Use dedicated mobile sections cache — builds strict sections once, caches result
  return serveMobileSections(
    envUsed,
    envRequested,
    lang,
    correlationId,
    detectedBy,
    items as SectionItem[],
    mobileTtlSeconds
  );
}
async function loadFeedSettings(): Promise<FeedSettings> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("[CATALOG_HOME] Missing env vars, using defaults");
    return {
      poolSize: DEFAULT_POOL_SIZE,
      pageSize: DEFAULT_PAGE_SIZE,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      mobileTtlSeconds: 1800,
      enabled: true,
    };
  }

  try {
    const keys = [
      "home_feed_pool_size",
      "home_feed_page_size",
      "home_feed_ttl_seconds",
      "home_feed_limit",
      "home_feed_enabled",
      "home_cache_ttl_seconds"
    ];
    
    // Fetch admin_settings and catalog_cache_settings in parallel
    const [adminRes, cacheRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/admin_settings?key=in.(${keys.map(k => `"${k}"`).join(",")})`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/catalog_cache_settings?key=eq.default`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            Accept: "application/vnd.pgrst.object+json",
          },
        }
      ),
    ]);

    let settingsMap = new Map<string, string>();
    if (adminRes.ok) {
      const rows = await adminRes.json() as Array<{ key: string; value: string }>;
      settingsMap = new Map(rows.map(r => [r.key, r.value]));
    }

    // Parse catalog_cache_settings (admin Cache tab)
    let cacheSettingsTtl: number | null = null;
    if (cacheRes.ok && cacheRes.status !== 406) {
      try {
        const cacheRow = await cacheRes.json() as {
          home_expires_minutes?: number | null;
          updated_at?: string | null;
        };
        if (cacheRow?.home_expires_minutes && cacheRow.home_expires_minutes > 0) {
          cacheSettingsTtl = cacheRow.home_expires_minutes * 60; // convert minutes → seconds
          console.log(`[CATALOG_HOME] catalog_cache_settings home_expires=${cacheRow.home_expires_minutes}m → ${cacheSettingsTtl}s`);
        }
      } catch {
        // ignore parse errors
      }
    }

    const poolSize = parseInt(settingsMap.get("home_feed_pool_size") || settingsMap.get("home_feed_limit") || "") || DEFAULT_POOL_SIZE;
    const adminTtl = parseInt(settingsMap.get("home_feed_ttl_seconds") || "") || 0;
    const adminHomeCacheTtl = parseInt(settingsMap.get("home_cache_ttl_seconds") || "") || 0;

    // Priority: catalog_cache_settings (Cache tab) > admin_settings home_cache_ttl > admin_settings home_feed_ttl > default
    const webTtl = cacheSettingsTtl || adminHomeCacheTtl || adminTtl || DEFAULT_TTL_SECONDS;
    const mobileTtl = cacheSettingsTtl || adminHomeCacheTtl || 1800;

    return {
      poolSize,
      pageSize: parseInt(settingsMap.get("home_feed_page_size") || "") || DEFAULT_PAGE_SIZE,
      ttlSeconds: webTtl,
      mobileTtlSeconds: mobileTtl,
      enabled: settingsMap.get("home_feed_enabled") !== "false",
    };
  } catch (err) {
    console.warn(`[CATALOG_HOME] Settings load error: ${err}`);
    return {
      poolSize: DEFAULT_POOL_SIZE,
      pageSize: DEFAULT_PAGE_SIZE,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      mobileTtlSeconds: 1800,
      enabled: true,
    };
  }
}

/**
 * TIER 1 & 2: Get cached feed (fresh or stale)
 * Returns cache if available, even if expired (stale-while-revalidate)
 * Now includes schema version validation
 */
async function getCachedFeedWithStale(env: string, category: string): Promise<{ cache: CacheEntry | null; isStale: boolean }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return { cache: null, isStale: false };

  const cacheKey = `${env}:${category || "all"}`;

  try {
    // First try fresh cache (not expired)
    const freshRes = await fetch(
      `${supabaseUrl}/rest/v1/catalog_home_cache?id=eq.${encodeURIComponent(cacheKey)}&expires_at=gt.${new Date().toISOString()}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );

    if (freshRes.ok && freshRes.status !== 406) {
      const data = await freshRes.json();
      if (data && data.items && data.items.length > 0) {
        // Forward-compatible schema check: accept null/0/older/current, reject only future incompatible
        const schemaVersion = data.meta?.schemaVersion ?? data.schema_version ?? 0;
        const isCompatible = schemaVersion <= CACHE_SCHEMA_VERSION;
        console.log(`[CATALOG_HOME] cacheHit key=${cacheKey} schemaVersion=${schemaVersion} items=${data.items.length} compatible=${isCompatible}`);
        if (isCompatible) {
          data.items = withoutEbayClothing(data.items as Array<Record<string, unknown>>);
          if (data.items.length > 0) return { cache: data as CacheEntry, isStale: false };
        }
        // Only reject if schema version is from future (greater than current)
        console.log(`[CATALOG_HOME] cache_schema_future_incompatible key=${cacheKey} cacheVersion=${schemaVersion} current=${CACHE_SCHEMA_VERSION}`);
      }
    }

    // No fresh cache - try stale cache (any cache for this key)
    const staleRes = await fetch(
      `${supabaseUrl}/rest/v1/catalog_home_cache?id=eq.${encodeURIComponent(cacheKey)}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );

    if (staleRes.ok && staleRes.status !== 406) {
      const data = await staleRes.json();
      if (data && data.items && data.items.length > 0) {
        // Forward-compatible: accept null/0/older/current, reject only future
        const schemaVersion = data.meta?.schemaVersion ?? data.schema_version ?? 0;
        const isCompatible = schemaVersion <= CACHE_SCHEMA_VERSION;
        console.log(`[CATALOG_HOME] stale_cacheHit key=${cacheKey} schemaVersion=${schemaVersion} items=${data.items.length} compatible=${isCompatible}`);
        if (isCompatible) {
          data.items = withoutEbayClothing(data.items as Array<Record<string, unknown>>);
          if (data.items.length > 0) return { cache: data as CacheEntry, isStale: true };
        }
        console.log(`[CATALOG_HOME] stale_cache_future_incompatible key=${cacheKey} cacheVersion=${schemaVersion} current=${CACHE_SCHEMA_VERSION}`);
      }
    }

    return { cache: null, isStale: false };
  } catch (err) {
    console.warn(`[CATALOG_HOME] Cache read error: ${err}`);
    return { cache: null, isStale: false };
  }
}

/**
 * TIER 3: BOOTSTRAP FROM DATABASE (CRITICAL SAFETY NET)
 * This ensures mobile NEVER sees "Catalogue Indisponible"
 * Fetches from catalog_items table when all cache fails
 */
async function bootstrapFromDatabase(correlationId: string): Promise<CatalogItem[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`[CATALOG_HOME][BOOTSTRAP] Missing env vars`);
    return [];
  }

  try {
    console.log(`[CATALOG_HOME][BOOTSTRAP] correlationId=${correlationId} fetching from catalog_items table`);
    
    // Fetch recent items from catalog_items table
    // Order by updated_at desc to get freshest items
    const res = await fetch(
      `${supabaseUrl}/rest/v1/catalog_items?provider=in.(amazon,ebay,cargurus,carvana,shein)&price_usd=gt.0&image_url=neq.null&is_disallowed=eq.false&order=updated_at.desc.nullslast&limit=300`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[CATALOG_HOME][ERROR] bootstrap status=${res.status} body=${body.substring(0, 200)} correlationId=${correlationId}`);
      return [];
    }
    
    console.log(`[CATALOG_HOME] bootstrap ok correlationId=${correlationId}`);

    const rows = withoutEbayClothing(await res.json() as Array<Record<string, unknown>>);
    
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn(`[CATALOG_HOME][BOOTSTRAP] No items found in catalog_items`);
      return [];
    }

    // Map to CatalogItem format
    const items: CatalogItem[] = rows.map(row => ({
      id: `${row.provider}_${row.provider_product_id}`,
      provider: row.provider as string,
      provider_product_id: row.provider_product_id as string,
      title: row.title as string || "Product",
      price_usd: row.price_usd as number | null,
      priceUsd: row.price_usd as number | null,
      currency: "USD",
      image_url: bestProductImage(row.image_url as string | null, row.images),
      imageUrl: bestProductImage(row.image_url as string | null, row.images),
      product_url: row.product_url as string | null,
      productUrl: row.product_url as string | null,
      in_stock: true,
    })).filter(item => item.title && item.image_url && item.price_usd && item.price_usd > 0);

    console.log(`[CATALOG_HOME][BOOTSTRAP] correlationId=${correlationId} source=bootstrap_db itemsTotal=${items.length}`);
    
    return items;
  } catch (err) {
    console.error(`[CATALOG_HOME][BOOTSTRAP] Exception: ${err}`);
    return [];
  }
}

async function saveCachedFeed(
  env: string, 
  category: string, 
  items: CatalogItem[], 
  ttlSeconds: number,
  meta: Record<string, unknown>
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return;

  const cacheKey = `${env}:${category || "all"}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    await fetch(`${supabaseUrl}/rest/v1/catalog_home_cache`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        id: cacheKey,
        env,
        items,
        expires_at: expiresAt,
        meta: {
          ...meta,
          schemaVersion: CACHE_SCHEMA_VERSION,
        },
      }),
    });
    console.log(`[CATALOG_HOME] Cache saved key=${cacheKey} items=${items.length} expiresAt=${expiresAt} schemaVersion=${CACHE_SCHEMA_VERSION}`);
  } catch (err) {
    console.warn(`[CATALOG_HOME] Cache save error: ${err}`);
  }
}

async function getEbayToken(): Promise<string | null> {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60000) {
    return ebayTokenCache.token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[CATALOG_HOME] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
    return null;
  }

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CATALOG_HOME] eBay OAuth error: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json();
    ebayTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };
    return ebayTokenCache.token;
  } catch (err) {
    console.error(`[CATALOG_HOME] eBay OAuth exception: ${err}`);
    return null;
  }
}

function extractPriceFromEbay(item: Record<string, unknown>): number | null {
  const priceObj = item.price as Record<string, unknown> | undefined;
  if (priceObj?.value !== undefined) {
    const val = typeof priceObj.value === "string" ? parseFloat(priceObj.value) : priceObj.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) return val;
  }
  const currentPrice = item.currentPrice as Record<string, unknown> | undefined;
  if (currentPrice?.value !== undefined) {
    const val = typeof currentPrice.value === "string" ? parseFloat(currentPrice.value) : currentPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) return val;
  }
  return null;
}

function isValidEbayId(itemId: string): boolean {
  if (!itemId) return false;
  if (itemId.startsWith("v1|")) return true;
  if (/^\d{12,}$/.test(itemId)) return true;
  return false;
}

function isValidAsin(asin: string): boolean {
  if (!asin) return false;
  return /^[A-Z0-9]{10}$/i.test(asin);
}

function mapEbayItem(item: Record<string, unknown>, segment?: string): CatalogItem | null {
  const priceUsd = extractPriceFromEbay(item);
  const rawImageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || null;
  const imageUrl = sanitizeImageUrl(rawImageUrl);
  const productUrl = (item.itemWebUrl as string) || null;
  const priceObj = item.price as Record<string, unknown> | undefined;
  const itemId = item.itemId as string || "";
  
  if (!isValidEbayId(itemId)) {
    return null;
  }
  
  const canonicalId = `ebay_${itemId}`;
  
  return {
    id: canonicalId,
    provider: "ebay",
    provider_product_id: itemId,
    title: (item.title as string) || "Unknown",
    price_usd: priceUsd,
    priceUsd: priceUsd,
    currency: (priceObj?.currency as string) || "USD",
    image_url: imageUrl,
    imageUrl: imageUrl,
    product_url: productUrl,
    productUrl: productUrl,
    in_stock: true,
    segment,
  };
}

function mapRainforestItem(item: Record<string, unknown>, segment?: string): CatalogItem | null {
  const asin = (item.asin as string || "").toUpperCase();
  const price = item.price as Record<string, unknown> | undefined;
  const priceValue = price?.value as number || null;
  const rawImageUrl = item.image as string || (item.main_image as Record<string, unknown>)?.link as string || null;
  const imageUrl = sanitizeImageUrl(rawImageUrl);
  
  if (!isValidAsin(asin)) {
    return null;
  }
  
  const canonicalId = `amazon_${asin}`;
  
  return {
    id: canonicalId,
    provider: "amazon",
    provider_product_id: asin,
    title: (item.title as string) || "Unknown",
    price_usd: priceValue,
    priceUsd: priceValue,
    currency: "USD",
    image_url: imageUrl,
    imageUrl: imageUrl,
    product_url: item.link as string || `https://www.amazon.com/dp/${asin}`,
    productUrl: item.link as string || `https://www.amazon.com/dp/${asin}`,
    in_stock: true,
    segment,
  };
}

async function fetchEbayItems(
  query: string,
  limit: number,
  ebayToken: string,
  correlationId: string,
  segment?: string
): Promise<CatalogItem[]> {
  const startMs = Date.now();
  const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", String(Math.min(limit, 50)));

  try {
    const response = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${ebayToken}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      console.error(`[CATALOG_HOME][EBAY] correlationId=${correlationId} query="${query}" error=${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawItems = data.itemSummaries || [];
    const items = rawItems
      .map((i: Record<string, unknown>) => mapEbayItem(i, segment))
      .filter((i: CatalogItem | null): i is CatalogItem => i !== null && !!i.title && !!i.image_url && !isEbayClothingItem(i as unknown as Record<string, unknown>));
    
    console.log(`[CATALOG_HOME][EBAY] correlationId=${correlationId} query="${query.substring(0,30)}" fetched=${rawItems.length} kept=${items.length} ms=${Date.now()-startMs}`);
    return items;
  } catch (err) {
    console.error(`[CATALOG_HOME][EBAY] correlationId=${correlationId} query="${query}" exception=${err}`);
    return [];
  }
}

async function fetchRainforestItems(
  query: string,
  limit: number,
  amazonDomain: string,
  correlationId: string,
  segment?: string
): Promise<CatalogItem[]> {
  const startMs = Date.now();
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!apiKey) {
    console.warn("[CATALOG_HOME][RAINFOREST] Missing RAINFOREST_API_KEY");
    return [];
  }

  const url = new URL("https://api.rainforestapi.com/request");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("type", "search");
  url.searchParams.set("amazon_domain", amazonDomain);
  url.searchParams.set("search_term", query);

  try {
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      console.error(`[CATALOG_HOME][RAINFOREST] correlationId=${correlationId} query="${query}" error=${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawItems = data.search_results || [];
    const items = rawItems
      .slice(0, limit)
      .map((i: Record<string, unknown>) => mapRainforestItem(i, segment))
      .filter((i: CatalogItem | null): i is CatalogItem => i !== null && !!i.title && !!i.image_url && !!i.price_usd);
    
    console.log(`[CATALOG_HOME][RAINFOREST] correlationId=${correlationId} query="${query.substring(0,30)}" fetched=${rawItems.length} kept=${items.length} ms=${Date.now()-startMs}`);
    return items;
  } catch (err) {
    console.error(`[CATALOG_HOME][RAINFOREST] correlationId=${correlationId} query="${query}" exception=${err}`);
    return [];
  }
}

function filterByPatterns(items: CatalogItem[], excludePatterns: RegExp[]): CatalogItem[] {
  if (excludePatterns.length === 0) return items;
  return items.filter(item => {
    if (!item.title || !item.image_url) return false;
    const title = item.title.toLowerCase();
    return !excludePatterns.some(pattern => pattern.test(title));
  });
}

function deduplicateItems(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.provider}:${item.provider_product_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableShuffle<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  
  for (let i = arr.length - 1; i > 0; i--) {
    h = ((h << 5) - h + i) | 0;
    const j = Math.abs(h) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getSegmentConfigs(poolSize: number): SegmentConfig[] {
  const scale = poolSize / 1000;
  
  return [
    {
      name: "phones",
      target: Math.round(250 * scale),
      seeds: [
        "iphone unlocked", "iphone 13 unlocked", "iphone 14 unlocked", "iphone 15 unlocked",
        "samsung galaxy unlocked", "google pixel unlocked", "android phone unlocked",
        "iphone pro max unlocked", "samsung galaxy s24", "pixel 8 pro"
      ],
      excludePatterns: [
        /\bcase\b/i, /\bcover\b/i, /\bscreen protector\b/i, /\bdigitizer\b/i,
        /\blcd\b/i, /\bhousing\b/i, /\brepair\b/i, /\bparts\b/i, /\blot\b/i
      ],
      minPrice: 100,
    },
    {
      name: "accessories",
      target: Math.round(200 * scale),
      seeds: [
        "iphone case", "magsafe case", "usb c charger", "fast charger",
        "airpods", "airpods pro", "earbuds wireless", "power bank",
        "phone stand", "car phone mount", "wireless charger"
      ],
      excludePatterns: [],
    },
    {
      name: "cars",
      target: Math.round(150 * scale),
      seeds: [
        "car stereo carplay", "dashcam", "car jump starter", "obd2 scanner",
        "car bluetooth adapter", "backup camera", "car phone holder",
        "car vacuum", "car seat cover", "car led lights"
      ],
      excludePatterns: [/\bfor\s+toy\b/i, /\bmodel\s+car\b/i, /\bdiecast\b/i],
    },
    {
      name: "gaming",
      target: Math.round(200 * scale),
      seeds: [
        "xbox series x", "xbox series s", "ps5 console", "nintendo switch oled",
        "gaming console", "xbox controller", "ps5 controller",
        "gaming headset", "gaming keyboard", "gaming mouse"
      ],
      excludePatterns: [/\brepair kit\b/i, /\bfor parts\b/i],
    },
    {
      name: "home",
      target: Math.round(200 * scale),
      seeds: [
        "sofa", "couch living room", "bed frame queen", "mattress",
        "dining table", "tv stand", "refrigerator", "microwave oven",
        "air fryer", "vacuum cleaner", "coffee maker"
      ],
      excludePatterns: [/\bcover only\b/i, /\breplacement part only\b/i],
      minPrice: 20,
    },
  ];
}

async function buildSegment(
  config: SegmentConfig,
  amazonDomain: string,
  ebayToken: string | null,
  correlationId: string
): Promise<CatalogItem[]> {
  const startMs = Date.now();
  const fetchLimit = Math.ceil(config.target * 4);
  const perSeed = Math.ceil(fetchLimit / config.seeds.length);
  
  const amazonPromises = config.seeds.map(seed =>
    fetchRainforestItems(seed, perSeed, amazonDomain, correlationId, config.name)
  );
  
  let allItems: CatalogItem[] = [];
  
  const amazonResults = await Promise.all(amazonPromises);
  allItems.push(...amazonResults.flat());
  
  if (ebayToken && ["accessories", "cars", "gaming"].includes(config.name)) {
    const ebaySeeds = config.seeds.slice(0, 4);
    const ebayPromises = ebaySeeds.map(seed =>
      fetchEbayItems(seed, 30, ebayToken, correlationId, config.name)
    );
    const ebayResults = await Promise.all(ebayPromises);
    allItems.push(...ebayResults.flat());
  }
  
  allItems = filterByPatterns(allItems, config.excludePatterns);
  
  if (config.minPrice) {
    allItems = allItems.filter(i => (i.price_usd || 0) >= config.minPrice!);
  }
  
  allItems = deduplicateItems(allItems);
  allItems = stableShuffle(allItems, `${correlationId}_${config.name}`);
  
  const kept = allItems.slice(0, config.target);
  
  console.log(`[CATALOG_HOME][SEGMENT] correlationId=${correlationId} segment=${config.name} raw=${allItems.length} kept=${kept.length} target=${config.target} ms=${Date.now()-startMs}`);
  
  return kept;
}

async function buildFullFeed(
  settings: FeedSettings,
  correlationId: string,
  amazonDomain: string,
  ebayToken: string | null
): Promise<{ items: CatalogItem[]; segmentCounts: Record<string, number>; ms: number; shortfall: boolean }> {
  const startMs = Date.now();
  const segments = getSegmentConfigs(settings.poolSize);
  
  const segmentPromises = segments.map(config =>
    buildSegment(config, amazonDomain, ebayToken, correlationId)
  );
  
  const segmentResults = await Promise.all(segmentPromises);
  
  let allItems: CatalogItem[] = [];
  const segmentCounts: Record<string, number> = {};
  
  for (let i = 0; i < segments.length; i++) {
    const segmentItems = segmentResults[i];
    allItems.push(...segmentItems);
    segmentCounts[segments[i].name] = segmentItems.length;
  }
  
  const beforeDedup = allItems.length;
  allItems = deduplicateItems(allItems);
  const afterDedup = allItems.length;
  
  if (beforeDedup > afterDedup) {
    console.log(`[CATALOG_HOME] correlationId=${correlationId} cross_dedup removed=${beforeDedup - afterDedup}`);
  }
  
  const shortfall = allItems.length < settings.poolSize;
  if (shortfall) {
    console.log(`[CATALOG_HOME][WARN] correlationId=${correlationId} shortfall final=${allItems.length} target=${settings.poolSize}`);
  }
  
  const ms = Date.now() - startMs;
  console.log(`[CATALOG_HOME] correlationId=${correlationId} built total=${allItems.length} segments=${JSON.stringify(segmentCounts)} ms=${ms}`);
  
  return { items: allItems, segmentCounts, ms, shortfall };
}

async function fetchLiveItems(
  page: number,
  pageSize: number,
  amazonDomain: string,
  ebayToken: string | null,
  correlationId: string
): Promise<CatalogItem[]> {
  const startMs = Date.now();
  
  const liveSeeds = [
    "electronics deals", "smartphone accessories", "home gadgets",
    "gaming deals", "tech accessories", "kitchen appliances",
    "laptop accessories", "smart home devices", "fitness electronics"
  ];
  
  const seedIndex = (page - 1) % liveSeeds.length;
  const seed = liveSeeds[seedIndex];
  
  let items: CatalogItem[] = [];
  
  const amazonItems = await fetchRainforestItems(seed, pageSize, amazonDomain, correlationId, "live");
  items.push(...amazonItems);
  
  if (ebayToken && items.length < pageSize) {
    const ebayItems = await fetchEbayItems(seed, pageSize - items.length, ebayToken, correlationId, "live");
    items.push(...ebayItems);
  }
  
  items = deduplicateItems(items);
  items = stableShuffle(items, `${correlationId}_live_${page}`);
  
  console.log(`[CATALOG_HOME][LIVE] correlationId=${correlationId} page=${page} seed="${seed}" fetched=${items.length} ms=${Date.now()-startMs}`);
  
  return items.slice(0, pageSize);
}

serve(async (req) => {
  const correlationId = generateCorrelationId();
  
  // Dynamic CORS preflight — echoes whatever headers the client requests
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }

  logStartupRequest("CATALOG_HOME", req, { correlationId });

  const startTime = Date.now();
  const detection = detectClientType(req);
  const clientType = detection.clientType;
  const detectedBy = detection.detectedBy;
  const { envRequested, envUsed } = normalizeEnv(req);
  const lang = getResponseLanguage(req);
  let env = envUsed;

  // Wrap EVERYTHING in try/catch to GUARANTEE no throws
  try {
    // Parse parameters
    const url = new URL(req.url);
    let page = 1;
    let pageSize = clientType === "mobile" ? 20 : DEFAULT_PAGE_SIZE;
    let category = "";
    let section = "";
    let amazonDomain = "amazon.com";
    let forceLive = false;
    let locale = lang;
    let cursor = "";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        page = parseInt(body.page) || 1;
        category = body.category || "";
        section = body.section || body.sectionKey || "";
        cursor = body.cursor || "";
        amazonDomain = body.amazon_domain || "amazon.com";
        locale = body.locale || body.lang || lang;
        if (body.env) {
          const bodyEnv = body.env.toLowerCase().trim();
          env = bodyEnv === "prod" ? "production" : (["production", "staging", "dev"].includes(bodyEnv) ? bodyEnv : "production");
        }
        forceLive = body.live === true || body.live === "1" || body.source === "live";
      } catch {
        // Use defaults
      }
    } else {
      page = parseInt(url.searchParams.get("page") || "1") || 1;
      category = url.searchParams.get("category") || "";
      section = url.searchParams.get("section") || url.searchParams.get("sectionKey") || "";
      cursor = url.searchParams.get("cursor") || "";
      amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
      locale = url.searchParams.get("locale") || url.searchParams.get("lang") || lang;
      forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("source") === "live";
    }

    // If section is specified, redirect to catalog-category for "Voir Tout" browsing
    const sectionKey = section || "";
    if (sectionKey) {
      console.log(`[CATALOG_HOME] section_browse correlationId=${correlationId} section=${sectionKey} page=${page} client=${clientType} — delegating to catalog-category`);
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
      if (supabaseUrl) {
        try {
          const catUrl = `${supabaseUrl}/functions/v1/catalog-category?category=${encodeURIComponent(sectionKey)}&sectionKey=${encodeURIComponent(sectionKey)}&limit=500&sort=relevance${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const catRes = await fetch(catUrl, {
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              "x-afrishop-environment": env,
            },
          });
          if (catRes.ok) {
            const catBody = await catRes.json();
            return jsonResponse(catBody);
          }
        } catch (err) {
          console.warn(`[CATALOG_HOME] section_browse delegation error: ${err}`);
        }
      }
    }

    const wantsMobileHomepagePhones = clientType === "mobile" && !category && !sectionKey && !forceLive;
    if (wantsMobileHomepagePhones) {
      const mobileHomepageResponse = await buildMobileHomepagePhonesResponse(
        page,
        locale,
        correlationId,
        env,
        envRequested,
        detectedBy,
      );
      if (mobileHomepageResponse) {
        return mobileHomepageResponse;
      }
    }

    console.log(`[CATALOG_HOME] start correlationId=${correlationId} client=${clientType} detectedBy=${detectedBy} lang=${lang} envRequested=${envRequested} envUsed=${env} page=${page} pageSize=${pageSize} category=${category} forceLive=${forceLive} locale=${locale}`);

    // ===== MOBILE: STRICT SECTIONS CACHE (PRIMARY) → RECIPE CACHE (FALLBACK) =====
    // ===== WEB: RECIPE CACHE (PRIMARY) =====
    if (!forceLive) {
      try {
        const recipeSettings = await loadRefreshSettings(env);
        
        if (clientType === "mobile") {
          // PRIMARY: Try strict sections cache (has provider filtering: SHEIN for clothing, Amazon for phones)
          const langKey: "fr" | "en" = (locale === "en" ? "en" : "fr");
          const strictResponse = await serveMobileSections(
            env,
            envRequested,
            langKey,
            correlationId,
            detectedBy,
            [], // empty pool — force cache read or backfill from DB
            recipeSettings.mobile_refresh_hours > 0 ? recipeSettings.mobile_refresh_hours * 3600 : 1800
          );
          
          // Check if strict sections returned valid data
          if (strictResponse.status === 200) {
            const body = await strictResponse.json();
            if (body.ok && body.sections && body.sections.length > 0) {
              const totalItems = calculateTotalItems(body.sections);
              if (totalItems > 0) {
                console.log(`[CATALOG_HOME] strict_sections_hit correlationId=${correlationId} sections=${body.sections.length} totalItems=${totalItems}`);
                const flat = url.searchParams.get("flat") !== "0";
                return jsonResponse(flattenMobilePayload(body, locale, flat));
              }
            }
          }
          
          // FALLBACK: Try recipe cache
          console.log(`[CATALOG_HOME] strict_sections_miss, trying recipe_cache correlationId=${correlationId}`);
          let mobileCache = await readMobileCache(env);
          if ((!mobileCache.hit || !mobileCache.payload) && env !== "production") {
            mobileCache = await readMobileCache("production");
          }
          if (mobileCache.hit && mobileCache.payload && mobileCache.schemaVersion === recipeSettings.mobile_schema_version) {
            const payload = mobileCache.payload as Record<string, unknown>;
            const sections = payload.sections as Array<Record<string, unknown>> || [];
            if (sections.length > 0) {
              const langKey2: "fr" | "en" = (locale === "en" ? "en" : "fr");
              const normalized = sections.map(s => ({
                ...s,
                title: langKey2 === "fr" ? (s.title_fr || s.title) : (s.title_en || s.title),
                items: (s.items as unknown[] || []).slice(0, 40),
              }));
              const normalizedSections = normalizeSectionTitles(normalized, langKey2) as typeof normalized;
              const totalItems = calculateTotalItems(normalizedSections);
              const totalMs = Date.now() - startTime;
              
              const flat = url.searchParams.get("flat") !== "0";
              return jsonResponse(flattenMobilePayload({
                ok: true,
                sections: normalizedSections,
                page: 1,
                pageSize: 40,
                totalPages: 1,
                totalItems,
                hasMore: false,
                hasMoreCached: false,
                ttlSeconds: recipeSettings.mobile_refresh_hours * 3600,
                correlationId,
                meta: {
                  client: "mobile",
                  detectedBy,
                  envUsed: env,
                  envRequested,
                  source: "recipe_cache_fallback",
                  isStale: false,
                  ageSeconds: mobileCache.ageSeconds,
                  correlationId,
                  ts: Date.now(),
                  totalMs,
                  schemaVersion: recipeSettings.mobile_schema_version,
                },
              }, locale, flat));
            }
          }
          
          // Stale recipe cache fallback
          if (!mobileCache.hit && mobileCache.payload) {
            const payload = mobileCache.payload as Record<string, unknown>;
            const sections = payload.sections as Array<Record<string, unknown>> || [];
            if (sections.length > 0) {
              const langKey2: "fr" | "en" = (locale === "en" ? "en" : "fr");
              const normalized = sections.map(s => ({
                ...s,
                title: langKey2 === "fr" ? (s.title_fr || s.title) : (s.title_en || s.title),
                items: (s.items as unknown[] || []).slice(0, 40),
              }));
              const normalizedSections = normalizeSectionTitles(normalized, langKey2) as typeof normalized;
              const totalItems = calculateTotalItems(normalizedSections);
              
              const flat = url.searchParams.get("flat") !== "0";
              return jsonResponse(flattenMobilePayload({
                ok: true,
                sections: normalizedSections,
                page: 1,
                pageSize: 40,
                totalPages: 1,
                totalItems,
                hasMore: false,
                hasMoreCached: false,
                ttlSeconds: recipeSettings.mobile_refresh_hours * 3600,
                correlationId,
                meta: {
                  client: "mobile",
                  detectedBy,
                  envUsed: env,
                  envRequested,
                  source: "recipe_cache_stale",
                  isStale: true,
                  ageSeconds: mobileCache.ageSeconds,
                  correlationId,
                  ts: Date.now(),
                  schemaVersion: recipeSettings.mobile_schema_version,
                },
              }, locale, flat));
            }
          }
        } else {
          // WEB: Try recipe web cache
          let webCache = await readWebCache(env);
          // Production fallback for web recipe cache
          if ((!webCache.hit || !webCache.payload) && env !== "production") {
            console.log(`[CATALOG_HOME] recipe_web_cache_fallback_to_production env=${env} correlationId=${correlationId}`);
            webCache = await readWebCache("production");
          }
        // Map tab keys to recipe keys — COMPLETE explicit map for safety
        const TAB_TO_RECIPE: Record<string, string> = {
          // Homepage
          all: "homepage",
          "": "homepage",
          // Exact recipe keys (explicit for safety)
          electronics: "electronics",
          vehicles: "vehicles",
          home_garden: "home_garden",
          toys: "toys",
          sporting_goods: "sporting_goods",
          jewelry_watches: "jewelry_watches",
          refurbished: "refurbished",
          parts_accessories: "parts_accessories",
          gaming: "gaming",
          phones: "phones",
          // Aliases (tab key differs from recipe key)
          clothing: "clothing",
          clothing_shoes_accessories: "clothing",
          // Legacy aliases (old frontend keys)
          home: "home_garden",
          fashion: "clothing",
          watches: "jewelry_watches",
          // Fallback aliases
          business_industrial: "electronics",
          // New homepage categories
          audio_music: "audio_music",
          beauty_health: "beauty_health",
          collectibles: "collectibles",
          shoes_sneakers: "shoes_sneakers",
          cameras_photo: "cameras_photo",
        };
        const recipeKeyFilter = TAB_TO_RECIPE[category] || category || "homepage";

        if (webCache.hit && webCache.payload && webCache.schemaVersion === recipeSettings.web_schema_version) {
            const payload = webCache.payload as Record<string, unknown>;
            const rawItems = withoutEbayClothing(payload.items as Array<Record<string, unknown>> || []);
            
            // Filter items by _recipeKey
            const allItems = rawItems.filter((item: Record<string, unknown>) => {
              const rk = item._recipeKey as string;
              if (!rk) return recipeKeyFilter === "homepage"; // untagged items default to homepage
              return rk === recipeKeyFilter;
            });
            
            // DIAGNOSTIC: log zero-match so mismatches are visible in logs
            if (allItems.length === 0) {
              console.warn(
                `[CATALOG_HOME] ZERO_MATCH category=${category} recipeKeyFilter=${recipeKeyFilter} ` +
                `totalRawItems=${rawItems.length} correlationId=${correlationId}`
              );
              // Fallback: serve homepage items instead of falling through to legacy cache
              const homepageFallbackItems = rawItems.filter((item: Record<string, unknown>) => {
                const rk = item._recipeKey as string;
                return !rk || rk === "homepage";
              });
              if (homepageFallbackItems.length > 0) {
                const totalPages = Math.ceil(homepageFallbackItems.length / pageSize) || 1;
                const offset = (page - 1) * pageSize;
                let pageItems = homepageFallbackItems.slice(offset, offset + pageSize);
                try { const ps = await loadPricingSettings(); pageItems = applyAllInclusivePricingToItems(pageItems as unknown as Record<string, unknown>[], ps) as typeof pageItems; } catch {}

                const langKey: "fr" | "en" = (locale === "en" ? "en" : "fr");
                let sections = [{
                  key: "featured",
                  title: langKey === "fr" ? "En vedette" : "Featured",
                  title_en: "Featured",
                  title_fr: "En vedette",
                  hideTitle: true,
                  items: pageItems,
                }];
                sections = normalizeSectionTitles(sections, langKey) as typeof sections;
                const totalMs = Date.now() - startTime;
                return jsonResponse({
                  ok: true,
                  sections,
                  page,
                  pageSize,
                  totalPages,
                  totalItems: homepageFallbackItems.length,
                  hasMore: true,
                  hasMoreCached: page < totalPages,
                  ttlSeconds: recipeSettings.web_refresh_hours * 3600,
                  correlationId,
                  meta: {
                    client: "web",
                    envUsed: env,
                    envRequested,
                    source: "recipe_cache_category_fallback",
                    categoryFallback: true,
                    originalCategory: category,
                    isStale: false,
                    correlationId,
                    ts: Date.now(),
                    totalMs,
                    schemaVersion: recipeSettings.web_schema_version,
                  },
                }, 200, { "X-Category-Fallback": "true" });
              }
            }

            if (allItems.length > 0) {
              const totalPages = Math.ceil(allItems.length / pageSize) || 1;
              const offset = (page - 1) * pageSize;
              let pageItems = allItems.slice(offset, offset + pageSize);
              try { const ps = await loadPricingSettings(); pageItems = applyAllInclusivePricingToItems(pageItems as unknown as Record<string, unknown>[], ps) as typeof pageItems; } catch {}

              const hasMoreCached = page < totalPages;
              const langKey: "fr" | "en" = (locale === "en" ? "en" : "fr");
              
              let sections = [{
                key: "featured",
                title: langKey === "fr" ? "En vedette" : "Featured",
                title_en: "Featured",
                title_fr: "En vedette",
                hideTitle: true,
                items: pageItems,
              }];
              sections = normalizeSectionTitles(sections, langKey) as typeof sections;
              
              const totalMs = Date.now() - startTime;
              console.log(`[CATALOG_HOME] recipe_web_cache_hit correlationId=${correlationId} poolSize=${allItems.length} page=${page}/${totalPages} items=${pageItems.length} ms=${totalMs}`);
              
              return jsonResponse({
                ok: true,
                sections,
                page,
                pageSize,
                totalPages,
                totalItems: allItems.length,
                hasMore: true,
                hasMoreCached,
                ttlSeconds: recipeSettings.web_refresh_hours * 3600,
                correlationId,
                meta: {
                  client: "web",
                  envUsed: env,
                  envRequested,
                  source: "recipe_cache",
                  isStale: false,
                  correlationId,
                  ts: Date.now(),
                  totalMs,
                  schemaVersion: recipeSettings.web_schema_version,
                },
              });
            }
          }
          
          // Stale web cache fallback
          if (!webCache.hit && webCache.payload) {
            const payload = webCache.payload as Record<string, unknown>;
            const rawStaleItems = payload.items as Array<Record<string, unknown>> || [];
            const allItems = rawStaleItems.filter((item: Record<string, unknown>) => {
              const rk = item._recipeKey as string;
              if (!rk) return recipeKeyFilter === "homepage";
              return rk === recipeKeyFilter;
            });
            if (allItems.length > 0) {
              console.log(`[CATALOG_HOME] recipe_web_cache_stale correlationId=${correlationId} serving_stale poolSize=${allItems.length}`);
              const totalPages = Math.ceil(allItems.length / pageSize) || 1;
              const offset = (page - 1) * pageSize;
              let pageItems = allItems.slice(offset, offset + pageSize);
              try { const ps = await loadPricingSettings(); pageItems = applyAllInclusivePricingToItems(pageItems as unknown as Record<string, unknown>[], ps) as typeof pageItems; } catch {}

              const langKey: "fr" | "en" = (locale === "en" ? "en" : "fr");
              
              let sections = [{
                key: "featured",
                title: langKey === "fr" ? "En vedette" : "Featured",
                title_en: "Featured",
                title_fr: "En vedette",
                hideTitle: true,
                items: pageItems,
              }];
              sections = normalizeSectionTitles(sections, langKey) as typeof sections;
              
              // Auto-rebuild disabled — admin controls homepage manually
              console.log(`[CATALOG_HOME] stale_web_cache_served_no_rebuild correlationId=${correlationId} (manual-only mode)`);
              
              return jsonResponse({
                ok: true,
                sections,
                page,
                pageSize,
                totalPages,
                totalItems: allItems.length,
                hasMore: true,
                hasMoreCached: page < totalPages,
                ttlSeconds: recipeSettings.web_refresh_hours * 3600,
                correlationId,
                meta: {
                  client: "web",
                  envUsed: env,
                  envRequested,
                  source: "recipe_cache_stale",
                  isStale: true,
                  correlationId,
                  ts: Date.now(),
                  schemaVersion: recipeSettings.web_schema_version,
                },
              });
            }
          }
        }
      } catch (recipeCacheErr) {
        console.warn(`[CATALOG_HOME] recipe_cache_error: ${recipeCacheErr} — falling through to legacy`);
      }
    }

    // ===== LEGACY FALLBACK (existing 3-tier logic) =====
    let settings: FeedSettings;
    try {
      settings = await loadFeedSettings();
    } catch {
      settings = {
        poolSize: DEFAULT_POOL_SIZE,
        pageSize: DEFAULT_PAGE_SIZE,
        ttlSeconds: DEFAULT_TTL_SECONDS,
        mobileTtlSeconds: 1800,
        enabled: true,
      };
    }

    if (!settings.enabled) {
      console.log(`[CATALOG_HOME] correlationId=${correlationId} feed_disabled`);
      if (clientType === "mobile") {
        return buildMobileSectionsResponse([], locale, correlationId, "disabled", false, env, envRequested, detectedBy);
      }
      // WEB: Normalized sections even when disabled
      let sections = [{ key: "featured", title: locale === "fr" ? "En vedette" : "Featured", title_en: "Featured", title_fr: "En vedette", hideTitle: true, items: [] }];
      sections = normalizeSectionTitles(sections, locale === "en" ? "en" : "fr") as typeof sections;
      return jsonResponse({
        ok: true,
        sections,
        page,
        pageSize,
        totalPages: 0,
        correlationId,
        meta: { client: clientType, source: "disabled", schemaVersion: CACHE_SCHEMA_VERSION }
      });
    }

    // ===== 3-TIER FALLBACK STRATEGY =====
    // TIER 1: Fresh cache
    // TIER 2: Stale cache
    // TIER 3: DB bootstrap (for mobile, ensures NEVER "Catalogue Indisponible")
    
    let cached: CacheEntry | null = null;
    let isStale = false;
    let cacheEnvUsed = env;
    
    try {
      const cacheResult = await getCachedFeedWithStale(env, category);
      cached = cacheResult.cache;
      isStale = cacheResult.isStale;
      
      // Fallback to production cache if requested env has no data
      if ((!cached || !cached.items || cached.items.length === 0) && env !== "production") {
        console.log(`[CATALOG_HOME] cache_fallback_to_production correlationId=${correlationId} envRequested=${envRequested} reason=no_cache_for_env`);
        const prodCacheResult = await getCachedFeedWithStale("production", category);
        if (prodCacheResult.cache && prodCacheResult.cache.items && prodCacheResult.cache.items.length > 0) {
          cached = prodCacheResult.cache;
          isStale = prodCacheResult.isStale;
          cacheEnvUsed = "production";
          console.log(`[CATALOG_HOME] cache_fallback_success correlationId=${correlationId} prodItems=${cached.items.length}`);
        }
      }
    } catch (cacheErr) {
      console.warn(`[CATALOG_HOME] Cache read failed: ${cacheErr}`);
    }
    
    // ===== TIER 1 & 2: Serve from cache (fresh or stale) =====
    if (cached && cached.items && cached.items.length > 0 && !forceLive) {
      const actualTotalPages = Math.ceil(cached.items.length / pageSize);
      
      if (page <= actualTotalPages) {
        const offset = (page - 1) * pageSize;
        let pageItems = cached.items.slice(offset, offset + pageSize);
        // Apply all-inclusive pricing for web clients
        try {
          const pSettings = await loadPricingSettings();
          pageItems = applyAllInclusivePricingToItems(pageItems as unknown as Record<string, unknown>[], pSettings) as typeof pageItems;
        } catch (e) { console.error(`[CATALOG_HOME] pricing transform error:`, e); }
        const hasMoreCached = page < actualTotalPages;
        
        console.log(`[CATALOG_HOME] cache_hit correlationId=${correlationId} client=${clientType} isStale=${isStale} poolSize=${cached.items.length} page=${page}/${actualTotalPages} returning=${pageItems.length} cacheEnvUsed=${cacheEnvUsed}`);
        
        // MOBILE: Multi-section response with normalized titles
        if (clientType === "mobile") {
          return await buildMobileSectionsResponse(cached.items, locale, correlationId, isStale ? "stale-cache" : "cache", isStale, cacheEnvUsed, envRequested, detectedBy, settings.mobileTtlSeconds);
        }
        
        // WEB: Single feed with normalized title
        let sections = [{
          key: "featured",
          title: locale === "fr" ? "En vedette" : "Featured",
          title_en: "Featured",
          title_fr: "En vedette",
          hideTitle: true,
          items: pageItems,
        }];
        sections = normalizeSectionTitles(sections, locale === "en" ? "en" : "fr") as typeof sections;
        
        return jsonResponse({
          ok: true,
          sections,
          page,
          pageSize,
          totalPages: actualTotalPages,
          totalItems: cached.items.length,
          hasMore: true,
          hasMoreCached,
          ttlSeconds: settings.ttlSeconds,
          correlationId,
          meta: {
            client: "web",
            envUsed: cacheEnvUsed,
            envRequested,
            source: isStale ? "stale-cache" : "cache",
            isStale,
            correlationId,
            ts: Date.now(),
            schemaVersion: CACHE_SCHEMA_VERSION,
          }
        });
      }
    }

    // ===== TIER 3: DB BOOTSTRAP (CRITICAL FOR MOBILE) =====
    // If cache is empty and we're mobile, bootstrap from DB to prevent "Catalogue Indisponible"
    if (clientType === "mobile" && (!cached || !cached.items || cached.items.length === 0)) {
      console.log(`[CATALOG_HOME] tier3_bootstrap correlationId=${correlationId} reason=cache_empty_for_mobile`);
      
      const bootstrapItems = await bootstrapFromDatabase(correlationId);
      
      if (bootstrapItems.length > 0) {
        // Save bootstrap as last-known-good cache
        try {
          await saveCachedFeed(env, category, bootstrapItems, 3600, { source: "bootstrap_db" });
        } catch {
          // Ignore save errors
        }
        
        return await buildMobileSectionsResponse(bootstrapItems, locale, correlationId, "bootstrap_db", true, cacheEnvUsed, envRequested, detectedBy, settings.mobileTtlSeconds);
      }
      
      // Even if bootstrap fails, return empty sections with ok:true
      // This prevents "Catalogue Indisponible"
      console.log(`[CATALOG_HOME] bootstrap_empty correlationId=${correlationId} returning_empty_sections_with_ok_true`);
      return await buildMobileSectionsResponse([], locale, correlationId, "bootstrap_empty", true, cacheEnvUsed, envRequested, detectedBy, settings.mobileTtlSeconds);
    }

    // ===== LIVE MODE: Either forceLive or cache exhausted =====
    if (forceLive || page > Math.ceil((cached?.items?.length || 0) / pageSize)) {
      console.log(`[CATALOG_HOME] live_mode correlationId=${correlationId} page=${page} reason=${forceLive ? "force_live" : "cache_exhausted"}`);
      
      let liveItems: CatalogItem[] = [];
      try {
        const ebayToken = await getEbayToken();
        liveItems = await fetchLiveItems(page, pageSize, amazonDomain, ebayToken, correlationId);
      } catch (liveErr) {
        console.warn(`[CATALOG_HOME] Live fetch failed: ${liveErr}`);
      }
      
      if (clientType === "mobile") {
        return await buildMobileSectionsResponse(liveItems, locale, correlationId, "live", false, env, envRequested, detectedBy, settings.mobileTtlSeconds);
      }
      
      // WEB: Normalized sections
      let sections = [{
        key: "featured",
        title: locale === "fr" ? "En vedette" : "Featured",
        title_en: "Featured",
        title_fr: "En vedette",
        hideTitle: true,
        items: liveItems,
      }];
      sections = normalizeSectionTitles(sections, locale === "en" ? "en" : "fr") as typeof sections;
      
      return jsonResponse({
        ok: true,
        sections,
        page,
        pageSize,
        totalPages: 0,
        totalItems: liveItems.length,
        hasMore: liveItems.length >= pageSize,
        hasMoreCached: false,
        correlationId,
        meta: {
          client: "web",
          source: "live",
          page,
          schemaVersion: CACHE_SCHEMA_VERSION,
        }
      });
    }

    // ===== CACHE MISS: Build fresh feed =====
    console.log(`[CATALOG_HOME] cache_miss correlationId=${correlationId} building_feed...`);

    let items: CatalogItem[] = [];
    let segmentCounts: Record<string, number> = {};
    let buildMs = 0;
    let shortfall = false;
    
    try {
      const ebayToken = await getEbayToken();
      
      const buildResult = await buildFullFeed(
        settings,
        correlationId,
        amazonDomain,
        ebayToken
      );
      
      items = buildResult.items;
      segmentCounts = buildResult.segmentCounts;
      buildMs = buildResult.ms;
      shortfall = buildResult.shortfall;
    } catch (buildErr) {
      console.error(`[CATALOG_HOME][ERROR] Build failed: ${buildErr}`);
      
      // For mobile, try bootstrap
      if (clientType === "mobile") {
        const bootstrapItems = await bootstrapFromDatabase(correlationId);
        return await buildMobileSectionsResponse(bootstrapItems, locale, correlationId, "bootstrap_build_failed", true, env, envRequested, detectedBy, settings.mobileTtlSeconds);
      }
      
      // For web, return empty with normalized sections
      let sections = [{ key: "featured", title: locale === "fr" ? "En vedette" : "Featured", title_en: "Featured", title_fr: "En vedette", hideTitle: true, items: [] }];
      sections = normalizeSectionTitles(sections, locale === "en" ? "en" : "fr") as typeof sections;
      return jsonResponse({
        ok: false,
        sections,
        page,
        pageSize,
        totalPages: 0,
        correlationId,
        error: String(buildErr),
        meta: { source: "error", schemaVersion: CACHE_SCHEMA_VERSION }
      });
    }

    // Save to cache with schema version
    try {
      saveCachedFeed(env, category, items, settings.ttlSeconds, { 
        segmentCounts,
        total: items.length,
        buildMs,
        shortfall,
      });
    } catch {
      // Ignore save errors
    }

    // Respond
    if (clientType === "mobile") {
      return await buildMobileSectionsResponse(items, locale, correlationId, "fresh_build", false, env, envRequested, detectedBy, settings.mobileTtlSeconds);
    }

    const offset = (page - 1) * pageSize;
    let pageItems = items.slice(offset, offset + pageSize);
    // Apply all-inclusive pricing for web clients
    try {
      const pSettings = await loadPricingSettings();
      pageItems = applyAllInclusivePricingToItems(pageItems as unknown as Record<string, unknown>[], pSettings) as typeof pageItems;
    } catch (e) { console.error(`[CATALOG_HOME] pricing transform error:`, e); }
    const actualTotalPages = Math.ceil(items.length / pageSize);

    const totalMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME] success correlationId=${correlationId} returned=${pageItems.length} poolSize=${items.length} page=${page}/${actualTotalPages} totalMs=${totalMs}`);

    // WEB: Normalized sections
    let sections = [{
      key: "featured",
      title: locale === "fr" ? "En vedette" : "Featured",
      title_en: "Featured",
      title_fr: "En vedette",
      hideTitle: true,
      items: pageItems,
    }];
    sections = normalizeSectionTitles(sections, locale === "en" ? "en" : "fr") as typeof sections;

    return jsonResponse({
      ok: true,
      sections,
      page,
      pageSize,
      totalPages: actualTotalPages,
      totalItems: items.length,
      hasMore: true,
      hasMoreCached: page < actualTotalPages,
      ttlSeconds: settings.ttlSeconds,
      correlationId,
      meta: {
        client: "web",
        source: "fresh_build",
        buildMs,
        segmentCounts,
        schemaVersion: CACHE_SCHEMA_VERSION,
      }
    });
  } catch (err) {
    // CRITICAL: This catch block ensures we NEVER throw
    const totalMs = Date.now() - startTime;
    console.error(`[CATALOG_HOME][ERROR] correlationId=${correlationId} error=${(err as Error).message} ms=${totalMs}`);
    
    // For mobile: ALWAYS return ok:true with normalized empty sections
    if (clientType === "mobile") {
      console.log(`[CATALOG_HOME][FAILSAFE] returning empty 8-section ok:true correlationId=${correlationId}`);
      return await buildMobileSectionsResponse([], lang, correlationId, "error_fallback", true, env, envRequested, detectedBy);
    }
    
    // For web: Return proper structure with ok:false but HTTP 200, with normalized sections
    let sections = [{
      key: "featured",
      title: lang === "fr" ? "En vedette" : "Featured",
      title_en: "Featured",
      title_fr: "En vedette",
      hideTitle: true,
      items: [],
    }];
    sections = normalizeSectionTitles(sections, lang) as typeof sections;
    
    return jsonResponse({
      ok: false,
      sections,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalPages: 0,
      correlationId,
      error: String(err),
      meta: {
        source: "error",
        totalMs,
        schemaVersion: CACHE_SCHEMA_VERSION,
      }
    });
  }
});
