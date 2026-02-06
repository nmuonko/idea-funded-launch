import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { 
  normalizeSectionTitles, 
  getResponseLanguage, 
  calculateTotalItems,
  CACHE_SCHEMA_VERSION,
  TITLE_MAP,
  nonEmpty
} from "../_shared/titleNormalizer.ts";

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

// Enhanced CORS headers - support ALL mobile headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-afrishop-client, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type, x-correlation-id, x-env-used",
};

// ===== CLIENT DETECTION =====
type ClientType = "mobile" | "web";

interface DetectionResult {
  clientType: ClientType;
  detectedBy: string;
}

/**
 * Detect if client is mobile (React Native / Expo) or web
 * DETERMINISTIC: x-device-id is PRIMARY indicator
 * ROBUST: Treat as mobile if ANY mobile indicator is present
 */
function detectClientType(req: Request): DetectionResult {
  const h = req.headers;
  
  // PRIMARY: x-device-id header (most reliable for mobile app)
  const deviceId = h.get("x-device-id") || h.get("X-Device-Id") || "";
  if (deviceId && deviceId.trim().length > 0) {
    return { clientType: "mobile", detectedBy: "x-device-id" };
  }
  
  // SECONDARY: Platform header
  const platform = (h.get("x-supabase-client-platform") || h.get("X-Supabase-Client-Platform") || "").toLowerCase();
  if (platform.includes("android") || platform.includes("ios")) {
    return { clientType: "mobile", detectedBy: "platform" };
  }
  
  // TERTIARY: User-Agent patterns
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
  
  // QUATERNARY: Client info headers
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
  
  // QUINARY: AfriShop client header
  const afrishopClient = (h.get("x-afrishop-client") || h.get("X-Afrishop-Client") || "").toLowerCase();
  if (afrishopClient.includes("mobile")) {
    return { clientType: "mobile", detectedBy: "afrishop-client" };
  }
  
  // Default: Web
  return { clientType: "web", detectedBy: "none" };
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
  { key: "home_garden", title_fr: "Maison et Jardin", title_en: "Home & Garden", keywords: ["sofa", "table", "chair", "furniture", "kitchen", "decor", "garden", "home", "bed", "lamp"], target: 20 },
  { key: "toys", title_fr: "Jouets", title_en: "Toys", keywords: ["lego", "doll", "toy", "barbie", "figure", "puzzle", "kids", "children"], target: 20 },
  { key: "sporting_goods", title_fr: "Articles de Sport", title_en: "Sporting Goods", keywords: ["basketball", "football", "soccer", "yoga", "fitness", "gym", "running", "sports", "exercise", "tennis"], target: 20 },
];

// Default settings (overridden by admin_settings)
const DEFAULT_POOL_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TTL_SECONDS = 172800; // 2 days

interface FeedSettings {
  poolSize: number;
  pageSize: number;
  ttlSeconds: number;
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
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
  let envUsed = envRequested;
  
  if (envUsed === "prod") {
    envUsed = "production";
  }
  
  if (envUsed !== "production" && envUsed !== "staging" && envUsed !== "dev") {
    envUsed = "production";
  }
  
  return { envRequested, envUsed };
}

/**
 * Build mobile sections from a pool of items
 * Groups items by keyword matching OR distributes evenly
 */
function buildMobileSectionsFromPool(
  items: CatalogItem[], 
  lang: "fr" | "en"
): Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }> {
  const sections: Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }> = [];
  
  // If no items, still return 8 empty sections (mobile expects this structure)
  if (!items || items.length === 0) {
    for (const mobileSec of MOBILE_SECTIONS) {
      sections.push({
        key: mobileSec.key,
        title: lang === "fr" ? mobileSec.title_fr : mobileSec.title_en,
        title_fr: mobileSec.title_fr,
        title_en: mobileSec.title_en,
        items: [],
      });
    }
    return sections;
  }
  
  // Try to match items to sections by keywords
  const usedItems = new Set<string>();
  
  for (const mobileSec of MOBILE_SECTIONS) {
    const sectionItems: CatalogItem[] = [];
    
    // Find items matching this section's keywords
    for (const item of items) {
      if (usedItems.has(item.id)) continue;
      if (sectionItems.length >= mobileSec.target) break;
      
      const titleLower = (item.title || "").toLowerCase();
      const matchesKeyword = mobileSec.keywords.some(kw => titleLower.includes(kw));
      
      if (matchesKeyword) {
        sectionItems.push(item);
        usedItems.add(item.id);
      }
    }
    
    sections.push({
      key: mobileSec.key,
      title: lang === "fr" ? mobileSec.title_fr : mobileSec.title_en,
      title_fr: mobileSec.title_fr,
      title_en: mobileSec.title_en,
      items: sectionItems,
    });
  }
  
  // If most sections are empty, redistribute items evenly
  const sectionsWithItems = sections.filter(s => s.items.length > 0);
  if (sectionsWithItems.length < 3 && items.length > 0) {
    // Clear and redistribute
    sections.length = 0;
    const itemsPerSection = Math.ceil(items.length / MOBILE_SECTIONS.length);
    let offset = 0;
    
    for (const mobileSec of MOBILE_SECTIONS) {
      const sectionItems = items.slice(offset, offset + Math.min(itemsPerSection, mobileSec.target));
      offset += itemsPerSection;
      
      sections.push({
        key: mobileSec.key,
        title: lang === "fr" ? mobileSec.title_fr : mobileSec.title_en,
        title_fr: mobileSec.title_fr,
        title_en: mobileSec.title_en,
        items: sectionItems,
      });
    }
  }
  
  return sections;
}

/**
 * Build GUARANTEED mobile sections response with title normalization
 * ALWAYS returns ok:true with 8 sections (even if items are empty)
 * This PREVENTS "Catalogue Indisponible" on mobile
 */
function buildMobileSectionsResponse(
  items: CatalogItem[],
  locale: string,
  correlationId: string,
  source: string,
  isStale: boolean,
  envUsed: string,
  envRequested: string,
  detectedBy: string = "unknown"
): Response {
  const lang: "fr" | "en" = locale === "en" ? "en" : "fr";
  let sections = buildMobileSectionsFromPool(items, lang);
  
  // CRITICAL: Normalize titles RIGHT BEFORE returning
  // This ensures section.title is NEVER "" (empty string)
  sections = normalizeSectionTitles(sections, lang) as typeof sections;
  
  const totalItems = calculateTotalItems(sections);
  
  console.log(`[CATALOG_HOME] mobile_response correlationId=${correlationId} source=${source} detectedBy=${detectedBy} sections=${sections.length} totalItems=${totalItems}`);
  
  // CRITICAL: ALWAYS ok:true for mobile to prevent "Catalogue Indisponible"
  return jsonResponse({
    ok: true, // ALWAYS TRUE FOR MOBILE
    sections,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    totalItems,
    hasMore: false,
    hasMoreCached: false,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    correlationId,
    meta: {
      client: "mobile",
      detectedBy,
      envUsed,
      envRequested,
      source,
      isStale,
      correlationId,
      ts: Date.now(),
      schemaVersion: CACHE_SCHEMA_VERSION,
    }
  });
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
      enabled: true,
    };
  }

  try {
    const keys = [
      "home_feed_pool_size",
      "home_feed_page_size",
      "home_feed_ttl_seconds",
      "home_feed_limit",
      "home_feed_enabled"
    ];
    
    const res = await fetch(
      `${supabaseUrl}/rest/v1/admin_settings?key=in.(${keys.map(k => `"${k}"`).join(",")})`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!res.ok) {
      console.warn(`[CATALOG_HOME] Failed to load settings: ${res.status}`);
      return {
        poolSize: DEFAULT_POOL_SIZE,
        pageSize: DEFAULT_PAGE_SIZE,
        ttlSeconds: DEFAULT_TTL_SECONDS,
        enabled: true,
      };
    }

    const rows = await res.json() as Array<{ key: string; value: string }>;
    const settingsMap = new Map(rows.map(r => [r.key, r.value]));

    const poolSize = parseInt(settingsMap.get("home_feed_pool_size") || settingsMap.get("home_feed_limit") || "") || DEFAULT_POOL_SIZE;

    return {
      poolSize,
      pageSize: parseInt(settingsMap.get("home_feed_page_size") || "") || DEFAULT_PAGE_SIZE,
      ttlSeconds: parseInt(settingsMap.get("home_feed_ttl_seconds") || "") || DEFAULT_TTL_SECONDS,
      enabled: settingsMap.get("home_feed_enabled") !== "false",
    };
  } catch (err) {
    console.warn(`[CATALOG_HOME] Settings load error: ${err}`);
    return {
      poolSize: DEFAULT_POOL_SIZE,
      pageSize: DEFAULT_PAGE_SIZE,
      ttlSeconds: DEFAULT_TTL_SECONDS,
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
        // Check schema version - treat old schema as cache miss
        const schemaVersion = data.meta?.schemaVersion || data.schema_version || 1;
        if (schemaVersion !== CACHE_SCHEMA_VERSION) {
          console.log(`[CATALOG_HOME] cache_schema_mismatch key=${cacheKey} cacheVersion=${schemaVersion} required=${CACHE_SCHEMA_VERSION}`);
          // Continue to try stale or return null
        } else {
          return { cache: data as CacheEntry, isStale: false };
        }
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
        // Check schema version for stale cache too
        const schemaVersion = data.meta?.schemaVersion || data.schema_version || 1;
        if (schemaVersion !== CACHE_SCHEMA_VERSION) {
          console.log(`[CATALOG_HOME] stale_cache_schema_mismatch key=${cacheKey} cacheVersion=${schemaVersion} required=${CACHE_SCHEMA_VERSION}`);
          return { cache: null, isStale: false };
        }
        console.log(`[CATALOG_HOME] stale_cache_available key=${cacheKey} items=${data.items.length} expired_at=${data.expires_at}`);
        return { cache: data as CacheEntry, isStale: true };
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
      `${supabaseUrl}/rest/v1/catalog_items?provider=in.(amazon,ebay)&price_usd=gt.0&image_url=neq.null&is_disallowed=eq.false&order=updated_at.desc.nullslast,created_at.desc&limit=300`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!res.ok) {
      console.error(`[CATALOG_HOME][BOOTSTRAP] DB fetch failed: ${res.status}`);
      return [];
    }

    const rows = await res.json() as Array<Record<string, unknown>>;
    
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
      image_url: row.image_url as string | null,
      imageUrl: row.image_url as string | null,
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
  const imageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || null;
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
  const imageUrl = item.image as string || (item.main_image as Record<string, unknown>)?.link as string || null;
  
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
      .filter((i: CatalogItem | null): i is CatalogItem => i !== null && !!i.title && !!i.image_url);
    
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
  
  // CORS preflight - ALWAYS handle first with proper headers
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

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
    let amazonDomain = "amazon.com";
    let forceLive = false;
    let locale = lang;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        page = parseInt(body.page) || 1;
        category = body.category || "";
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
      amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
      locale = url.searchParams.get("locale") || url.searchParams.get("lang") || lang;
      forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("source") === "live";
    }

    console.log(`[CATALOG_HOME] start correlationId=${correlationId} client=${clientType} detectedBy=${detectedBy} lang=${lang} envRequested=${envRequested} envUsed=${env} page=${page} pageSize=${pageSize} category=${category} forceLive=${forceLive} locale=${locale}`);

    // Load settings
    let settings: FeedSettings;
    try {
      settings = await loadFeedSettings();
    } catch {
      settings = {
        poolSize: DEFAULT_POOL_SIZE,
        pageSize: DEFAULT_PAGE_SIZE,
        ttlSeconds: DEFAULT_TTL_SECONDS,
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
        const pageItems = cached.items.slice(offset, offset + pageSize);
        const hasMoreCached = page < actualTotalPages;
        
        console.log(`[CATALOG_HOME] cache_hit correlationId=${correlationId} client=${clientType} isStale=${isStale} poolSize=${cached.items.length} page=${page}/${actualTotalPages} returning=${pageItems.length} cacheEnvUsed=${cacheEnvUsed}`);
        
        // MOBILE: Multi-section response with normalized titles
        if (clientType === "mobile") {
          return buildMobileSectionsResponse(cached.items, locale, correlationId, isStale ? "stale-cache" : "cache", isStale, cacheEnvUsed, envRequested, detectedBy);
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
        
        return buildMobileSectionsResponse(bootstrapItems, locale, correlationId, "bootstrap_db", true, cacheEnvUsed, envRequested, detectedBy);
      }
      
      // Even if bootstrap fails, return empty sections with ok:true
      // This prevents "Catalogue Indisponible"
      console.log(`[CATALOG_HOME] bootstrap_empty correlationId=${correlationId} returning_empty_sections_with_ok_true`);
      return buildMobileSectionsResponse([], locale, correlationId, "bootstrap_empty", true, cacheEnvUsed, envRequested, detectedBy);
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
        return buildMobileSectionsResponse(liveItems, locale, correlationId, "live", false, env, envRequested, detectedBy);
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
        return buildMobileSectionsResponse(bootstrapItems, locale, correlationId, "bootstrap_build_failed", true, env, envRequested, detectedBy);
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
      return buildMobileSectionsResponse(items, locale, correlationId, "fresh_build", false, env, envRequested, detectedBy);
    }

    const offset = (page - 1) * pageSize;
    const pageItems = items.slice(offset, offset + pageSize);
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
    console.error(`[CATALOG_HOME][ERROR] correlationId=${correlationId} error=${err} stack=${(err as Error).stack} ms=${totalMs}`);
    
    // For mobile: ALWAYS return ok:true with normalized empty sections
    if (clientType === "mobile") {
      return buildMobileSectionsResponse([], lang, correlationId, "error_fallback", true, env, envRequested, detectedBy);
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
