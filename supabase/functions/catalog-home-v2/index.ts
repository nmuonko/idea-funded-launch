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
 * catalog-home-v2 - Single unified homepage feed with cache-first loading
 * 
 * PRODUCTION HOTFIX: This function is designed to NEVER fail:
 * - Always returns HTTP 200 with proper CORS
 * - Uses 3-tier fallback: Cache → Stale Cache → DB Bootstrap
 * - Mobile ALWAYS gets ok:true with 8 sections to prevent "Catalogue Indisponible"
 * - Title normalization runs RIGHT BEFORE returning to guarantee no empty titles
 * 
 * Web: Single "featured" section (paged at 100)
 * Mobile: 8 sections with localized titles
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

// Mobile section definitions
interface MobileSectionDef {
  key: string;
  title_fr: string;
  title_en: string;
  keywords: string[];
  target: number;
}

// EXACT SECTIONS EXPECTED BY MOBILE APP
const MOBILE_SECTION_DEFS: MobileSectionDef[] = [
  { key: "phones", title_fr: "Téléphones", title_en: "Phones", keywords: ["iphone", "samsung", "galaxy", "pixel", "phone", "smartphone", "android", "mobile", "unlocked"], target: 20 },
  { key: "electronics", title_fr: "Électronique", title_en: "Electronics", keywords: ["airpods", "headphones", "earbuds", "speaker", "tv", "camera", "tablet", "laptop", "audio", "bluetooth", "charger", "monitor"], target: 20 },
  { key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", keywords: ["toyota", "honda", "bmw", "ford", "mercedes", "car", "truck", "suv", "vehicle", "auto", "motorcycle"], target: 20 },
  { key: "video_games", title_fr: "Jeux Vidéo", title_en: "Video Games", keywords: ["ps5", "xbox", "nintendo", "switch", "playstation", "console", "controller", "gaming", "game"], target: 20 },
  { key: "clothing_fashion", title_fr: "Vêtements et Mode", title_en: "Clothing & Fashion", keywords: ["nike", "adidas", "jordan", "shoes", "sneakers", "jacket", "hoodie", "dress", "jeans", "shirt"], target: 20 },
  { key: "home_garden", title_fr: "Maison et Jardin", title_en: "Home & Garden", keywords: ["sofa", "table", "chair", "furniture", "kitchen", "decor", "garden", "home", "bed", "lamp"], target: 20 },
  { key: "toys", title_fr: "Jouets", title_en: "Toys", keywords: ["lego", "doll", "toy", "barbie", "figure", "puzzle", "kids", "children"], target: 20 },
  { key: "sporting_goods", title_fr: "Articles de Sport", title_en: "Sporting Goods", keywords: ["basketball", "football", "soccer", "yoga", "fitness", "gym", "running", "sports", "exercise", "tennis"], target: 20 },
];

// ===== CONSTANTS =====
const DEFAULT_POOL_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TTL_SECONDS = 1800;

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
  return `chv2_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

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
 */
function buildMobileSectionsFromPool(
  items: CatalogItem[], 
  lang: "fr" | "en"
): Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }> {
  const sections: Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }> = [];
  
  // Always return 8 sections structure
  if (!items || items.length === 0) {
    for (const def of MOBILE_SECTION_DEFS) {
      sections.push({
        key: def.key,
        title: lang === "fr" ? def.title_fr : def.title_en,
        title_fr: def.title_fr,
        title_en: def.title_en,
        items: [],
      });
    }
    return sections;
  }
  
  const usedItems = new Set<string>();
  
  for (const def of MOBILE_SECTION_DEFS) {
    const sectionItems: CatalogItem[] = [];
    
    for (const item of items) {
      if (usedItems.has(item.id)) continue;
      if (sectionItems.length >= def.target) break;
      
      const titleLower = (item.title || "").toLowerCase();
      const matchesKeyword = def.keywords.some(kw => titleLower.includes(kw));
      
      if (matchesKeyword) {
        sectionItems.push(item);
        usedItems.add(item.id);
      }
    }
    
    sections.push({
      key: def.key,
      title: lang === "fr" ? def.title_fr : def.title_en,
      title_fr: def.title_fr,
      title_en: def.title_en,
      items: sectionItems,
    });
  }
  
  // Redistribute if most sections empty
  const sectionsWithItems = sections.filter(s => s.items.length > 0);
  if (sectionsWithItems.length < 3 && items.length > 0) {
    sections.length = 0;
    const itemsPerSection = Math.ceil(items.length / MOBILE_SECTION_DEFS.length);
    let offset = 0;
    
    for (const def of MOBILE_SECTION_DEFS) {
      const sectionItems = items.slice(offset, offset + Math.min(itemsPerSection, def.target));
      offset += itemsPerSection;
      
      sections.push({
        key: def.key,
        title: lang === "fr" ? def.title_fr : def.title_en,
        title_fr: def.title_fr,
        title_en: def.title_en,
        items: sectionItems,
      });
    }
  }
  
  return sections;
}

/**
 * Build GUARANTEED mobile sections response with title normalization
 * ALWAYS returns ok:true with 8 sections to prevent "Catalogue Indisponible"
 */
function buildMobileSectionsResponse(
  items: CatalogItem[],
  lang: "fr" | "en",
  correlationId: string,
  source: string,
  isStale: boolean,
  envUsed: string,
  envRequested: string,
  detectedBy: string = "unknown"
): Response {
  let sections = buildMobileSectionsFromPool(items, lang);
  
  // CRITICAL: Normalize titles RIGHT BEFORE returning
  // This ensures section.title is NEVER "" (empty string)
  sections = normalizeSectionTitles(sections, lang) as typeof sections;
  
  const totalItems = calculateTotalItems(sections);
  
  console.log(`[CATALOG_HOME_V2] mobile_response correlationId=${correlationId} source=${source} detectedBy=${detectedBy} sections=${sections.length} totalItems=${totalItems}`);
  
  // ALWAYS ok:true for mobile to prevent "Catalogue Indisponible"
  return jsonResponse({
    ok: true,
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

/**
 * TIER 1 & 2: Get cached feed with stale fallback
 * Now includes schema version validation
 */
async function getCachedFeedWithStale(env: string, key = "all"): Promise<{ cache: CacheEntry | null; isStale: boolean }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return { cache: null, isStale: false };

  const cacheKey = `${env}:${key}`;

  try {
    // Fresh cache
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
          console.log(`[CATALOG_HOME_V2] cache_schema_mismatch key=${cacheKey} cacheVersion=${schemaVersion} required=${CACHE_SCHEMA_VERSION}`);
          // Continue to try stale or return null - don't use mismatched schema
        } else {
          return { cache: data as CacheEntry, isStale: false };
        }
      }
    }

    // Stale cache
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
          console.log(`[CATALOG_HOME_V2] stale_cache_schema_mismatch key=${cacheKey} cacheVersion=${schemaVersion} required=${CACHE_SCHEMA_VERSION}`);
          return { cache: null, isStale: false };
        }
        console.log(`[CATALOG_HOME_V2] stale_cache_available key=${cacheKey} items=${data.items.length}`);
        return { cache: data as CacheEntry, isStale: true };
      }
    }

    return { cache: null, isStale: false };
  } catch (err) {
    console.warn(`[CATALOG_HOME_V2] Cache read error: ${err}`);
    return { cache: null, isStale: false };
  }
}

/**
 * TIER 3: Bootstrap from database (CRITICAL SAFETY NET)
 */
async function bootstrapFromDatabase(correlationId: string): Promise<CatalogItem[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`[CATALOG_HOME_V2][BOOTSTRAP] Missing env vars`);
    return [];
  }

  try {
    console.log(`[CATALOG_HOME_V2][BOOTSTRAP] correlationId=${correlationId} fetching from catalog_items`);
    
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
      console.error(`[CATALOG_HOME_V2][BOOTSTRAP] DB fetch failed: ${res.status}`);
      return [];
    }

    const rows = await res.json() as Array<Record<string, unknown>>;
    
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn(`[CATALOG_HOME_V2][BOOTSTRAP] No items found`);
      return [];
    }

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

    console.log(`[CATALOG_HOME_V2][BOOTSTRAP] correlationId=${correlationId} source=bootstrap_db itemsTotal=${items.length}`);
    
    return items;
  } catch (err) {
    console.error(`[CATALOG_HOME_V2][BOOTSTRAP] Exception: ${err}`);
    return [];
  }
}

async function getEbayToken(): Promise<string | null> {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60000) {
    return ebayTokenCache.token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[CATALOG_HOME_V2] Missing EBAY credentials");
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
      console.error(`[CATALOG_HOME_V2] eBay OAuth error: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json();
    ebayTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };
    return ebayTokenCache.token;
  } catch (err) {
    console.error(`[CATALOG_HOME_V2] eBay OAuth exception: ${err}`);
    return null;
  }
}

function extractPriceFromItem(item: Record<string, unknown>): number | null {
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

function mapEbayItem(item: Record<string, unknown>): CatalogItem | null {
  const priceUsd = extractPriceFromItem(item);
  const imageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || null;
  const productUrl = (item.itemWebUrl as string) || null;
  const priceObj = item.price as Record<string, unknown> | undefined;
  const itemId = item.itemId as string || "";
  
  if (!isValidEbayId(itemId)) {
    return null;
  }
  
  return {
    id: `ebay_${itemId}`,
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
  };
}

async function fetchEbayItems(
  query: string,
  limit: number,
  ebayToken: string,
  correlationId: string
): Promise<CatalogItem[]> {
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
      console.error(`[CATALOG_HOME_V2] eBay fetch error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawItems = data.itemSummaries || [];
    return rawItems
      .map(mapEbayItem)
      .filter((i: CatalogItem | null): i is CatalogItem => i !== null && !!i.title && !!i.image_url);
  } catch (err) {
    console.error(`[CATALOG_HOME_V2] eBay fetch exception: ${err}`);
    return [];
  }
}

serve(async (req) => {
  const correlationId = generateCorrelationId();
  
  // CORS preflight
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
  
  console.log(`[CATALOG_HOME_V2] start correlationId=${correlationId} client=${clientType} detectedBy=${detectedBy} lang=${lang} envRequested=${envRequested} envUsed=${env}`);

  // Wrap EVERYTHING in try/catch
  try {
    let locale = lang;
    let pageSize = clientType === "mobile" ? 20 : DEFAULT_PAGE_SIZE;
    let page = 1;
    let forceLive = false;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        locale = body.locale || lang;
        page = Math.max(1, parseInt(body.page, 10) || 1);
        forceLive = body.live === true || body.live === "1";
        
        if (body.env) {
          const bodyEnv = body.env.toLowerCase().trim();
          env = bodyEnv === "prod" ? "production" : (["production", "staging", "dev"].includes(bodyEnv) ? bodyEnv : "production");
        }
      } catch {
        // Defaults
      }
    } else {
      const url = new URL(req.url);
      locale = url.searchParams.get("locale") || url.searchParams.get("lang") || lang;
      page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("live") === "true";
    }

    console.log(`[CATALOG_HOME_V2] correlationId=${correlationId} client=${clientType} locale=${locale} page=${page} forceLive=${forceLive}`);

    // ===== 3-TIER FALLBACK =====
    let cached: CacheEntry | null = null;
    let isStale = false;
    let cacheEnvUsed = env;
    
    try {
      const cacheResult = await getCachedFeedWithStale(env, "all");
      cached = cacheResult.cache;
      isStale = cacheResult.isStale;
      
      // Fallback to production
      if ((!cached || !cached.items || cached.items.length === 0) && env !== "production") {
        console.log(`[CATALOG_HOME_V2] cache_fallback_to_production correlationId=${correlationId}`);
        const prodCacheResult = await getCachedFeedWithStale("production", "all");
        if (prodCacheResult.cache && prodCacheResult.cache.items && prodCacheResult.cache.items.length > 0) {
          cached = prodCacheResult.cache;
          isStale = prodCacheResult.isStale;
          cacheEnvUsed = "production";
          console.log(`[CATALOG_HOME_V2] cache_fallback_success correlationId=${correlationId} prodItems=${cached.items.length}`);
        }
      }
    } catch (cacheErr) {
      console.warn(`[CATALOG_HOME_V2] Cache read failed: ${cacheErr}`);
    }
    
    // TIER 1 & 2: Serve from cache
    if (cached && cached.items && cached.items.length > 0 && !forceLive) {
      const poolSize = cached.items.length;
      const actualTotalPages = Math.ceil(poolSize / pageSize);
      
      if (page <= actualTotalPages) {
        const offset = (page - 1) * pageSize;
        const pageItems = cached.items.slice(offset, offset + pageSize);
        const hasMoreCached = page < actualTotalPages;
        
        const totalMs = Date.now() - startTime;
        console.log(`[CATALOG_HOME_V2] cache_hit correlationId=${correlationId} client=${clientType} isStale=${isStale} poolSize=${poolSize} page=${page}/${actualTotalPages} cacheEnvUsed=${cacheEnvUsed} ms=${totalMs}`);
        
        if (clientType === "mobile") {
          return buildMobileSectionsResponse(cached.items, locale as "fr" | "en", correlationId, isStale ? "stale-cache" : "cache", isStale, cacheEnvUsed, envRequested, detectedBy);
        }
        
        // WEB: Single feed with normalized title (even if hideTitle=true)
        let sections = [{
          key: "featured",
          title: locale === "fr" ? "En vedette" : "Featured",
          title_en: "Featured",
          title_fr: "En vedette",
          hideTitle: true,
          items: pageItems,
        }];
        sections = normalizeSectionTitles(sections, locale as "fr" | "en") as typeof sections;
        
        return jsonResponse({
          ok: true,
          sections,
          page,
          pageSize,
          totalPages: actualTotalPages,
          totalItems: poolSize,
          hasMore: true,
          hasMoreCached,
          ttlSeconds: DEFAULT_TTL_SECONDS,
          correlationId,
          meta: {
            client: "web",
            envUsed: cacheEnvUsed,
            envRequested,
            source: isStale ? "stale-cache" : "cache",
            isStale,
            page,
            totalPages: actualTotalPages,
            correlationId,
            ts: Date.now(),
            totalMs,
            schemaVersion: CACHE_SCHEMA_VERSION,
          }
        });
      }
    }

    // TIER 3: Bootstrap for mobile when cache empty
    if (clientType === "mobile" && (!cached || !cached.items || cached.items.length === 0)) {
      console.log(`[CATALOG_HOME_V2] tier3_bootstrap correlationId=${correlationId} reason=cache_empty_for_mobile`);
      
      const bootstrapItems = await bootstrapFromDatabase(correlationId);
      
      if (bootstrapItems.length > 0) {
        return buildMobileSectionsResponse(bootstrapItems, locale as "fr" | "en", correlationId, "bootstrap_db", true, cacheEnvUsed, envRequested, detectedBy);
      }
      
      // Even if empty, return ok:true for mobile
      console.log(`[CATALOG_HOME_V2] bootstrap_empty correlationId=${correlationId} returning_empty_sections_with_ok_true`);
      return buildMobileSectionsResponse([], locale as "fr" | "en", correlationId, "bootstrap_empty", true, cacheEnvUsed, envRequested, detectedBy);
    }

    // Live mode - try eBay direct
    console.log(`[CATALOG_HOME_V2] ${forceLive ? 'force_live' : 'cache_miss_or_exhausted'} correlationId=${correlationId}`);

    let liveItems: CatalogItem[] = [];
    try {
      const ebayToken = await getEbayToken();
      if (ebayToken) {
        const queries = ["iphone", "samsung", "xbox", "nike", "sofa", "lego", "fitness"];
        const query = queries[Math.floor(Math.random() * queries.length)];
        liveItems = await fetchEbayItems(query, 50, ebayToken, correlationId);
      }
    } catch (liveErr) {
      console.warn(`[CATALOG_HOME_V2] Live fetch failed: ${liveErr}`);
    }

    const totalMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME_V2] live_result correlationId=${correlationId} items=${liveItems.length} ms=${totalMs}`);

    if (clientType === "mobile") {
      return buildMobileSectionsResponse(liveItems, locale as "fr" | "en", correlationId, "live", false, env, envRequested, detectedBy);
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
    sections = normalizeSectionTitles(sections, locale as "fr" | "en") as typeof sections;

    return jsonResponse({
      ok: liveItems.length > 0,
      sections,
      page,
      pageSize,
      totalPages: 1,
      totalItems: liveItems.length,
      hasMore: false,
      hasMoreCached: false,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      correlationId,
      meta: {
        client: "web",
        envUsed: env,
        envRequested,
        source: "live",
        isStale: false,
        correlationId,
        totalMs,
        ts: Date.now(),
        schemaVersion: CACHE_SCHEMA_VERSION,
      }
    });
  } catch (err) {
    // CRITICAL: Never throw
    const totalMs = Date.now() - startTime;
    console.error(`[CATALOG_HOME_V2][ERROR] correlationId=${correlationId} error=${err} stack=${(err as Error).stack} ms=${totalMs}`);
    
    // Mobile: ALWAYS ok:true with normalized sections
    if (clientType === "mobile") {
      return buildMobileSectionsResponse([], lang, correlationId, "error_fallback", true, env, envRequested, detectedBy);
    }
    
    // Web: ok:false but HTTP 200 with normalized sections
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
