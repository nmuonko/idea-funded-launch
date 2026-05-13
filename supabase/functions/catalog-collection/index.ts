/**
 * Catalog Collection Endpoint
 * 
 * Serves cached collection data from DB, with optional live fallback for staging.
 * Returns stable JSON shape: { status, env, provider, collectionKey, page, pageSize, total, items, error }
 * 
 * Query params:
 *   - collectionKey (required): ebay_trending_all, electronics_trending, phones_trending, vehicles_trending, etc.
 *   - slug (alias for collectionKey for backward compatibility)
 *   - provider (optional): "ebay" | "rainforest" | "all" (default: "ebay")
 *   - page (default: 1)
 *   - pageSize (default: 20, max: 40)
 *   - env (optional): staging | production
 *   - mode (optional): "db" | "live" (default: "db", live only in staging)
 */

import { createClient } from "@supabase/supabase-js";
import { sanitizeGallery, sanitizeImageUrl, bestProductImage } from "../_shared/imageValidator.ts";

// ─── CORS Headers ────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface CollectionItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string;
  inStock: boolean;
}

interface CollectionResponse {
  status: "success" | "error";
  env: string;
  provider: string;
  collectionKey: string;
  page: number;
  pageSize: number;
  total: number;
  items: CollectionItem[];
  error: { message: string; code: string } | null;
}

// ─── Collection Query Mappings ───────────────────────────────────────────────
// Map collection keys to eBay search queries and category keys

interface CollectionConfig {
  q: string;
  categoryKey: string;
  isVehicle?: boolean;
  ttlSeconds: number; // TTL for caching
}

const COLLECTION_QUERIES: Record<string, CollectionConfig> = {
  // Main eBay trending - simple mixed electronics query
  ebay_trending_all: {
    q: "iphone laptop headphones",
    categoryKey: "electronics",
    ttlSeconds: 2700, // 45 minutes
  },
  // Electronics focused
  electronics_trending: {
    q: "laptop headphones monitor",
    categoryKey: "electronics",
    ttlSeconds: 7200, // 2 hours
  },
  trending_electronics: {
    q: "laptop headphones earbuds",
    categoryKey: "electronics",
    ttlSeconds: 7200,
  },
  // Phones focused
  phones_trending: {
    q: "iphone samsung galaxy smartphone",
    categoryKey: "phones",
    ttlSeconds: 5400, // 1.5 hours
  },
  phones: {
    q: "iphone unlocked smartphone",
    categoryKey: "phones",
    ttlSeconds: 7200,
  },
  // Vehicles - Buy It Now only, no accessories (use category filter)
  vehicles_trending: {
    q: "used car truck suv",
    categoryKey: "vehicles",
    isVehicle: true,
    ttlSeconds: 2700, // 45 minutes
  },
  vehicles: {
    q: "car truck sedan",
    categoryKey: "vehicles",
    isVehicle: true,
    ttlSeconds: 2700,
  },
  tablets: {
    q: "ipad tablet surface",
    categoryKey: "tablets",
    ttlSeconds: 7200,
  },
  monitors: {
    q: "computer monitor gaming monitor",
    categoryKey: "monitors",
    ttlSeconds: 7200,
  },
  computers: {
    q: "laptop macbook gaming pc",
    categoryKey: "computers",
    ttlSeconds: 7200,
  },
  clothing: {
    q: "nike adidas sneakers",
    categoryKey: "clothing",
    ttlSeconds: 7200,
  },
};

// Frozen/older mobile builds still read these collection keys from
// mobile-public-config for the home screen. They must now resolve to the same
// smartphone-first feed as catalog-home, not mixed electronics/accessories.
const HOMEPAGE_SMARTPHONE_COMPAT_COLLECTIONS = new Set([
  "electronics_trending",
  "best_sellers_electronics",
  "deals_electronics",
  "web_homepage_mirror",
]);

// ─── Content Blocking ────────────────────────────────────────────────────────

// Global deny keywords (books, subscriptions, etc.)
const GLOBAL_DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "audiobook",
  "textbook", "novel", "comics", "journal", "membership", "streaming",
  "unlimited", "prime membership", "digital code", "activation code",
];

// Vehicle-specific deny keywords (accessories, parts)
const VEHICLE_DENY_KEYWORDS = [
  "floor mat", "floor mats", "car mat", "car mats",
  "wheels", "wheel", "tire", "tires", "rim", "rims",
  "seat cover", "seat covers", "car cover", "car covers",
  "snow chains", "chains", "accessory", "accessories",
  "parts", "replacement", "tool", "tools", "charger", "adapter",
  "brake pad", "brake pads", "oil filter", "air filter",
  "wiper", "wipers", "bulb", "bulbs", "led light", "led lights",
  "dash cam", "car stereo", "phone mount", "phone holder",
  "key fob", "key cover", "steering wheel cover", "sunshade",
  "trunk organizer", "trash can", "car vacuum", "jump starter",
];

// Vehicle allow signals - must have one of these
const VEHICLE_ALLOW_PATTERNS = [
  "car", "truck", "suv", "sedan", "coupe", "van", "pickup", "vehicle",
  "minivan", "hatchback", "convertible", "wagon",
];

// Minimum price for vehicles to filter out cheap accessories
const VEHICLE_MIN_PRICE_USD = 1500;

function isBlockedTitle(title: string, isVehicle: boolean = false): boolean {
  const lowerTitle = title.toLowerCase();
  
  // Global blocks
  for (const keyword of GLOBAL_DENY_KEYWORDS) {
    if (keyword.length <= 5) {
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      if (regex.test(lowerTitle)) return true;
    } else {
      if (lowerTitle.includes(keyword)) return true;
    }
  }
  
  // Vehicle-specific blocks
  if (isVehicle) {
    for (const keyword of VEHICLE_DENY_KEYWORDS) {
      if (lowerTitle.includes(keyword)) return true;
    }
  }
  
  return false;
}

function isValidVehicle(item: any): boolean {
  const title = (item.title || "").toLowerCase();
  const price = extractPrice(item.price);
  
  // Check for vehicle-specific deny keywords
  for (const keyword of VEHICLE_DENY_KEYWORDS) {
    if (title.includes(keyword)) return false;
  }
  
  // Must have a vehicle type indicator OR be expensive enough
  const hasVehicleType = VEHICLE_ALLOW_PATTERNS.some(pattern => title.includes(pattern));
  const isExpensiveEnough = price !== null && price >= VEHICLE_MIN_PRICE_USD;
  
  return hasVehicleType || isExpensiveEnough;
}

function isHomepagePhoneAccessoryTitle(title: string): boolean {
  return /\b(case|cover|glass|screen protector|protector|tempered glass|charger|cable|usb-?c|lightning|magsafe|adapter|mount|stand|holder|keyboard|mouse|watch\s*case|watch|band|bands|replacement|repair|parts?|battery|lens|stylus|dock|wallet|for\s+(iphone|samsung|galaxy|pixel)|compatible\s+with\s+(iphone|samsung|galaxy|pixel))\b/i.test(title);
}

function isHomepageSmartphoneTitle(title: string): boolean {
  if (isHomepagePhoneAccessoryTitle(title)) return false;
  const lower = title.toLowerCase();
  return /\biphone\s?(se|1[1-6]|xr|xs|x)\b/.test(lower)
    || /\bpixel\s?(6|7|8|9)\b/.test(lower)
    || /\b(samsung\s+)?galaxy\s+(s\d{1,2}|note\s?\d*|z\s?(fold|flip))\b/.test(lower)
    || /\boneplus\s+\d+/i.test(lower);
}

function isAuctionItem(item: any): boolean {
  // Check buyingOptions
  const buyingOptions = item.buyingOptions || [];
  if (Array.isArray(buyingOptions)) {
    return buyingOptions.includes("AUCTION") && !buyingOptions.includes("FIXED_PRICE");
  }
  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Debug Logging ───────────────────────────────────────────────────────────

function debugLog(marker: string, data: Record<string, any>): void {
  console.log(`[${marker}]`, JSON.stringify(data));
}

// ─── eBay OAuth Token ────────────────────────────────────────────────────────

const EBAY_ENDPOINTS = {
  production: {
    oauth: "https://api.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.ebay.com/buy/browse/v1",
  },
  sandbox: {
    oauth: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.sandbox.ebay.com/buy/browse/v1",
  },
};

const EBAY_OAUTH_SCOPES = "https://api.ebay.com/oauth/api_scope";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

async function getEbayToken(supabase: any): Promise<string | null> {
  // Check for cached token
  const { data: cached } = await supabase
    .from("provider_tokens")
    .select("access_token, expires_at")
    .eq("provider", "ebay")
    .maybeSingle();

  if (cached) {
    const expiresAt = new Date(cached.expires_at).getTime();
    if (expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      return cached.access_token;
    }
  }

  // Mint new token
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";

  if (!clientId || !clientSecret) {
    debugLog("EBAY_TOKEN", { ok: false, error: "Credentials not configured" });
    return null;
  }

  const endpoint = EBAY_ENDPOINTS[environment].oauth;
  const credentials = btoa(`${clientId}:${clientSecret}`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_OAUTH_SCOPES)}`,
    });

    if (!response.ok) {
      debugLog("EBAY_TOKEN", { ok: false, status: response.status });
      return null;
    }

    const data = await response.json();
    const { access_token, expires_in } = data;
    const expiresAt = new Date(Date.now() + (expires_in * 1000) - TOKEN_EXPIRY_BUFFER_MS);

    // Cache token
    await supabase.from("provider_tokens").upsert({
      provider: "ebay",
      access_token,
      token_type: "Bearer",
      expires_at: expiresAt.toISOString(),
      scopes: [EBAY_OAUTH_SCOPES],
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider" });

    debugLog("EBAY_TOKEN", { ok: true, expiresIn: expires_in });
    return access_token;
  } catch (err) {
    debugLog("EBAY_TOKEN", { ok: false, error: err instanceof Error ? err.message : "Unknown" });
    return null;
  }
}

// ─── eBay Live Search ────────────────────────────────────────────────────────

async function fetchEbayLive(
  supabase: any,
  query: string,
  limit: number,
  offset: number,
  isVehicle: boolean = false
): Promise<{ items: CollectionItem[]; total: number; filterStats: Record<string, number> }> {
  const token = await getEbayToken(supabase);
  if (!token) {
    debugLog("EBAY_COLLECTION_LIVE", { error: "No token available" });
    return { items: [], total: 0, filterStats: {} };
  }

  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  
  // Build search params
  const params = new URLSearchParams({
    q: query,
    limit: String(limit + 20), // Fetch extra to account for filtering
    offset: String(offset),
    filter: "buyingOptions:{FIXED_PRICE}", // Buy It Now only
  });

  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item_summary/search?${params}`;
  
  debugLog("EBAY_COLLECTION_LIVE", { q: query, limit, offset, isVehicle, endpoint });

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      debugLog("EBAY_COLLECTION_LIVE", { error: `HTTP ${response.status}`, body: errorText.slice(0, 300) });
      return { items: [], total: 0, filterStats: {} };
    }

    const data = await response.json();
    const itemSummaries = data.itemSummaries || [];
    const total = data.total || 0;

    // Filter and normalize items
    const filterStats: Record<string, number> = {
      beforeFilters: itemSummaries.length,
      droppedBlocked: 0,
      droppedAuction: 0,
      droppedAccessories: 0,
      kept: 0,
    };

    const items: CollectionItem[] = [];
    for (const item of itemSummaries) {
      const title = item.title || "Unknown";
      
      // Skip auction items
      if (isAuctionItem(item)) {
        filterStats.droppedAuction++;
        continue;
      }

      // Skip globally blocked items
      if (isBlockedTitle(title, isVehicle)) {
        filterStats.droppedBlocked++;
        continue;
      }

      // Vehicle-specific filtering
      if (isVehicle && !isValidVehicle(item)) {
        filterStats.droppedAccessories++;
        continue;
      }

      filterStats.kept++;
      items.push({
        id: `ebay:${item.itemId}`,
        provider: "ebay",
        providerProductId: item.itemId,
        title,
        priceUsd: extractPrice(item.price),
        imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
        images: extractImages(item),
        productUrl: item.itemWebUrl || item.itemHref || "",
        inStock: item.itemAvailability?.availabilityStatus !== "OUT_OF_STOCK",
      });

      // Stop once we have enough items
      if (items.length >= limit) break;
    }

    debugLog("EBAY_WARM", { 
      collectionKey: query.slice(0, 30),
      q: query,
      beforeFilters: filterStats.beforeFilters,
      afterFilters: items.length,
    });

    if (isVehicle) {
      debugLog("VEHICLES_FILTER", {
        droppedAuctions: filterStats.droppedAuction,
        droppedAccessories: filterStats.droppedAccessories,
        kept: filterStats.kept,
      });
    }

    return { items, total: items.length, filterStats };
  } catch (err) {
    debugLog("EBAY_COLLECTION_LIVE", { error: err instanceof Error ? err.message : "Unknown" });
    return { items: [], total: 0, filterStats: {} };
  }
}

function extractPrice(priceObj: any): number | null {
  if (!priceObj?.value) return null;
  const val = parseFloat(priceObj.value);
  return isNaN(val) ? null : val;
}

function extractImages(item: any): string[] {
  const urls: string[] = [];
  
  if (item.image?.imageUrl) urls.push(item.image.imageUrl);
  if (Array.isArray(item.thumbnailImages)) {
    for (const img of item.thumbnailImages) {
      if (img.imageUrl && !urls.includes(img.imageUrl)) urls.push(img.imageUrl);
    }
  }
  if (Array.isArray(item.additionalImages)) {
    for (const img of item.additionalImages) {
      if (img.imageUrl && !urls.includes(img.imageUrl)) urls.push(img.imageUrl);
    }
  }

  return urls.slice(0, 10);
}

// ─── DB Cache Helpers ────────────────────────────────────────────────────────

async function getCachedCollection(
  supabase: any,
  cacheKey: string
): Promise<{ items: CollectionItem[]; total: number; hit: boolean; ttlRemaining: number }> {
  const { data: cache } = await supabase
    .from("catalog_collection_cache")
    .select("item_ids, total, updated_at, ttl_seconds")
    .eq("key", cacheKey)
    .maybeSingle();

  if (!cache) {
    debugLog("COLLECTION_CACHE", { hit: false, key: cacheKey, reason: "not_found" });
    return { items: [], total: 0, hit: false, ttlRemaining: 0 };
  }

  const updatedAt = new Date(cache.updated_at).getTime();
  const expiresAt = updatedAt + (cache.ttl_seconds * 1000);
  const ttlRemaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));

  if (ttlRemaining <= 0) {
    debugLog("COLLECTION_CACHE", { hit: false, key: cacheKey, reason: "expired" });
    return { items: [], total: 0, hit: false, ttlRemaining: 0 };
  }

  // Fetch items by IDs
  const itemIds = cache.item_ids || [];
  if (itemIds.length === 0) {
    debugLog("COLLECTION_CACHE", { hit: true, key: cacheKey, ttlRemaining, itemCount: 0 });
    return { items: [], total: cache.total || 0, hit: true, ttlRemaining };
  }

  const { data: itemRows } = await supabase
    .from("catalog_items")
    .select("id, provider, provider_product_id, title, price_usd, image_url, images, product_url, in_stock")
    .in("id", itemIds);

  const items: CollectionItem[] = (itemRows || []).map((row: any) => ({
    id: row.id,
    provider: row.provider || "ebay",
    providerProductId: row.provider_product_id || row.id.replace("ebay:", ""),
    title: row.title || "Unknown",
    priceUsd: row.price_usd,
    imageUrl: row.image_url,
    images: Array.isArray(row.images) ? row.images : [],
    productUrl: row.product_url || "",
    inStock: row.in_stock !== false,
  }));

  debugLog("COLLECTION_CACHE", { hit: true, key: cacheKey, ttlRemaining, itemCount: items.length });

  return { items, total: cache.total || items.length, hit: true, ttlRemaining };
}

async function getItemsFromDB(
  supabase: any,
  provider: string,
  categoryKey: string,
  page: number,
  pageSize: number,
  isVehicle: boolean = false
): Promise<{ items: CollectionItem[]; total: number }> {
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("catalog_items")
    .select("id, provider, provider_product_id, title, price_usd, image_url, images, product_url, in_stock", { count: "exact" });

  // Filter out disallowed items
  query = query.or("is_disallowed.is.null,is_disallowed.eq.false");

  if (provider !== "all") {
    query = query.eq("provider", provider);
  }

  // Match category_key
  if (categoryKey) {
    query = query.eq("category_key", categoryKey);
  }

  // For vehicles, require minimum price
  if (isVehicle) {
    query = query.gte("price_usd", VEHICLE_MIN_PRICE_USD);
  }

  const { data: rows, count } = await query
    .order("updated_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  // Filter blocked titles
  const items: CollectionItem[] = [];
  for (const row of (rows || [])) {
    const title = row.title || "Unknown";
    if (isBlockedTitle(title, isVehicle)) continue;

    items.push({
      id: row.id,
      provider: row.provider || provider,
      providerProductId: row.provider_product_id || row.id.replace(`${provider}:`, ""),
      title,
      priceUsd: row.price_usd,
      imageUrl: row.image_url,
      images: Array.isArray(row.images) ? row.images : [],
      productUrl: row.product_url || "",
      inStock: row.in_stock !== false,
    });
  }

  return { items, total: count || items.length };
}

async function saveToCache(
  supabase: any,
  cacheKey: string,
  provider: string,
  collectionKey: string,
  page: number,
  pageSize: number,
  items: CollectionItem[],
  total: number,
  ttlSeconds: number = 7200
): Promise<void> {
  const itemIds = items.map(i => i.id);

  await supabase.from("catalog_collection_cache").upsert({
    key: cacheKey,
    provider,
    collection_key: collectionKey,
    page,
    page_size: pageSize,
    item_ids: itemIds,
    total,
    ttl_seconds: ttlSeconds,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

  debugLog("COLLECTION_CACHE", { action: "saved", key: cacheKey, itemCount: items.length, ttlSeconds });
}

async function upsertCatalogItems(
  supabase: any,
  items: CollectionItem[],
  categoryKey: string
): Promise<void> {
  const rows = items.map(item => {
    const galleryImages = sanitizeGallery(item.images || (item.imageUrl ? [item.imageUrl] : []));
    const primaryImage = bestProductImage(item.imageUrl, item.images) ?? galleryImages[0] ?? null;
    return {
    id: item.id,
    provider: item.provider,
    provider_product_id: item.providerProductId,
    title: item.title,
    price_usd: item.priceUsd,
    image_url: primaryImage,
    images: galleryImages,
    product_url: item.productUrl,
    in_stock: item.inStock,
    category_key: categoryKey,
    is_disallowed: false,
    updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    await supabase.from("catalog_items").upsert(rows, { onConflict: "id" });
    debugLog("COLLECTION_UPSERT", { itemCount: rows.length, categoryKey });
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  
  // Parse params - support both collectionKey and slug for backward compat
  const collectionKey = url.searchParams.get("collectionKey") 
    || url.searchParams.get("slug") 
    || "electronics_trending";
  const provider = url.searchParams.get("provider") || "ebay";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "200", 10)));
  const envHeader = req.headers.get("x-afrishop-environment") || url.searchParams.get("env") || "production";
  const mode = url.searchParams.get("mode") || "db";

  const isStaging = envHeader === "staging";
  const allowLive = isStaging || mode === "live";

  debugLog("COLLECTION_REQ", { provider, collectionKey, page, pageSize, mode, env: envHeader, allowLive });

  // Build response helper
  const buildResponse = (
    status: "success" | "error",
    items: CollectionItem[],
    total: number,
    error: { message: string; code: string } | null = null
  ): Response => {
    const response: CollectionResponse = {
      status,
      env: envHeader,
      provider,
      collectionKey,
      page,
      pageSize,
      total,
      items,
      error,
    };
    
    debugLog("COLLECTION_RES", { itemsLen: items.length, total, durationMs: Date.now() - startTime });
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return buildResponse("error", [], 0, { message: "Supabase not configured", code: "CONFIG_ERROR" });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get collection config (default to electronics if unknown)
    const collectionConfig = COLLECTION_QUERIES[collectionKey] || COLLECTION_QUERIES["electronics_trending"];
    const isVehicle = collectionConfig.isVehicle === true;

    const cacheKey = `${provider}:${collectionKey}:${page}:${pageSize}`;

    // Step 1: Try to serve from collection cache
    const cached = await getCachedCollection(supabase, cacheKey);
    if (cached.hit && cached.items.length > 0) {
      return buildResponse("success", cached.items, cached.total, null);
    }

    // Step 2: If mode=db (production default), try to build from existing DB items
    if (!allowLive) {
      const dbResult = await getItemsFromDB(supabase, provider, collectionConfig.categoryKey, page, pageSize, isVehicle);
      
      // Cache the result (shorter TTL if few items)
      if (dbResult.items.length > 0) {
        await saveToCache(supabase, cacheKey, provider, collectionKey, page, pageSize, dbResult.items, dbResult.total, Math.min(collectionConfig.ttlSeconds, 3600));
      }
      
      return buildResponse("success", dbResult.items, dbResult.total, null);
    }

    // Step 3: Live fetch (staging or mode=live)
    if (provider === "ebay" && collectionConfig.q) {
      const offset = (page - 1) * pageSize;
      const liveResult = await fetchEbayLive(supabase, collectionConfig.q, pageSize, offset, isVehicle);

      if (liveResult.items.length > 0) {
        // Upsert items to catalog_items
        await upsertCatalogItems(supabase, liveResult.items, collectionConfig.categoryKey);
        
        // Cache the collection
        await saveToCache(supabase, cacheKey, provider, collectionKey, page, pageSize, liveResult.items, liveResult.total, collectionConfig.ttlSeconds);
        
        return buildResponse("success", liveResult.items, liveResult.total, null);
      }
    }

    // Fallback: return whatever we have from DB
    const fallbackResult = await getItemsFromDB(supabase, provider, collectionConfig.categoryKey, page, pageSize, isVehicle);
    return buildResponse("success", fallbackResult.items, fallbackResult.total, null);

  } catch (err) {
    console.error("[catalog-collection] Error:", err);
    return buildResponse("error", [], 0, { 
      message: err instanceof Error ? err.message : "Unknown error", 
      code: "INTERNAL_ERROR" 
    });
  }
});
