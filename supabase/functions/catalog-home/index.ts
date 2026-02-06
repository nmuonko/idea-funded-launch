import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home - Single unified homepage feed with cache-first loading
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

async function getCachedFeed(env: string, category: string): Promise<CacheEntry | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return null;

  const cacheKey = `${env}:${category || "all"}`;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/catalog_home_cache?id=eq.${encodeURIComponent(cacheKey)}&expires_at=gt.${new Date().toISOString()}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );

    if (res.status === 406 || !res.ok) {
      return null;
    }

    const data = await res.json();
    return data as CacheEntry;
  } catch (err) {
    console.warn(`[CATALOG_HOME] Cache read error: ${err}`);
    return null;
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

function mapEbayItem(item: Record<string, unknown>, segment?: string): CatalogItem {
  const priceUsd = extractPriceFromEbay(item);
  const imageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || null;
  const productUrl = (item.itemWebUrl as string) || null;
  const priceObj = item.price as Record<string, unknown> | undefined;
  
  return {
    id: `ebay_${item.itemId}`,
    provider: "ebay",
    provider_product_id: item.itemId as string,
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

function mapRainforestItem(item: Record<string, unknown>, segment?: string): CatalogItem {
  const asin = item.asin as string || "";
  const price = item.price as Record<string, unknown> | undefined;
  const priceValue = price?.value as number || null;
  const imageUrl = item.image as string || (item.main_image as Record<string, unknown>)?.link as string || null;
  
  return {
    id: `amazon_${asin}`,
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
    const items = rawItems.map((i: Record<string, unknown>) => mapEbayItem(i, segment)).filter((i: CatalogItem) => i.title && i.image_url);
    
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
    const items = rawItems.slice(0, limit).map((i: Record<string, unknown>) => mapRainforestItem(i, segment)).filter((i: CatalogItem) => i.title && i.image_url && i.price_usd);
    
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
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Parse parameters
    const url = new URL(req.url);
    let page = 1;
    let pageSize = 0; // 0 means use default from settings
    let category = "";
    let amazonDomain = "amazon.com";
    let env = "prod";
    let forceLive = false;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        page = parseInt(body.page) || 1;
        pageSize = parseInt(body.pageSize) || 0;
        category = body.category || "";
        amazonDomain = body.amazon_domain || "amazon.com";
        env = body.env || "prod";
        forceLive = body.live === true || body.live === "1" || body.source === "live";
      } catch {
        // Use defaults
      }
    } else {
      page = parseInt(url.searchParams.get("page") || "1") || 1;
      pageSize = parseInt(url.searchParams.get("pageSize") || "0") || 0;
      category = url.searchParams.get("category") || "";
      amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
      env = url.searchParams.get("env") || req.headers.get("X-Afrishop-Environment") || "prod";
      forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("source") === "live";
    }

    // Load settings
    const settings = await loadFeedSettings();
    
    // Use settings page size if not specified (default 100)
    if (pageSize === 0) {
      pageSize = settings.pageSize;
    }
    // Cap page size at 200, default to 100
    pageSize = Math.min(Math.max(pageSize, 1), 200);

    console.log(`[CATALOG_HOME] start correlationId=${correlationId} env=${env} page=${page} pageSize=${pageSize} category=${category} forceLive=${forceLive}`);

    if (!settings.enabled) {
      console.log(`[CATALOG_HOME] correlationId=${correlationId} feed_disabled`);
      return jsonResponse({
        ok: true,
        sections: [{ key: "feed", title: "", title_en: "", title_fr: "", hideTitle: true, items: [] }],
        page,
        pageSize,
        totalPages: 0,
        correlationId,
        _meta: { cache: "disabled" }
      });
    }

    // ===== CACHE-FIRST: Check for valid cache =====
    const cached = await getCachedFeed(env, category);
    
    if (cached && cached.items && cached.items.length > 0) {
      const actualTotalPages = Math.ceil(cached.items.length / pageSize);
      
      // If requesting page beyond cached pages, switch to live
      if (!forceLive && page <= actualTotalPages) {
        const offset = (page - 1) * pageSize;
        const pageItems = cached.items.slice(offset, offset + pageSize);
        const hasMoreCached = page < actualTotalPages;
        
        const expiresIn = Math.round((new Date(cached.expires_at).getTime() - Date.now()) / 1000);
        
        console.log(`[CATALOG_HOME] cache_hit correlationId=${correlationId} expiresAt=${cached.expires_at} expiresIn=${expiresIn}s poolSize=${cached.items.length} page=${page}/${actualTotalPages} returning=${pageItems.length} hasMoreCached=${hasMoreCached}`);
        
        return jsonResponse({
          ok: true,
          sections: [{
            key: "feed",
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
          _meta: {
            source: "cache",
            cache: "hit",
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
      
      const ebayToken = await getEbayToken();
      const liveItems = await fetchLiveItems(page, pageSize, amazonDomain, ebayToken, correlationId);
      
      return jsonResponse({
        ok: true,
        sections: [{
          key: "feed",
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
      
      const ebayToken = await getEbayToken();
      const liveItems = await fetchLiveItems(page, pageSize, amazonDomain, ebayToken, correlationId);
      
      return jsonResponse({
        ok: true,
        sections: [{
          key: "feed",
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
    const ebayToken = await getEbayToken();
    
    const { items, segmentCounts, ms: buildMs, shortfall } = await buildFullFeed(
      settings,
      correlationId,
      amazonDomain,
      ebayToken
    );

    // Save to cache (async, don't wait)
    saveCachedFeed(env, category, items, settings.ttlSeconds, { 
      segmentCounts,
      total: items.length,
      buildMs,
      shortfall,
    });

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
        key: "feed",
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
    const totalMs = Date.now() - startTime;
    console.error(`[CATALOG_HOME][ERROR] correlationId=${correlationId} error=${err} ms=${totalMs}`);
    
    return jsonResponse({
      ok: false,
      error: String(err),
      sections: [],
      correlationId
    }, 200); // Always return 200 with error in body
  }
});
