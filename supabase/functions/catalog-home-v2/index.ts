import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home-v2 - Single unified homepage feed with cache-first loading
 * 
 * PRODUCTION HOTFIX: This function is designed to NEVER fail:
 * - Always returns HTTP 200 with proper CORS
 * - Uses 3-tier fallback: Cache → Stale Cache → DB Bootstrap
 * - Mobile ALWAYS gets ok:true with 8 sections to prevent "Catalogue Indisponible"
 * 
 * Web: Single "featured" section (paged at 100)
 * Mobile: 8 sections with localized titles
 */

// Enhanced CORS headers - support ALL mobile headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-afrishop-client, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type, x-correlation-id",
};

// ===== CLIENT DETECTION =====
type ClientType = "mobile" | "web";

function detectClientType(req: Request): ClientType {
  const clientInfo = req.headers.get("x-supabase-client-info") 
    || req.headers.get("X-Supabase-Client-Info") 
    || req.headers.get("x-client-info")
    || req.headers.get("X-Client-Info")
    || "";
  
  const userAgent = req.headers.get("user-agent") || "";
  const platform = req.headers.get("x-supabase-client-platform")
    || req.headers.get("X-Supabase-Client-Platform")
    || "";
  
  const clientInfoLower = clientInfo.toLowerCase();
  const userAgentLower = userAgent.toLowerCase();
  const platformLower = platform.toLowerCase();
  
  const isMobile = 
    clientInfoLower.includes("expo") ||
    clientInfoLower.includes("react-native") ||
    clientInfoLower.includes("reactnative") ||
    userAgentLower.includes("okhttp") ||
    userAgentLower.includes("reactnative") ||
    userAgentLower.includes("expo") ||
    platformLower.includes("android") ||
    platformLower.includes("ios");
  
  return isMobile ? "mobile" : "web";
}

// Mobile section definitions
interface MobileSectionDef {
  key: string;
  title_fr: string;
  title_en: string;
  title: string;
  keywords: string[];
  target: number;
}

const MOBILE_SECTION_DEFS: MobileSectionDef[] = [
  { 
    key: "phones", 
    title_fr: "Téléphones", 
    title_en: "Phones", 
    title: "Phones",
    keywords: ["iphone", "samsung", "galaxy", "pixel", "phone", "smartphone", "android", "mobile"],
    target: 20 
  },
  { 
    key: "electronics", 
    title_fr: "Électronique", 
    title_en: "Electronics", 
    title: "Electronics",
    keywords: ["airpods", "headphones", "earbuds", "speaker", "tv", "camera", "tablet", "laptop", "audio", "bluetooth"],
    target: 20 
  },
  { 
    key: "vehicles", 
    title_fr: "Véhicules", 
    title_en: "Vehicles", 
    title: "Vehicles",
    keywords: ["toyota", "honda", "bmw", "ford", "mercedes", "car", "truck", "suv", "vehicle", "auto"],
    target: 20 
  },
  { 
    key: "video_games", 
    title_fr: "Jeux vidéo", 
    title_en: "Video Games", 
    title: "Video Games",
    keywords: ["ps5", "xbox", "nintendo", "switch", "playstation", "console", "controller", "gaming", "game"],
    target: 20 
  },
  { 
    key: "clothing_fashion", 
    title_fr: "Vêtements et mode", 
    title_en: "Clothing & Fashion", 
    title: "Clothing & Fashion",
    keywords: ["nike", "adidas", "jordan", "shoes", "sneakers", "jacket", "hoodie", "dress", "jeans", "shirt"],
    target: 20 
  },
  { 
    key: "home_garden", 
    title_fr: "Maison et jardin", 
    title_en: "Home & Garden", 
    title: "Home & Garden",
    keywords: ["sofa", "table", "chair", "furniture", "kitchen", "decor", "garden", "home", "bed", "lamp"],
    target: 20 
  },
  { 
    key: "toys", 
    title_fr: "Jouets", 
    title_en: "Toys", 
    title: "Toys",
    keywords: ["lego", "doll", "toy", "barbie", "figure", "game", "puzzle", "kids", "children"],
    target: 20 
  },
  { 
    key: "sporting_goods", 
    title_fr: "Articles de sport", 
    title_en: "Sporting Goods", 
    title: "Sporting Goods",
    keywords: ["basketball", "football", "soccer", "yoga", "fitness", "gym", "running", "sports", "exercise"],
    target: 20 
  },
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
 * Build GUARANTEED mobile sections response
 * ALWAYS returns ok:true with 8 sections to prevent "Catalogue Indisponible"
 */
function buildMobileSectionsResponse(
  items: CatalogItem[],
  locale: string,
  correlationId: string,
  source: string,
  isStale: boolean,
  envUsed: string,
  envRequested: string
): Response {
  const sections = buildMobileSectionsFromPool(items, locale);
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  
  console.log(`[CATALOG_HOME_V2] mobile_response correlationId=${correlationId} source=${source} sections=${sections.length} totalItems=${totalItems}`);
  
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
      envUsed,
      envRequested,
      source,
      isStale,
      correlationId,
      ts: Date.now(),
    }
  });
}

function buildMobileSectionsFromPool(
  items: CatalogItem[], 
  locale: string
): Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }> {
  const sections: Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }> = [];
  
  // Always return 8 sections structure (mobile expects this)
  if (!items || items.length === 0) {
    for (const mobileSec of MOBILE_SECTION_DEFS) {
      sections.push({
        key: mobileSec.key,
        title: locale === "fr" ? mobileSec.title_fr : mobileSec.title_en,
        title_fr: mobileSec.title_fr,
        title_en: mobileSec.title_en,
        items: [],
      });
    }
    return sections;
  }
  
  // Match items to sections by keywords
  const usedItems = new Set<string>();
  
  for (const mobileSec of MOBILE_SECTION_DEFS) {
    const sectionItems: CatalogItem[] = [];
    
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
      title: locale === "fr" ? mobileSec.title_fr : mobileSec.title_en,
      title_fr: mobileSec.title_fr,
      title_en: mobileSec.title_en,
      items: sectionItems,
    });
  }
  
  // If most sections are empty, redistribute evenly
  const sectionsWithItems = sections.filter(s => s.items.length > 0);
  if (sectionsWithItems.length < 3 && items.length > 0) {
    sections.length = 0;
    const itemsPerSection = Math.ceil(items.length / MOBILE_SECTION_DEFS.length);
    let offset = 0;
    
    for (const mobileSec of MOBILE_SECTION_DEFS) {
      const sectionItems = items.slice(offset, offset + Math.min(itemsPerSection, mobileSec.target));
      offset += itemsPerSection;
      
      sections.push({
        key: mobileSec.key,
        title: locale === "fr" ? mobileSec.title_fr : mobileSec.title_en,
        title_fr: mobileSec.title_fr,
        title_en: mobileSec.title_en,
        items: sectionItems,
      });
    }
  }
  
  return sections;
}

/**
 * TIER 1 & 2: Get cached feed with stale fallback
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
        return { cache: data as CacheEntry, isStale: false };
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
  const clientType = detectClientType(req);
  const { envRequested, envUsed } = normalizeEnv(req);
  let env = envUsed;
  
  console.log(`[CATALOG_HOME_V2] start correlationId=${correlationId} client=${clientType} envRequested=${envRequested} envUsed=${env}`);

  // Wrap EVERYTHING in try/catch
  try {
    let locale = "fr";
    let pageSize = clientType === "mobile" ? 20 : DEFAULT_PAGE_SIZE;
    let page = 1;
    let forceLive = false;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        locale = body.locale || "fr";
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
      locale = url.searchParams.get("locale") || url.searchParams.get("lang") || "fr";
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
          return buildMobileSectionsResponse(cached.items, locale, correlationId, isStale ? "stale-cache" : "cache", isStale, cacheEnvUsed, envRequested);
        }
        
        return jsonResponse({
          ok: true,
          sections: [{
            key: "featured",
            title: "",
            title_en: "",
            title_fr: "",
            hideTitle: true,
            items: pageItems,
          }],
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
          }
        });
      }
    }

    // TIER 3: Bootstrap for mobile when cache empty
    if (clientType === "mobile" && (!cached || !cached.items || cached.items.length === 0)) {
      console.log(`[CATALOG_HOME_V2] tier3_bootstrap correlationId=${correlationId} reason=cache_empty_for_mobile`);
      
      const bootstrapItems = await bootstrapFromDatabase(correlationId);
      
      if (bootstrapItems.length > 0) {
        return buildMobileSectionsResponse(bootstrapItems, locale, correlationId, "bootstrap_db", true, cacheEnvUsed, envRequested);
      }
      
      // Even if empty, return ok:true for mobile
      console.log(`[CATALOG_HOME_V2] bootstrap_empty correlationId=${correlationId} returning_empty_sections_with_ok_true`);
      return buildMobileSectionsResponse([], locale, correlationId, "bootstrap_empty", true, cacheEnvUsed, envRequested);
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
      return buildMobileSectionsResponse(liveItems, locale, correlationId, "live", false, env, envRequested);
    }

    return jsonResponse({
      ok: liveItems.length > 0,
      sections: [{
        key: "featured",
        title: "",
        title_en: "",
        title_fr: "",
        hideTitle: true,
        items: liveItems,
      }],
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
      }
    });
  } catch (err) {
    // CRITICAL: Never throw
    const totalMs = Date.now() - startTime;
    console.error(`[CATALOG_HOME_V2][ERROR] correlationId=${correlationId} error=${err} stack=${(err as Error).stack} ms=${totalMs}`);
    
    // Mobile: ALWAYS ok:true
    if (clientType === "mobile") {
      return buildMobileSectionsResponse([], "fr", correlationId, "error_fallback", true, env, envRequested);
    }
    
    // Web: ok:false but HTTP 200
    return jsonResponse({
      ok: false,
      sections: [{
        key: "featured",
        title: "",
        title_en: "",
        title_fr: "",
        hideTitle: true,
        items: [],
      }],
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalPages: 0,
      correlationId,
      error: String(err),
      meta: {
        source: "error",
        totalMs,
      }
    });
  }
});
