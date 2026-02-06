import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home - Single unified homepage feed with cache-first loading
 * 
 * Returns ONE feed (no multiple titled sections) with:
 * - First 100 items: Amazon popular electronics
 * - Last 100 items: Mixed Amazon+eBay deals/refurbished
 * 
 * Cache TTL is admin-controlled via admin_settings table.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Default settings (overridden by admin_settings)
const DEFAULT_TTL_SECONDS = 172800; // 2 days
const DEFAULT_LIMIT = 200;
const DEFAULT_AMAZON_FIRST = 100;
const DEFAULT_DEALS_COUNT = 100;

interface FeedSettings {
  ttlSeconds: number;
  limit: number;
  amazonFirstCount: number;
  dealsCount: number;
  enabled: boolean;
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
      ttlSeconds: DEFAULT_TTL_SECONDS,
      limit: DEFAULT_LIMIT,
      amazonFirstCount: DEFAULT_AMAZON_FIRST,
      dealsCount: DEFAULT_DEALS_COUNT,
      enabled: true,
    };
  }

  try {
    const keys = [
      "home_feed_ttl_seconds",
      "home_feed_limit", 
      "home_feed_amazon_first_count",
      "home_feed_deals_count",
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
        ttlSeconds: DEFAULT_TTL_SECONDS,
        limit: DEFAULT_LIMIT,
        amazonFirstCount: DEFAULT_AMAZON_FIRST,
        dealsCount: DEFAULT_DEALS_COUNT,
        enabled: true,
      };
    }

    const rows = await res.json() as Array<{ key: string; value: string }>;
    const settingsMap = new Map(rows.map(r => [r.key, r.value]));

    return {
      ttlSeconds: parseInt(settingsMap.get("home_feed_ttl_seconds") || "") || DEFAULT_TTL_SECONDS,
      limit: parseInt(settingsMap.get("home_feed_limit") || "") || DEFAULT_LIMIT,
      amazonFirstCount: parseInt(settingsMap.get("home_feed_amazon_first_count") || "") || DEFAULT_AMAZON_FIRST,
      dealsCount: parseInt(settingsMap.get("home_feed_deals_count") || "") || DEFAULT_DEALS_COUNT,
      enabled: settingsMap.get("home_feed_enabled") !== "false",
    };
  } catch (err) {
    console.warn(`[CATALOG_HOME] Settings load error: ${err}`);
    return {
      ttlSeconds: DEFAULT_TTL_SECONDS,
      limit: DEFAULT_LIMIT,
      amazonFirstCount: DEFAULT_AMAZON_FIRST,
      dealsCount: DEFAULT_DEALS_COUNT,
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
      // No cache found
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

function mapEbayItem(item: Record<string, unknown>): CatalogItem {
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
  };
}

function mapRainforestItem(item: Record<string, unknown>): CatalogItem {
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
  };
}

async function fetchEbayItems(
  query: string,
  limit: number,
  ebayToken: string,
  correlationId: string
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
    const items = rawItems.map(mapEbayItem).filter((i: CatalogItem) => i.title && i.image_url);
    
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
  correlationId: string
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
    const items = rawItems.slice(0, limit).map(mapRainforestItem).filter((i: CatalogItem) => i.title && i.image_url && i.price_usd);
    
    console.log(`[CATALOG_HOME][RAINFOREST] correlationId=${correlationId} query="${query.substring(0,30)}" fetched=${rawItems.length} kept=${items.length} ms=${Date.now()-startMs}`);
    return items;
  } catch (err) {
    console.error(`[CATALOG_HOME][RAINFOREST] correlationId=${correlationId} query="${query}" exception=${err}`);
    return [];
  }
}

// Light filtering - only remove obvious accessories
const EXCLUDE_PATTERNS = [
  /\bcase\b/i, /\bcover\b/i, /\bscreen protector\b/i, /\btempered glass\b/i,
  /\bdigitizer\b/i, /\blcd only\b/i, /\bhousing\b/i, /\bframe only\b/i,
  /\brepair kit\b/i, /\breplacement part\b/i, /\bfor parts\b/i
];

function lightFilter(items: CatalogItem[]): CatalogItem[] {
  return items.filter(item => {
    if (!item.title || !item.image_url) return false;
    const title = item.title.toLowerCase();
    return !EXCLUDE_PATTERNS.some(pattern => pattern.test(title));
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

// Stable shuffle using correlationId as seed
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

async function buildFeed(
  settings: FeedSettings,
  correlationId: string,
  amazonDomain: string,
  ebayToken: string | null
): Promise<{ items: CatalogItem[]; amazonCount: number; dealsCount: number; ebayCount: number; ms: number; shortfall: boolean; shortfallReason?: string }> {
  const startMs = Date.now();
  const targetTotal = settings.limit; // default 200
  const targetAmazon = settings.amazonFirstCount; // default 100
  const targetDeals = settings.dealsCount; // default 100
  
  let shortfall = false;
  let shortfallReason = "";
  
  // ===== BLOCK 1: Amazon Popular Electronics (first 100) =====
  // Fetch MORE than needed (400) to allow for filtering and dedup
  const amazonSeeds = [
    "iphone unlocked",
    "samsung galaxy unlocked", 
    "airpods pro",
    "ipad pro",
    "ps5 console",
    "macbook laptop",
    "nintendo switch oled",
    "gaming laptop",
    "sony headphones",
    "apple watch",
    "samsung tablet",
    "kindle fire tablet"
  ];
  
  console.log(`[CATALOG_HOME] correlationId=${correlationId} building amazon block seeds=${amazonSeeds.length} target=${targetAmazon}`);
  
  // Fetch 35 items per seed to get ~400+ raw items
  const amazonPromises = amazonSeeds.map(seed => 
    fetchRainforestItems(seed, 35, amazonDomain, correlationId)
  );
  
  const amazonResults = await Promise.all(amazonPromises);
  let amazonRaw = amazonResults.flat();
  amazonRaw = lightFilter(amazonRaw);
  amazonRaw = deduplicateItems(amazonRaw);
  amazonRaw = stableShuffle(amazonRaw, correlationId + "_amazon");
  
  // Keep exactly targetAmazon (100)
  const amazonItems = amazonRaw.slice(0, targetAmazon);
  const amazonKept = amazonItems.length;
  
  console.log(`[CATALOG_HOME] correlationId=${correlationId} amazonBlock raw=${amazonRaw.length} kept=${amazonKept}`);

  // ===== BLOCK 2: Mixed Deals/Refurbished (last 100) =====
  // Fetch MORE than needed (400) for deals block
  const amazonDealsSeeds = [
    "refurbished iphone unlocked",
    "renewed iphone unlocked",
    "android phone unlocked",
    "refurbished laptop",
    "refurbished macbook",
    "certified refurbished electronics"
  ];
  
  const ebayDealsSeeds = [
    "refurbished iphone",
    "gaming console used",
    "laptop refurbished",
    "airpods renewed",
    "ps4 console used",
    "ipad refurbished",
    "samsung galaxy renewed"
  ];
  
  let dealsRaw: CatalogItem[] = [];
  let ebayKept = 0;
  
  // Amazon deals - fetch 40 per seed
  console.log(`[CATALOG_HOME] correlationId=${correlationId} building deals block amazonSeeds=${amazonDealsSeeds.length}`);
  const amazonDealsPromises = amazonDealsSeeds.map(seed =>
    fetchRainforestItems(seed, 40, amazonDomain, correlationId)
  );
  const amazonDealsResults = await Promise.all(amazonDealsPromises);
  dealsRaw.push(...amazonDealsResults.flat());
  
  // eBay deals if token available - fetch 30 per seed
  if (ebayToken) {
    console.log(`[CATALOG_HOME] correlationId=${correlationId} building deals block ebaySeeds=${ebayDealsSeeds.length}`);
    const ebayPromises = ebayDealsSeeds.map(seed =>
      fetchEbayItems(seed, 30, ebayToken, correlationId)
    );
    const ebayResults = await Promise.all(ebayPromises);
    const ebayItems = ebayResults.flat();
    ebayKept = ebayItems.length;
    dealsRaw.push(...ebayItems);
  } else {
    console.log(`[CATALOG_HOME][WARN] correlationId=${correlationId} no_ebay_token deals will be amazon-only`);
    shortfallReason = "no_ebay_token";
  }
  
  dealsRaw = lightFilter(dealsRaw);
  dealsRaw = deduplicateItems(dealsRaw);
  dealsRaw = stableShuffle(dealsRaw, correlationId + "_deals");
  
  // Keep exactly targetDeals (100)
  const dealsItems = dealsRaw.slice(0, targetDeals);
  const dealsKept = dealsItems.length;
  
  console.log(`[CATALOG_HOME] correlationId=${correlationId} dealsBlock raw=${dealsRaw.length} kept=${dealsKept} ebayItems=${ebayKept}`);

  // ===== COMBINE =====
  let allItems = [...amazonItems, ...dealsItems];
  
  // Final cross-boundary de-dup (removes items that appear in both blocks)
  const beforeDedupCount = allItems.length;
  allItems = deduplicateItems(allItems);
  const afterDedupCount = allItems.length;
  const lostInDedup = beforeDedupCount - afterDedupCount;
  
  if (lostInDedup > 0) {
    console.log(`[CATALOG_HOME] correlationId=${correlationId} cross_dedup removed=${lostInDedup}`);
  }

  // ===== BACKFILL if needed to guarantee 200 =====
  if (allItems.length < targetTotal) {
    const deficit = targetTotal - allItems.length;
    console.log(`[CATALOG_HOME] correlationId=${correlationId} backfill_needed current=${allItems.length} target=${targetTotal} deficit=${deficit}`);
    
    // Backfill from unused amazon raw items
    const usedIds = new Set(allItems.map(i => `${i.provider}:${i.provider_product_id}`));
    const backfillCandidates = amazonRaw.filter(i => !usedIds.has(`${i.provider}:${i.provider_product_id}`));
    const backfillItems = backfillCandidates.slice(0, deficit);
    
    if (backfillItems.length > 0) {
      allItems.push(...backfillItems);
      console.log(`[CATALOG_HOME] correlationId=${correlationId} backfill added=${backfillItems.length} from amazonRaw`);
    }
    
    // If still short, try from deals raw
    if (allItems.length < targetTotal) {
      const usedIds2 = new Set(allItems.map(i => `${i.provider}:${i.provider_product_id}`));
      const dealsBackfill = dealsRaw.filter(i => !usedIds2.has(`${i.provider}:${i.provider_product_id}`));
      const deficit2 = targetTotal - allItems.length;
      const addFromDeals = dealsBackfill.slice(0, deficit2);
      
      if (addFromDeals.length > 0) {
        allItems.push(...addFromDeals);
        console.log(`[CATALOG_HOME] correlationId=${correlationId} backfill added=${addFromDeals.length} from dealsRaw`);
      }
    }
  }
  
  // Final slice to limit
  const finalItems = allItems.slice(0, targetTotal);
  
  // Check for shortfall
  if (finalItems.length < targetTotal) {
    shortfall = true;
    shortfallReason = shortfallReason || "provider_timeout_or_low_results";
    console.log(`[CATALOG_HOME][WARN] correlationId=${correlationId} shortfall final=${finalItems.length} target=${targetTotal} reason=${shortfallReason}`);
  }
  
  const ms = Date.now() - startMs;
  console.log(`[CATALOG_HOME] correlationId=${correlationId} built amazonKept=${amazonKept} dealsKept=${dealsKept} ebayCount=${ebayKept} final=${finalItems.length} ms=${ms}`);
  
  return { 
    items: finalItems, 
    amazonCount: amazonKept, 
    dealsCount: dealsKept,
    ebayCount: ebayKept,
    ms,
    shortfall,
    shortfallReason
  };
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
    let pageSize = 20;
    let category = "";
    let amazonDomain = "amazon.com";
    let env = "prod";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        page = parseInt(body.page) || 1;
        pageSize = Math.min(Math.max(parseInt(body.pageSize) || 20, 1), 200);
        category = body.category || "";
        amazonDomain = body.amazon_domain || "amazon.com";
        env = body.env || "prod";
      } catch {
        // Use defaults
      }
    } else {
      page = parseInt(url.searchParams.get("page") || "1") || 1;
      pageSize = Math.min(Math.max(parseInt(url.searchParams.get("pageSize") || "20"), 1), 200);
      category = url.searchParams.get("category") || "";
      amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
      env = url.searchParams.get("env") || req.headers.get("X-Afrishop-Environment") || "prod";
    }

    console.log(`[CATALOG_HOME] start correlationId=${correlationId} env=${env} page=${page} pageSize=${pageSize} category=${category}`);

    // Load settings
    const settings = await loadFeedSettings();
    
    if (!settings.enabled) {
      console.log(`[CATALOG_HOME] correlationId=${correlationId} feed_disabled`);
      return jsonResponse({
        ok: true,
        sections: [{ key: "featured", title: "", title_en: "", title_fr: "", items: [] }],
        page,
        pageSize,
        correlationId,
        _meta: { cache: "disabled" }
      });
    }

    // ===== CACHE-FIRST: Check for valid cache =====
    const cached = await getCachedFeed(env, category);
    
    if (cached && cached.items && cached.items.length > 0) {
      const offset = (page - 1) * pageSize;
      const pageItems = cached.items.slice(offset, offset + pageSize);
      
      const expiresIn = Math.round((new Date(cached.expires_at).getTime() - Date.now()) / 1000);
      
      console.log(`[CATALOG_HOME] cache_hit correlationId=${correlationId} expiresAt=${cached.expires_at} expiresIn=${expiresIn}s count=${cached.items.length} returning=${pageItems.length}`);
      
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
        totalItems: cached.items.length,
        ttlSeconds: settings.ttlSeconds,
        correlationId,
        _meta: {
          cache: "hit",
          expiresAt: cached.expires_at,
          ttlSeconds: settings.ttlSeconds,
          ...cached.meta
        }
      });
    }

    console.log(`[CATALOG_HOME] cache_miss correlationId=${correlationId} building_feed...`);

    // ===== CACHE MISS: Build fresh feed =====
    const ebayToken = await getEbayToken();
    
    const { items, amazonCount, dealsCount, ebayCount, ms: buildMs, shortfall, shortfallReason } = await buildFeed(
      settings,
      correlationId,
      amazonDomain,
      ebayToken
    );

    // Save to cache with full meta (async, don't wait)
    saveCachedFeed(env, category, items, settings.ttlSeconds, { 
      amazonCount, 
      dealsCount, 
      ebayCount, 
      total: items.length,
      buildMs,
      shortfall,
      shortfallReason 
    });

    // Paginate response
    const offset = (page - 1) * pageSize;
    const pageItems = items.slice(offset, offset + pageSize);

    const totalMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME] success correlationId=${correlationId} returned=${pageItems.length} one_feed=true sections=1 totalMs=${totalMs}`);

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
      totalItems: items.length,
      ttlSeconds: settings.ttlSeconds,
      correlationId,
      _meta: {
        cache: "miss",
        building_feed_ms: buildMs,
        amazonCount,
        dealsCount,
        ebayCount,
        total: items.length,
        shortfall,
        shortfallReason
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
