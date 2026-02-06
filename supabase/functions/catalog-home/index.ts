import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home - Single unified homepage feed with cache-first loading
 * 
 * PRODUCTION HOTFIX: This function is designed to NEVER fail:
 * - Always returns HTTP 200 with proper CORS
 * - Uses stale cache fallback if fresh build fails
 * - Returns empty feed structure (not empty sections) on total failure
 * 
 * Returns ONE feed (no multiple titled sections) with 1000+ curated items:
 * - Phones segment (250): iPhones, Samsung, Pixel
 * - Accessories segment (200): cases, chargers, earbuds
 * - Cars/Vehicles segment (150): car electronics, dashcams, etc.
 * - Gaming segment (200): consoles, controllers, games
 * - Home/Furniture segment (200): sofas, beds, appliances
 * 
 * Cache TTL is admin-controlled via admin_settings table.
 * Supports live=1 for "Load more" that fetches fresh items.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type",
};

// Default settings (overridden by admin_settings)
const DEFAULT_POOL_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 100; // 100 items per page = 10 pages for 1000 pool
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
 * Return a safe empty feed response - used when everything fails
 * ALWAYS returns HTTP 200 with proper structure so frontend doesn't crash
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
    correlationId,
    error: error || "Unknown error",
    meta: {
      envUsed: meta?.envUsed || "production",
      envRequested: meta?.envRequested || "unknown",
      source: "error",
      isStale: false,
      correlationId,
      ts: Date.now(),
      message: error || "Unknown error",
    },
    _meta: {
      source: "error",
      error: error || "Unknown error",
      ts: Date.now(),
      ...meta,
    }
  }, 200); // ALWAYS 200
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
      "home_feed_limit", // legacy key
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

    // Support both new and legacy keys
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
 * Get cached feed - ALSO returns stale cache if available
 * Returns { cache, isStale } where cache can be stale but still usable
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
        meta,
      }),
    });
    console.log(`[CATALOG_HOME] Cache saved key=${cacheKey} items=${items.length} expiresAt=${expiresAt}`);
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

/**
 * Validate if an Amazon ASIN is click-safe
 * Must be exactly 10 alphanumeric characters
 */
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
  
  // Validate eBay ID is click-safe
  if (!isValidEbayId(itemId)) {
    console.log(`[CATALOG_HOME][WARN] drop_unclickable provider=ebay id=${itemId}`);
    return null;
  }
  
  // Canonical ID format: ebay_<rawId> (raw ID includes v1| prefix if present)
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
  
  // Validate ASIN is click-safe
  if (!isValidAsin(asin)) {
    console.log(`[CATALOG_HOME][WARN] drop_unclickable provider=amazon asin=${asin}`);
    return null;
  }
  
  // Canonical ID format: amazon_<ASIN>
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
    // Map and filter: null items are invalid/unclickable
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
    // Map and filter: null items are invalid/unclickable
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

// ===== SEGMENT CONFIGURATIONS =====
function getSegmentConfigs(poolSize: number): SegmentConfig[] {
  // Scale proportions to pool size
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
      excludePatterns: [], // We WANT accessories here
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
  const fetchLimit = Math.ceil(config.target * 4); // Fetch 4x target to ensure enough after filtering
  const perSeed = Math.ceil(fetchLimit / config.seeds.length);
  
  // Fetch from Amazon
  const amazonPromises = config.seeds.map(seed =>
    fetchRainforestItems(seed, perSeed, amazonDomain, correlationId, config.name)
  );
  
  let allItems: CatalogItem[] = [];
  
  const amazonResults = await Promise.all(amazonPromises);
  allItems.push(...amazonResults.flat());
  
  // Fetch from eBay for some segments
  if (ebayToken && ["accessories", "cars", "gaming"].includes(config.name)) {
    const ebaySeeds = config.seeds.slice(0, 4); // Use first 4 seeds for eBay
    const ebayPromises = ebaySeeds.map(seed =>
      fetchEbayItems(seed, 30, ebayToken, correlationId, config.name)
    );
    const ebayResults = await Promise.all(ebayPromises);
    allItems.push(...ebayResults.flat());
  }
  
  // Filter
  allItems = filterByPatterns(allItems, config.excludePatterns);
  
  // Price filter if specified
  if (config.minPrice) {
    allItems = allItems.filter(i => (i.price_usd || 0) >= config.minPrice!);
  }
  
  // Dedupe and shuffle
  allItems = deduplicateItems(allItems);
  allItems = stableShuffle(allItems, `${correlationId}_${config.name}`);
  
  // Keep target
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
  
  // Build all segments in parallel
  const segmentPromises = segments.map(config =>
    buildSegment(config, amazonDomain, ebayToken, correlationId)
  );
  
  const segmentResults = await Promise.all(segmentPromises);
  
  // Combine in order: phones -> accessories -> cars -> gaming -> home
  let allItems: CatalogItem[] = [];
  const segmentCounts: Record<string, number> = {};
  
  for (let i = 0; i < segments.length; i++) {
    const segmentItems = segmentResults[i];
    allItems.push(...segmentItems);
    segmentCounts[segments[i].name] = segmentItems.length;
  }
  
  // Cross-dedupe
  const beforeDedup = allItems.length;
  allItems = deduplicateItems(allItems);
  const afterDedup = allItems.length;
  
  if (beforeDedup > afterDedup) {
    console.log(`[CATALOG_HOME] correlationId=${correlationId} cross_dedup removed=${beforeDedup - afterDedup}`);
  }
  
  // Check shortfall
  const shortfall = allItems.length < settings.poolSize;
  if (shortfall) {
    console.log(`[CATALOG_HOME][WARN] correlationId=${correlationId} shortfall final=${allItems.length} target=${settings.poolSize}`);
  }
  
  const ms = Date.now() - startMs;
  console.log(`[CATALOG_HOME] correlationId=${correlationId} built total=${allItems.length} segments=${JSON.stringify(segmentCounts)} ms=${ms}`);
  
  return { items: allItems, segmentCounts, ms, shortfall };
}

// ===== LIVE FETCH (for Load More) =====
async function fetchLiveItems(
  page: number,
  pageSize: number,
  amazonDomain: string,
  ebayToken: string | null,
  correlationId: string
): Promise<CatalogItem[]> {
  const startMs = Date.now();
  
  // Rotate through different seeds based on page
  const liveSeeds = [
    "electronics deals", "smartphone accessories", "home gadgets",
    "gaming deals", "tech accessories", "kitchen appliances",
    "laptop accessories", "smart home devices", "fitness electronics"
  ];
  
  const seedIndex = (page - 1) % liveSeeds.length;
  const seed = liveSeeds[seedIndex];
  
  let items: CatalogItem[] = [];
  
  // Fetch from both providers
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
  
  // CORS preflight - ALWAYS handle first
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();

  // Wrap EVERYTHING in try/catch to guarantee no throws
  try {
    // Parse parameters
    const url = new URL(req.url);
    let page = 1;
    let pageSize = 0; // 0 means use default from settings
    let category = "";
    let amazonDomain = "amazon.com";
    let forceLive = false;

    // CRITICAL: Normalize environment with proper fallback
    const { envRequested, envUsed } = normalizeEnv(req);
    let env = envUsed;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        page = parseInt(body.page) || 1;
        pageSize = parseInt(body.pageSize) || 0;
        category = body.category || "";
        amazonDomain = body.amazon_domain || "amazon.com";
        // Override env from body if provided (but still normalize)
        if (body.env) {
          const bodyEnv = body.env.toLowerCase().trim();
          env = bodyEnv === "prod" ? "production" : (["production", "staging", "dev"].includes(bodyEnv) ? bodyEnv : "production");
        }
        forceLive = body.live === true || body.live === "1" || body.source === "live";
      } catch {
        // Use defaults - don't throw
      }
    } else {
      page = parseInt(url.searchParams.get("page") || "1") || 1;
      pageSize = parseInt(url.searchParams.get("pageSize") || "0") || 0;
      category = url.searchParams.get("category") || "";
      amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
      forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("source") === "live";
    }

    // Load settings (with fallback to defaults)
    let settings: FeedSettings;
    try {
      settings = await loadFeedSettings();
    } catch (settingsErr) {
      console.warn(`[CATALOG_HOME] Settings load failed, using defaults: ${settingsErr}`);
      settings = {
        poolSize: DEFAULT_POOL_SIZE,
        pageSize: DEFAULT_PAGE_SIZE,
        ttlSeconds: DEFAULT_TTL_SECONDS,
        enabled: true,
      };
    }
    
    // Use settings page size if not specified (default 100)
    if (pageSize === 0) {
      pageSize = settings.pageSize;
    }
    // Cap page size at 200, default to 100
    pageSize = Math.min(Math.max(pageSize, 1), 200);

    console.log(`[CATALOG_HOME] start correlationId=${correlationId} envRequested=${envRequested} envUsed=${env} page=${page} pageSize=${pageSize} category=${category} forceLive=${forceLive}`);

    if (!settings.enabled) {
      console.log(`[CATALOG_HOME] correlationId=${correlationId} feed_disabled`);
      return jsonResponse({
        ok: true,
        sections: [{ key: "featured", title: "", title_en: "", title_fr: "", hideTitle: true, items: [] }],
        page,
        pageSize,
        totalPages: 0,
        correlationId,
        _meta: { cache: "disabled" }
      });
    }

    // ===== CACHE-FIRST: Check for valid cache (includes stale fallback) =====
    let cached: CacheEntry | null = null;
    let isStale = false;
    let cacheEnvUsed = env; // Track which env cache was actually used
    
    try {
      const cacheResult = await getCachedFeedWithStale(env, category);
      cached = cacheResult.cache;
      isStale = cacheResult.isStale;
      
      // CRITICAL: If requested env (e.g., staging) has no cache, fall back to production
      if ((!cached || !cached.items || cached.items.length === 0) && env !== "production") {
        console.log(`[CATALOG_HOME] cache_fallback_to_production correlationId=${correlationId} envRequested=${envRequested} envUsed=${env} reason=no_cache_for_env`);
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
    
    if (cached && cached.items && cached.items.length > 0) {
      const actualTotalPages = Math.ceil(cached.items.length / pageSize);
      
      // If requesting page beyond cached pages, switch to live
      if (!forceLive && page <= actualTotalPages) {
        const offset = (page - 1) * pageSize;
        const pageItems = cached.items.slice(offset, offset + pageSize);
        const hasMoreCached = page < actualTotalPages;
        
        const expiresIn = Math.round((new Date(cached.expires_at).getTime() - Date.now()) / 1000);
        
        console.log(`[CATALOG_HOME] cache_hit correlationId=${correlationId} isStale=${isStale} expiresAt=${cached.expires_at} expiresIn=${expiresIn}s poolSize=${cached.items.length} page=${page}/${actualTotalPages} returning=${pageItems.length} hasMoreCached=${hasMoreCached} cacheEnvUsed=${cacheEnvUsed}`);
        
        return jsonResponse({
          ok: true, // CRITICAL: Always ok:true when we have items
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
          totalItems: cached.items.length,
          hasMore: true, // Always true - can continue with live after cache
          hasMoreCached, // True if more cached pages available
          ttlSeconds: settings.ttlSeconds,
          correlationId,
          meta: {
            envUsed: cacheEnvUsed,
            envRequested,
            source: "cache",
            isStale,
            correlationId,
            ts: Date.now(),
          },
          _meta: {
            source: "cache",
            cache: isStale ? "stale" : "hit",
            isStale,
            envUsed: cacheEnvUsed,
            envRequested,
            expiresAt: cached.expires_at,
            ttlSeconds: settings.ttlSeconds,
            poolSize: cached.items.length,
            page,
            totalPages: actualTotalPages,
            ...cached.meta
          }
        });
      }
      
      // Page is beyond cached pages OR forceLive - use live mode
      const reason = forceLive ? "force_live" : "cache_exhausted";
      console.log(`[CATALOG_HOME] live_mode correlationId=${correlationId} page=${page} actualTotalPages=${actualTotalPages} reason=${reason}`);
      
      let liveItems: CatalogItem[] = [];
      try {
        const ebayToken = await getEbayToken();
        liveItems = await fetchLiveItems(page, pageSize, amazonDomain, ebayToken, correlationId);
      } catch (liveErr) {
        console.warn(`[CATALOG_HOME] Live fetch failed, serving empty: ${liveErr}`);
      }
      
      return jsonResponse({
        ok: true,
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
        totalPages: actualTotalPages,
        totalItems: liveItems.length,
        hasMore: liveItems.length >= pageSize, // Assume more if we got a full page
        hasMoreCached: false, // No more cached pages
        correlationId,
        _meta: {
          source: "live",
          reason,
          page,
          pageSize,
          cachedTotalPages: actualTotalPages,
          liveCount: liveItems.length,
        }
      });
    }

    // ===== FORCE LIVE if requested but no cache =====
    if (forceLive) {
      console.log(`[CATALOG_HOME] live_mode_no_cache correlationId=${correlationId} page=${page}`);
      
      let liveItems: CatalogItem[] = [];
      try {
        const ebayToken = await getEbayToken();
        liveItems = await fetchLiveItems(page, pageSize, amazonDomain, ebayToken, correlationId);
      } catch (liveErr) {
        console.warn(`[CATALOG_HOME] Live fetch failed: ${liveErr}`);
      }
      
      return jsonResponse({
        ok: true,
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
        totalPages: 0,
        totalItems: liveItems.length,
        hasMore: liveItems.length >= pageSize,
        hasMoreCached: false,
        correlationId,
        _meta: {
          source: "live",
          reason: "force_live_no_cache",
          page,
          pageSize,
          liveCount: liveItems.length,
        }
      });
    }

    console.log(`[CATALOG_HOME] cache_miss correlationId=${correlationId} building_feed...`);

    // ===== CACHE MISS: Build fresh feed =====
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
      console.error(`[CATALOG_HOME][ERROR] Build failed, checking stale cache: ${buildErr}`);
      
      // Try stale cache as fallback
      try {
        const staleResult = await getCachedFeedWithStale(env, category);
        if (staleResult.cache && staleResult.cache.items.length > 0) {
          console.log(`[CATALOG_HOME] build_failed_using_stale correlationId=${correlationId} items=${staleResult.cache.items.length}`);
          
          const staleItems = staleResult.cache.items;
          const actualTotalPages = Math.ceil(staleItems.length / pageSize);
          const offset = (page - 1) * pageSize;
          const pageItems = staleItems.slice(offset, offset + pageSize);
          
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
            totalItems: staleItems.length,
            hasMore: true,
            hasMoreCached: page < actualTotalPages,
            correlationId,
            _meta: {
              source: "cache",
              cache: "stale_fallback",
              isStale: true,
              buildError: String(buildErr),
              poolSize: staleItems.length,
              page,
              totalPages: actualTotalPages,
            }
          });
        }
      } catch (staleFetchErr) {
        console.error(`[CATALOG_HOME][ERROR] Stale cache fallback also failed: ${staleFetchErr}`);
      }
      
      // Total failure - return empty feed with ok: false but HTTP 200
      console.error(`[CATALOG_HOME][ERROR] Total failure, returning empty feed: ${buildErr}`);
      return emptyFeedResponse(correlationId, String(buildErr), { buildError: String(buildErr) });
    }

    // Save to cache (async, don't wait, don't fail if save fails)
    try {
      saveCachedFeed(env, category, items, settings.ttlSeconds, { 
        segmentCounts,
        total: items.length,
        buildMs,
        shortfall,
      });
    } catch (saveErr) {
      console.warn(`[CATALOG_HOME] Cache save failed (non-fatal): ${saveErr}`);
    }

    // Paginate response
    const offset = (page - 1) * pageSize;
    const pageItems = items.slice(offset, offset + pageSize);
    const actualTotalPages = Math.ceil(items.length / pageSize);
    const hasMoreCached = page < actualTotalPages;

    const totalMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME] success correlationId=${correlationId} returned=${pageItems.length} poolSize=${items.length} page=${page}/${actualTotalPages} totalMs=${totalMs}`);

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
      totalItems: items.length,
      hasMore: true, // Always true - can continue with live after cache
      hasMoreCached,
      ttlSeconds: settings.ttlSeconds,
      correlationId,
      _meta: {
        source: "cache",
        cache: "miss",
        building_feed_ms: buildMs,
        segmentCounts,
        total: items.length,
        page,
        totalPages: actualTotalPages,
        shortfall,
      }
    });
  } catch (err) {
    // CRITICAL: This catch block ensures we NEVER throw
    const totalMs = Date.now() - startTime;
    console.error(`[CATALOG_HOME][ERROR] correlationId=${correlationId} error=${err} stack=${(err as Error).stack} ms=${totalMs}`);
    
    // Return proper empty feed structure with HTTP 200
    return emptyFeedResponse(correlationId, String(err), { 
      totalMs,
      stack: (err as Error).stack,
    });
  }
});
