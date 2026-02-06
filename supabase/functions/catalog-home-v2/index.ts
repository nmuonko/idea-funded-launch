import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home-v2 - Single unified homepage feed with cache-first loading
 * 
 * MOBILE CONTRACT: Returns exactly ONE section with empty titles to prevent
 * mobile from rendering section headers / "Voir tout" links.
 * 
 * Uses 2-pass filtering: strict first, then relaxed fallback to ensure
 * dense results without accessory bloat.
 * 
 * Pool: 1000 items, 100 per page, 10 pages
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type",
};

// ===== CLIENT DETECTION =====
type ClientType = "mobile" | "web";

/**
 * Detect if client is mobile (React Native / Expo) or web
 * Mobile clients send specific headers that identify them
 */
function detectClientType(req: Request): ClientType {
  // Check x-supabase-client-info header (case-insensitive)
  const clientInfo = req.headers.get("x-supabase-client-info") 
    || req.headers.get("X-Supabase-Client-Info") 
    || "";
  
  // Check user-agent
  const userAgent = req.headers.get("user-agent") || "";
  
  const clientInfoLower = clientInfo.toLowerCase();
  const userAgentLower = userAgent.toLowerCase();
  
  // Mobile indicators
  const isMobile = 
    clientInfoLower.includes("expo") ||
    clientInfoLower.includes("react-native") ||
    clientInfoLower.includes("reactnative") ||
    userAgentLower.includes("okhttp") ||
    userAgentLower.includes("reactnative") ||
    userAgentLower.includes("expo");
  
  return isMobile ? "mobile" : "web";
}

// Mobile section definitions for sectioned experience
interface MobileSectionDef {
  key: string;
  title_fr: string;
  title_en: string;
  title: string;
  seeds: string[];
  category?: string;
  minPrice?: number;
  target: number;
}

const MOBILE_SECTION_DEFS: MobileSectionDef[] = [
  { 
    key: "phones", 
    title_fr: "Téléphones", 
    title_en: "Phones", 
    title: "Phones",
    seeds: ["iphone 15", "samsung galaxy s24", "pixel 8"],
    target: 20 
  },
  { 
    key: "video_games", 
    title_fr: "Jeux Vidéo", 
    title_en: "Video Games", 
    title: "Video Games",
    seeds: ["ps5 console", "nintendo switch", "xbox series x"],
    target: 20 
  },
  { 
    key: "computers", 
    title_fr: "Ordinateurs", 
    title_en: "Computers", 
    title: "Computers",
    seeds: ["macbook pro", "dell laptop", "gaming laptop"],
    target: 20 
  },
  { 
    key: "vehicles", 
    title_fr: "Véhicules", 
    title_en: "Vehicles", 
    title: "Vehicles",
    seeds: ["toyota camry", "honda civic", "bmw 3 series"],
    category: "6000",
    minPrice: 5000,
    target: 20 
  },
  { 
    key: "clothing", 
    title_fr: "Vêtements", 
    title_en: "Clothing", 
    title: "Clothing",
    seeds: ["nike jordan", "adidas originals", "levi jeans"],
    target: 20 
  },
  { 
    key: "electronics", 
    title_fr: "Électronique", 
    title_en: "Electronics", 
    title: "Electronics",
    seeds: ["airpods pro", "sony headphones", "samsung tv"],
    target: 20 
  },
];

// ===== POOL & PAGINATION CONSTANTS =====
const DEFAULT_POOL_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 100; // Fixed at 100 for stable mobile UX
const DEFAULT_TTL_SECONDS = 172800; // 2 days

// ===== FILTERING CONSTANTS =====
const TARGET_ITEMS = 12; // Default items per section for building
const MIN_ITEMS_RATIO = 0.66; // At least 66% of target before fallback
const STRICT_FETCH_MULTIPLIER = 4; // Fetch 4x target for strict pass
const RELAX_FETCH_MULTIPLIER = 6; // Fetch 6x target for relaxed pass

// Calculate min items threshold
function getMinItems(target: number): number {
  return Math.max(8, Math.floor(target * MIN_ITEMS_RATIO));
}

function generateCorrelationId(): string {
  return `chv2_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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
  
  // Read from query param OR headers (multiple casing variants)
  let envRequested = url.searchParams.get("env") 
    || req.headers.get("X-Afrishop-Environment") 
    || req.headers.get("x-afrishop-environment")
    || "production";
  
  envRequested = envRequested.toLowerCase().trim();
  
  let envUsed = envRequested;
  
  // Normalize "prod" -> "production"
  if (envUsed === "prod") {
    envUsed = "production";
  }
  
  // Validate environment - default to production if invalid
  if (envUsed !== "production" && envUsed !== "staging" && envUsed !== "dev") {
    envUsed = "production";
  }
  
  return { envRequested, envUsed };
}

/**
 * Get cached feed - ALSO returns stale cache if available
 * Returns { cache, isStale } where cache can be stale but still usable
 */
async function getCachedFeedWithStale(env: string, key = "all"): Promise<{ cache: CacheEntry | null; isStale: boolean }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return { cache: null, isStale: false };

  const cacheKey = `${env}:${key}`;

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
        return { cache: data as CacheEntry, isStale: false };
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
        console.log(`[CATALOG_HOME_V2] stale_cache_available key=${cacheKey} items=${data.items.length} expired_at=${data.expires_at}`);
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
 * Return a safe empty feed response - used when everything fails
 * ALWAYS returns HTTP 200 with proper structure so frontend/mobile doesn't crash
 */
function emptyFeedResponse(correlationId: string, error?: string, meta?: Record<string, unknown>): Response {
  // MOBILE CONTRACT: Must always have key="featured", even on empty
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
    totalItems: 0,
    hasMore: false,
    hasMoreCached: false,
    ttlSeconds: 300,
    correlationId,
    error: error || "Unknown error",
    meta: {
      envUsed: meta?.envUsed || "production",
      envRequested: meta?.envRequested || "unknown",
      source: "error",
      isStale: false,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalPages: 0,
      message: error || "Unknown error",
      correlationId,
      ts: Date.now(),
      ...meta,
    }
  }, 200); // ALWAYS 200
}

async function getEbayToken(): Promise<string | null> {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60000) {
    return ebayTokenCache.token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[CATALOG_HOME_V2] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
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

interface SectionConfig {
  key: string;
  title_fr: string;
  title_en: string;
  ebay_category?: string;
  min_price?: number;
  is_vehicle?: boolean;
  include_keywords?: string[];
  strict?: boolean;
  seed_queries: string[];
  see_all_query?: string;
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
}

function getExcludeConfig(sectionKey: string): ExcludeConfig {
  return SECTION_EXCLUDES[sectionKey] || { hard: [], soft: [] };
}

/**
 * Build query with negative keywords for eBay
 */
function buildEnhancedQuery(seedQuery: string, excludeKeywords: string[], maxNegatives = 6): string {
  if (!excludeKeywords || excludeKeywords.length === 0) {
    return seedQuery;
  }
  
  // eBay supports "-term" to exclude
  const negatives = excludeKeywords.slice(0, maxNegatives).map(kw => `-${kw.replace(/\s+/g, '')}`);
  return `${seedQuery} ${negatives.join(' ')}`;
}

/**
 * Check if title contains any include keyword (for relevance boost)
 */
function hasIncludeKeyword(title: string, includeKeywords: string[]): boolean {
  if (!includeKeywords || includeKeywords.length === 0) return true;
  const lowerTitle = title.toLowerCase();
  return includeKeywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

interface FilterResult {
  kept: CatalogItem[];
  droppedHard: number;
  droppedSoft: number;
  droppedPrice: number;
  topDropped: string[];
}

/**
 * STRICT pass filter - applies all exclude rules
 */
function filterStrict(
  items: CatalogItem[],
  config: SectionConfig,
  excludeConfig: ExcludeConfig
): FilterResult {
  const { min_price, include_keywords = [], is_vehicle } = config;
  const { hard, soft } = excludeConfig;
  
  // Build patterns
  const hardPatterns = hard.map(kw => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  const softPatterns = soft.map(kw => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  
  // For non-vehicle sections, only apply accessory regex if item lacks include keywords
  const accessoryRegex = /(case|cover|sleeve|skin|sticker|decal|protector|replacement|repair|tool|kit|parts|holder|mount|stand|bag|pouch|wallet|strap|hook|organizer|mat|trim)/i;
  
  // Vehicle-specific strict filter
  const vehiclePartsRegex = /(seat cover|floor mat|steering wheel|dash|bumper|fender|mirror|hood|door panel|trunk|cargo|headlight|taillight|wheel cover|hub cap|antenna|emblem|badge|decal|sticker|air freshener|tissue|cup holder|phone holder|sun visor|key|remote|fob|charger|mount|stand|hook|organizer|liner|cushion|mat|cover|protector|parts only|accessory)/i;
  
  let droppedHard = 0;
  let droppedSoft = 0;
  let droppedPrice = 0;
  const topDropped: string[] = [];
  
  const kept = items.filter(item => {
    const title = (item.title || '').toLowerCase();
    const price = item.price_usd ?? item.priceUsd ?? 0;
    
    // Skip items with no title or image
    if (!item.title || (!item.image_url && !item.imageUrl)) {
      return false;
    }
    
    // Price floor check
    if (min_price && price > 0 && price < min_price) {
      droppedPrice++;
      if (topDropped.length < 5) topDropped.push(`price<${min_price}: ${title.substring(0,35)}`);
      return false;
    }
    
    // Hard exclude - always drop
    for (const pattern of hardPatterns) {
      if (pattern.test(title)) {
        droppedHard++;
        if (topDropped.length < 5) topDropped.push(`hard: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    // Soft exclude - only in strict pass
    for (const pattern of softPatterns) {
      if (pattern.test(title)) {
        droppedSoft++;
        if (topDropped.length < 5) topDropped.push(`soft: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    // Vehicle mode: extra strict - always filter parts
    if (is_vehicle && vehiclePartsRegex.test(title)) {
      droppedHard++;
      if (topDropped.length < 5) topDropped.push(`vehicle_part: ${title.substring(0,35)}`);
      return false;
    }
    
    // Accessory check: ONLY if title lacks include keywords
    // This prevents over-filtering actual products
    if (!is_vehicle && accessoryRegex.test(title)) {
      if (!hasIncludeKeyword(title, include_keywords)) {
        droppedSoft++;
        if (topDropped.length < 5) topDropped.push(`accessory_no_kw: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    return true;
  });
  
  return { kept, droppedHard, droppedSoft, droppedPrice, topDropped };
}

/**
 * RELAXED pass filter - only applies hard excludes
 */
function filterRelaxed(
  items: CatalogItem[],
  config: SectionConfig,
  excludeConfig: ExcludeConfig
): FilterResult {
  const { min_price, is_vehicle } = config;
  const { hard } = excludeConfig;
  
  const hardPatterns = hard.map(kw => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  
  // Vehicle parts - still strict for vehicles
  const vehiclePartsRegex = /(seat cover|floor mat|steering wheel|dash|bumper|fender|mirror|hood|door panel|headlight|taillight|emblem|badge|decal|sticker|air freshener|tissue|cup holder|phone holder|sun visor|parts only|accessory kit)/i;
  
  let droppedHard = 0;
  let droppedPrice = 0;
  const topDropped: string[] = [];
  
  const kept = items.filter(item => {
    const title = (item.title || '').toLowerCase();
    const price = item.price_usd ?? item.priceUsd ?? 0;
    
    if (!item.title || (!item.image_url && !item.imageUrl)) {
      return false;
    }
    
    // Price floor - slightly relaxed (80% of min_price)
    const relaxedMinPrice = min_price ? min_price * 0.8 : 0;
    if (relaxedMinPrice && price > 0 && price < relaxedMinPrice) {
      droppedPrice++;
      return false;
    }
    
    // Hard exclude only
    for (const pattern of hardPatterns) {
      if (pattern.test(title)) {
        droppedHard++;
        if (topDropped.length < 5) topDropped.push(`hard: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    // Vehicle mode remains strict
    if (is_vehicle && vehiclePartsRegex.test(title)) {
      droppedHard++;
      return false;
    }
    
    return true;
  });
  
  return { kept, droppedHard, droppedSoft: 0, droppedPrice, topDropped };
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
  
  const pricingSummary = item.pricingSummary as Record<string, unknown> | undefined;
  const summaryPrice = pricingSummary?.price as Record<string, unknown> | undefined;
  if (summaryPrice?.value !== undefined) {
    const val = typeof summaryPrice.value === "string" ? parseFloat(summaryPrice.value) : summaryPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) return val;
  }
  
  return null;
}

/**
 * Validate if an eBay item ID is click-safe
 * Must have v1| format or be a numeric eBay item ID
 */
function isValidEbayId(itemId: string): boolean {
  if (!itemId) return false;
  // eBay v1| format: v1|itemId|variationId
  if (itemId.startsWith("v1|")) return true;
  // Legacy numeric eBay IDs (12+ digits)
  if (/^\d{12,}$/.test(itemId)) return true;
  return false;
}

function mapEbayItem(item: Record<string, unknown>): CatalogItem | null {
  const priceUsd = extractPriceFromItem(item);
  const imageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || null;
  const productUrl = (item.itemWebUrl as string) || null;
  const priceObj = item.price as Record<string, unknown> | undefined;
  const itemId = item.itemId as string || "";
  
  // Validate eBay ID is click-safe - DROP unclickable items
  if (!isValidEbayId(itemId)) {
    console.log(`[CATALOG_HOME_V2][WARN] drop_unclickable provider=ebay id=${itemId}`);
    return null;
  }
  
  // CANONICAL ID FORMAT: ebay_<rawId> (includes v1| prefix if present)
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
  };
}

async function fetchEbayItems(
  query: string,
  category: string | undefined,
  limit: number,
  ebayToken: string,
  correlationId: string
): Promise<CatalogItem[]> {
  const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", String(Math.min(limit, 50)));
  
  if (category) {
    searchUrl.searchParams.set("category_ids", category);
  }

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
  // Map and filter: null items are invalid/unclickable
  return rawItems
    .map(mapEbayItem)
    .filter((i: CatalogItem | null): i is CatalogItem => i !== null && !!i.title && !!i.image_url);
}

/**
 * 2-PASS FETCH: Strict first, then relaxed fallback
 */
async function fetchSectionItems(
  sectionConfig: SectionConfig,
  targetLimit: number,
  correlationId: string,
  ebayToken: string | null
): Promise<{ items: CatalogItem[]; error?: string; ms: number }> {
  const startMs = Date.now();
  const { key, seed_queries, ebay_category, is_vehicle, include_keywords = [] } = sectionConfig;

  if (!ebayToken) {
    console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} error=NO_EBAY_TOKEN`);
    return { items: [], error: "eBay OAuth token not available", ms: Date.now() - startMs };
  }

  const excludeConfig = getExcludeConfig(key);
  const minItems = getMinItems(targetLimit);
  const strictFetchLimit = targetLimit * STRICT_FETCH_MULTIPLIER;
  const relaxFetchLimit = targetLimit * RELAX_FETCH_MULTIPLIER;

  try {
    // Pick a random seed query
    const randomSeed = seed_queries[Math.floor(Math.random() * seed_queries.length)] || seed_queries[0] || key;
    
    // ===== PASS 1: STRICT =====
    // Build query with both hard and soft excludes
    const allExcludes = [...excludeConfig.hard, ...excludeConfig.soft.slice(0, 3)];
    const strictQuery = buildEnhancedQuery(randomSeed, allExcludes, 6);
    
    console.log(`[SECTION_PASS] key=${key} pass=strict query="${strictQuery.substring(0, 60)}..." fetchLimit=${strictFetchLimit}`);
    
    const strictRaw = await fetchEbayItems(
      strictQuery,
      ebay_category || (is_vehicle ? "6000" : undefined),
      strictFetchLimit,
      ebayToken,
      correlationId
    );
    
    const strictResult = filterStrict(strictRaw, sectionConfig, excludeConfig);
    
    console.log(`[SECTION_PASS] key=${key} pass=strict fetched=${strictRaw.length} kept=${strictResult.kept.length} droppedHard=${strictResult.droppedHard} droppedSoft=${strictResult.droppedSoft} droppedPrice=${strictResult.droppedPrice}`);
    
    // If strict pass is sufficient, return
    if (strictResult.kept.length >= minItems) {
      const items = strictResult.kept.slice(0, targetLimit);
      const ms = Date.now() - startMs;
      console.log(`[SECTION_DONE] key=${key} returned=${items.length} source=strict ms=${ms}`);
      return { items, ms };
    }
    
    // ===== VEHICLES: NO FALLBACK =====
    // Vehicles must stay strict - try broader vehicle queries instead
    if (is_vehicle) {
      // Try additional vehicle queries
      const extraVehicleQueries = ["rav4", "camry", "corolla", "civic", "accord", "f150", "silverado", "tacoma"];
      const extraQuery = extraVehicleQueries[Math.floor(Math.random() * extraVehicleQueries.length)];
      const vehicleQuery = buildEnhancedQuery(extraQuery, excludeConfig.hard, 8);
      
      console.log(`[SECTION_PASS] key=${key} pass=vehicle_expand query="${vehicleQuery}"`);
      
      const extraRaw = await fetchEbayItems(vehicleQuery, "6000", relaxFetchLimit, ebayToken, correlationId);
      const extraResult = filterStrict(extraRaw, sectionConfig, excludeConfig);
      
      // Dedupe and combine
      const seenIds = new Set(strictResult.kept.map(i => i.id));
      const combined = [...strictResult.kept];
      for (const item of extraResult.kept) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          combined.push(item);
        }
      }
      
      const items = combined.slice(0, targetLimit);
      const ms = Date.now() - startMs;
      console.log(`[SECTION_DONE] key=${key} returned=${items.length} source=vehicle_expand ms=${ms}`);
      return { items, ms };
    }
    
    // ===== PASS 2: RELAXED (non-vehicles only) =====
    // Build query with only hard excludes
    const relaxQuery = buildEnhancedQuery(randomSeed, excludeConfig.hard, 4);
    
    console.log(`[SECTION_PASS] key=${key} pass=relax query="${relaxQuery.substring(0, 60)}..." fetchLimit=${relaxFetchLimit}`);
    
    const relaxRaw = await fetchEbayItems(
      relaxQuery,
      ebay_category,
      relaxFetchLimit,
      ebayToken,
      correlationId
    );
    
    const relaxResult = filterRelaxed(relaxRaw, sectionConfig, excludeConfig);
    
    console.log(`[SECTION_PASS] key=${key} pass=relax fetched=${relaxRaw.length} kept=${relaxResult.kept.length} droppedHard=${relaxResult.droppedHard}`);
    
    // Dedupe and combine strict + relaxed
    const seenIds = new Set(strictResult.kept.map(i => i.id));
    const combined = [...strictResult.kept];
    
    for (const item of relaxResult.kept) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        combined.push(item);
      }
    }
    
    const items = combined.slice(0, targetLimit);
    const ms = Date.now() - startMs;
    
    console.log(`[SECTION_DONE] key=${key} returned=${items.length} source=combined strictKept=${strictResult.kept.length} relaxKept=${relaxResult.kept.length} ms=${ms} topDropped=${JSON.stringify(strictResult.topDropped.slice(0,3))}`);
    
    return { items, ms };
  } catch (err) {
    const ms = Date.now() - startMs;
    console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} error=${err}`);
    return { items: [], error: String(err), ms };
  }
}

async function loadHomeSectionsAndSeeds(): Promise<{ sections: SectionConfig[] | null; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return { sections: null, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  try {
    const sectionsRes = await fetch(
      `${supabaseUrl}/rest/v1/home_sections?enabled=eq.true&order=sort_order.asc&select=key,title_fr,title_en,ebay_category,min_price,is_vehicle,see_all_query,include_keywords,exclude_keywords,strict`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!sectionsRes.ok) {
      const errorText = await sectionsRes.text();
      return { sections: null, error: `home_sections error: ${sectionsRes.status} ${errorText.substring(0, 100)}` };
    }

    const sectionsData = await sectionsRes.json();
    if (!Array.isArray(sectionsData) || sectionsData.length === 0) {
      return { sections: null, error: "No enabled sections found in home_sections" };
    }

    const seedsRes = await fetch(
      `${supabaseUrl}/rest/v1/home_section_seeds?enabled=eq.true&select=section_key,query`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    let seedsData: Array<{ section_key: string; query: string }> = [];
    if (seedsRes.ok) {
      seedsData = await seedsRes.json();
    }

    const seedsMap = new Map<string, string[]>();
    for (const seed of seedsData) {
      if (!seedsMap.has(seed.section_key)) {
        seedsMap.set(seed.section_key, []);
      }
      seedsMap.get(seed.section_key)!.push(seed.query);
    }

    const sections: SectionConfig[] = sectionsData.map((section: Record<string, unknown>) => {
      const key = section.key as string;
      const seeds = seedsMap.get(key) || [];
      
      const seedQueries = seeds.length > 0 
        ? seeds 
        : (section.see_all_query ? [section.see_all_query as string] : [key]);
      
      return {
        key,
        title_fr: section.title_fr as string,
        title_en: section.title_en as string,
        ebay_category: section.ebay_category as string | undefined,
        min_price: section.min_price as number | undefined,
        is_vehicle: section.is_vehicle as boolean | undefined,
        include_keywords: section.include_keywords as string[] || [],
        strict: section.strict !== false,
        seed_queries: seedQueries,
        see_all_query: section.see_all_query as string | undefined,
      };
    });

    console.log(`[CATALOG_HOME_V2] Loaded ${sections.length} sections from home_sections with ${seedsData.length} total seeds`);
    return { sections };
  } catch (err) {
    return { sections: null, error: err instanceof Error ? err.message : String(err) };
  }
}

interface CacheEntry {
  id: string;
  env: string;
  items: CatalogItem[];
  created_at: string;
  expires_at: string;
  meta: Record<string, unknown>;
}

/**
 * Build mobile sectioned response from cached pool
 * Groups items by segment property or distributes evenly across sections
 */
function buildMobileSectionsFromPoolV2(
  items: CatalogItem[], 
  locale: string
): { sections: Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }>; totalItems: number } {
  const sections: Array<{ key: string; title: string; title_fr: string; title_en: string; items: CatalogItem[] }> = [];
  
  // Distribute items evenly across mobile sections
  const itemsPerSection = Math.ceil(items.length / MOBILE_SECTION_DEFS.length);
  let offset = 0;
  
  for (const mobileSec of MOBILE_SECTION_DEFS) {
    const sectionItems = items.slice(offset, offset + Math.min(itemsPerSection, mobileSec.target));
    offset += itemsPerSection;
    
    if (sectionItems.length > 0) {
      sections.push({
        key: mobileSec.key,
        title: locale === "fr" ? mobileSec.title_fr : mobileSec.title_en,
        title_fr: mobileSec.title_fr,
        title_en: mobileSec.title_en,
        items: sectionItems,
      });
    }
  }
  
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  return { sections, totalItems };
}

serve(async (req) => {
  const correlationId = generateCorrelationId();
  
  // CORS preflight - ALWAYS handle first, return 204
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  
  // ===== CLIENT DETECTION =====
  const clientType = detectClientType(req);
  
  // CRITICAL: Normalize environment with proper fallback
  const { envRequested, envUsed } = normalizeEnv(req);
  let env = envUsed;
  
  console.log(`[CATALOG_HOME_V2] start correlationId=${correlationId} client=${clientType} envRequested=${envRequested} envUsed=${env}`);

  // Wrap EVERYTHING in try/catch to guarantee no throws
  try {
    let locale = "fr";
    let currency = "USD";
    let limitPerSection = TARGET_ITEMS;
    
    // PAGE SIZE: Web uses 100, Mobile uses 20 per section
    const mobilePageSize = 20;
    let pageSize = clientType === "mobile" ? mobilePageSize : DEFAULT_PAGE_SIZE;
    let page = 1;
    let forceLive = false;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        locale = body.locale || "fr";
        currency = body.currency || "USD";
        limitPerSection = Math.min(Math.max(body.limitPerSection || TARGET_ITEMS, 1), 50);
        page = Math.max(1, parseInt(body.page, 10) || 1);
        forceLive = body.live === true || body.live === "1";
        
        // Override env from body if provided (but still normalize)
        if (body.env) {
          const bodyEnv = body.env.toLowerCase().trim();
          env = bodyEnv === "prod" ? "production" : (["production", "staging", "dev"].includes(bodyEnv) ? bodyEnv : "production");
        }
      } catch {
        // Use defaults
      }
    } else {
      const url = new URL(req.url);
      locale = url.searchParams.get("locale") || url.searchParams.get("lang") || "fr";
      currency = url.searchParams.get("currency") || "USD";
      page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("live") === "true";
      
      const limitParam = url.searchParams.get("limitPerSection") || url.searchParams.get("limit");
      if (limitParam) {
        limitPerSection = Math.min(Math.max(parseInt(limitParam, 10) || TARGET_ITEMS, 1), 50);
      }
    }

    console.log(`[CATALOG_HOME_V2] correlationId=${correlationId} client=${clientType} locale=${locale} page=${page} pageSize=${pageSize} forceLive=${forceLive}`);

    // ===== CACHE-FIRST: Check for cached feed (shared with catalog-home) =====
    let cached: CacheEntry | null = null;
    let isStale = false;
    let cacheEnvUsed = env;
    
    try {
      // Use "all" to share cache with catalog-home endpoint
      const cacheResult = await getCachedFeedWithStale(env, "all");
      cached = cacheResult.cache;
      isStale = cacheResult.isStale;
      
      // CRITICAL: If requested env (e.g., staging) has no cache, fall back to production
      if ((!cached || !cached.items || cached.items.length === 0) && env !== "production") {
        console.log(`[CATALOG_HOME_V2] cache_fallback_to_production correlationId=${correlationId} envRequested=${envRequested} envUsed=${env} reason=no_cache_for_env`);
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
    
    // If cache exists and has items, use it for paginated response
    if (cached && cached.items && cached.items.length > 0 && !forceLive) {
      const poolSize = cached.items.length;
      const actualTotalPages = Math.ceil(poolSize / pageSize);
      
      // If requested page is within cached pool
      if (page <= actualTotalPages) {
        const offset = (page - 1) * pageSize;
        const pageItems = cached.items.slice(offset, offset + pageSize);
        const hasMoreCached = page < actualTotalPages;
        
        const totalMs = Date.now() - startTime;
        console.log(`[CATALOG_HOME_V2] cache_hit correlationId=${correlationId} client=${clientType} isStale=${isStale} poolSize=${poolSize} page=${page}/${actualTotalPages} returning=${pageItems.length} cacheEnvUsed=${cacheEnvUsed} ms=${totalMs}`);
        
        // ===== DUAL-MODE RESPONSE =====
        if (clientType === "mobile") {
          // MOBILE: Return multiple sections with real titles
          const { sections: mobileSections, totalItems } = buildMobileSectionsFromPoolV2(cached.items, locale);
          
          console.log(`[CATALOG_HOME_V2] mobile_sections correlationId=${correlationId} sectionsCount=${mobileSections.length} totalItems=${totalItems}`);
          
          return jsonResponse({
            ok: true,
            sections: mobileSections,
            page,
            pageSize,
            totalPages: 1, // Mobile uses sections, not pages
            totalItems,
            hasMore: false, // Mobile gets all sections at once
            hasMoreCached: false,
            ttlSeconds: 1800,
            correlationId,
            meta: {
              client: "mobile",
              envUsed: cacheEnvUsed,
              envRequested,
              source: "cache",
              isStale,
              correlationId,
              ts: Date.now(),
              totalMs,
            }
          });
        }
        
        // WEB: Return single "featured" section (current working behavior)
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
          ttlSeconds: 1800,
          correlationId,
          meta: {
            client: "web",
            envUsed: cacheEnvUsed,
            envRequested,
            source: "cache",
            isStale,
            page,
            pageSize,
            totalPages: actualTotalPages,
            correlationId,
            ts: Date.now(),
            totalMs,
          }
        });
      }
      
      // Page is beyond cached pool - fall through to live mode
      console.log(`[CATALOG_HOME_V2] cache_exhausted correlationId=${correlationId} page=${page} actualTotalPages=${actualTotalPages} switching_to_live`);
    }

    // ===== CACHE MISS OR LIVE MODE: Fetch fresh items =====
    console.log(`[CATALOG_HOME_V2] ${forceLive ? 'force_live' : 'cache_miss'} correlationId=${correlationId} attempting_live_fetch`);

    // Load sections from Admin Portal tables
    const { sections: dbSections, error: dbError } = await loadHomeSectionsAndSeeds();
    
    if (dbError) {
      console.warn(`[CATALOG_HOME_V2] DB load warning: ${dbError}, using fallback sections`);
    }

    const sections = dbSections || FALLBACK_SECTIONS;
    
    // Get eBay token - if fails, return empty feed with ok:false (not 500)
    let ebayToken: string | null = null;
    try {
      ebayToken = await getEbayToken();
    } catch (tokenErr) {
      console.error(`[CATALOG_HOME_V2] correlationId=${correlationId} token_error=${tokenErr}`);
    }
    
    if (!ebayToken) {
      console.error(`[CATALOG_HOME_V2] correlationId=${correlationId} error=NO_EBAY_TOKEN returning empty feed`);
      return emptyFeedResponse(correlationId, "eBay authentication failed", { 
        reason: "no_token",
        envUsed: env,
        envRequested,
      });
    }

    // Fetch all sections in parallel and MERGE into single pool
    const sectionPromises = sections.map(async (section) => {
      const { items, error, ms } = await fetchSectionItems(section, limitPerSection, correlationId, ebayToken);
      return { key: section.key, items, error, ms };
    });

    const results = await Promise.all(sectionPromises);
    
    // MERGE all section items into a single pool (no separate sections for mobile)
    const allItems: CatalogItem[] = [];
    const segmentCounts: Record<string, number> = {};
    
    for (const r of results) {
      if (r.items.length > 0) {
        allItems.push(...r.items);
        segmentCounts[r.key] = r.items.length;
      } else {
        console.warn(`[CATALOG_HOME_V2] Section ${r.key} returned 0 items`);
      }
    }
    
    // Paginate merged items
    const poolSize = allItems.length;
    const actualTotalPages = Math.ceil(poolSize / pageSize);
    const offset = (page - 1) * pageSize;
    const pageItems = allItems.slice(offset, offset + pageSize);
    const hasMoreCached = page < actualTotalPages;

    const totalMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME_V2] live_success correlationId=${correlationId} client=${clientType} poolSize=${poolSize} page=${page}/${actualTotalPages} returning=${pageItems.length} totalMs=${totalMs} envUsed=${env}`);

    // ===== DUAL-MODE RESPONSE FOR LIVE =====
    if (clientType === "mobile") {
      // MOBILE: Return multiple sections with real titles from live results
      const { sections: mobileSections, totalItems } = buildMobileSectionsFromPoolV2(allItems, locale);
      
      return jsonResponse({
        ok: mobileSections.length > 0,
        sections: mobileSections,
        page,
        pageSize,
        totalPages: 1,
        totalItems,
        hasMore: false,
        hasMoreCached: false,
        ttlSeconds: 1800,
        correlationId,
        meta: {
          client: "mobile",
          envUsed: env,
          envRequested,
          source: "live",
          isStale: false,
          segmentCounts,
          correlationId,
          totalMs,
          ts: Date.now(),
        }
      });
    }

    // WEB: Single "featured" section (current working behavior)
    return jsonResponse({
      ok: pageItems.length > 0,
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
      hasMore: pageItems.length >= pageSize,
      hasMoreCached,
      ttlSeconds: 1800,
      correlationId,
      meta: {
        client: "web",
        envUsed: env,
        envRequested,
        source: "live",
        isStale: false,
        page,
        pageSize,
        totalPages: actualTotalPages,
        segmentCounts,
        correlationId,
        totalMs,
        ts: Date.now(),
      }
    });
  } catch (err) {
    // CRITICAL: This catch block ensures we NEVER throw - ALWAYS return HTTP 200
    const totalMs = Date.now() - startTime;
    console.error(`[CATALOG_HOME_V2][ERROR] correlationId=${correlationId} error=${err} stack=${(err as Error).stack} ms=${totalMs}`);
    
    // Return proper empty feed structure with HTTP 200
    return emptyFeedResponse(correlationId, String(err), { 
      totalMs,
      stack: (err as Error).stack,
    });
  }
});
