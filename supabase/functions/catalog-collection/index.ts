/**
 * Catalog Collection Endpoint
 * 
 * Serves cached collection data from DB, with optional live fallback for staging.
 * Returns stable JSON shape: { status, env, provider, collectionKey, page, pageSize, total, items, error }
 * 
 * Query params:
 *   - collectionKey (required): electronics_trending, phones, tablets, monitors, computers, clothing, vehicles
 *   - slug (alias for collectionKey for backward compatibility)
 *   - provider (optional): "ebay" | "rainforest" | "all" (default: "ebay")
 *   - page (default: 1)
 *   - pageSize (default: 20, max: 40)
 *   - env (optional): staging | production
 *   - mode (optional): "db" | "live" (default: "db", live only in staging)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

const COLLECTION_QUERIES: Record<string, { q: string; categoryKey: string }> = {
  electronics_trending: {
    q: "iphone smartphone laptop headphones",
    categoryKey: "electronics",
  },
  trending_electronics: {
    q: "iphone smartphone laptop headphones",
    categoryKey: "electronics",
  },
  phones: {
    q: "iphone unlocked smartphone",
    categoryKey: "phones",
  },
  tablets: {
    q: "ipad android tablet",
    categoryKey: "tablets",
  },
  monitors: {
    q: "computer monitor 27 inch",
    categoryKey: "monitors",
  },
  computers: {
    q: "laptop macbook gaming pc",
    categoryKey: "computers",
  },
  clothing: {
    q: "men clothing sneakers",
    categoryKey: "clothing",
  },
  vehicles: {
    q: "",
    categoryKey: "vehicles",
  },
};

// ─── Content Blocking ────────────────────────────────────────────────────────

const DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "audiobook",
  "textbook", "novel", "comics", "journal", "membership", "streaming",
  "unlimited", "prime membership",
];

function isBlockedTitle(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return DENY_KEYWORDS.some(keyword => lowerTitle.includes(keyword));
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
  offset: number
): Promise<{ items: CollectionItem[]; total: number }> {
  const token = await getEbayToken(supabase);
  if (!token) {
    debugLog("EBAY_COLLECTION_LIVE", { error: "No token available" });
    return { items: [], total: 0 };
  }

  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  
  // Simplify the query for eBay - use parentheses for OR queries
  // eBay Browse API may not handle complex OR chains well without parentheses
  const simplifiedQuery = query.includes(" OR ") 
    ? `(${query.replace(/ OR /g, ") OR (")})`
    : query;
  
  const params = new URLSearchParams({
    q: simplifiedQuery,
    limit: String(limit),
    offset: String(offset),
    // Simpler filter - just fixed price
    filter: "buyingOptions:{FIXED_PRICE}",
  });

  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item_summary/search?${params}`;
  
  debugLog("EBAY_COLLECTION_LIVE", { q: simplifiedQuery, limit, offset, endpoint });

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
      return { items: [], total: 0 };
    }

    const data = await response.json();
    const itemSummaries = data.itemSummaries || [];
    const total = data.total || 0;

    debugLog("EBAY_COLLECTION_LIVE", { 
      httpStatus: response.status,
      rawItemCount: itemSummaries.length, 
      total,
      hasWarnings: !!data.warnings,
      firstTitle: itemSummaries[0]?.title?.slice(0, 50),
    });

    // Normalize and filter items
    const items: CollectionItem[] = [];
    for (const item of itemSummaries) {
      const title = item.title || "Unknown";
      
      // Skip blocked items
      if (isBlockedTitle(title)) continue;

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
    }

    return { items, total: items.length };
  } catch (err) {
    debugLog("EBAY_COLLECTION_LIVE", { error: err instanceof Error ? err.message : "Unknown" });
    return { items: [], total: 0 };
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
  pageSize: number
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

  // Match category_key for specific categories
  if (categoryKey && categoryKey !== "electronics") {
    query = query.eq("category_key", categoryKey);
  }

  const { data: rows, count } = await query
    .order("updated_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  // Filter blocked titles
  const items: CollectionItem[] = [];
  for (const row of (rows || [])) {
    const title = row.title || "Unknown";
    if (isBlockedTitle(title)) continue;

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
  ttlSeconds: number = 21600 // 6 hours default
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
  const rows = items.map(item => ({
    id: item.id,
    provider: item.provider,
    provider_product_id: item.providerProductId,
    title: item.title,
    price_usd: item.priceUsd,
    image_url: item.imageUrl,
    images: item.images,
    product_url: item.productUrl,
    in_stock: item.inStock,
    category_key: categoryKey,
    is_disallowed: false,
    updated_at: new Date().toISOString(),
  }));

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
  const pageSize = Math.min(40, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
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

    // Vehicles: return empty for now
    if (collectionKey === "vehicles") {
      return buildResponse("success", [], 0, null);
    }

    const cacheKey = `${provider}:${collectionKey}:${page}:${pageSize}`;

    // Step 1: Try to serve from collection cache
    const cached = await getCachedCollection(supabase, cacheKey);
    if (cached.hit && cached.items.length > 0) {
      return buildResponse("success", cached.items, cached.total, null);
    }

    // Step 2: If mode=db (production default), try to build from existing DB items
    if (!allowLive) {
      const dbResult = await getItemsFromDB(supabase, provider, collectionConfig.categoryKey, page, pageSize);
      
      // Cache the result (shorter TTL if few items)
      if (dbResult.items.length > 0) {
        await saveToCache(supabase, cacheKey, provider, collectionKey, page, pageSize, dbResult.items, dbResult.total, 3600);
      }
      
      return buildResponse("success", dbResult.items, dbResult.total, null);
    }

    // Step 3: Live fetch (staging or mode=live)
    if (provider === "ebay" && collectionConfig.q) {
      const offset = (page - 1) * pageSize;
      const liveResult = await fetchEbayLive(supabase, collectionConfig.q, pageSize, offset);

      if (liveResult.items.length > 0) {
        // Upsert items to catalog_items
        await upsertCatalogItems(supabase, liveResult.items, collectionConfig.categoryKey);
        
        // Cache the collection (6 hours TTL)
        await saveToCache(supabase, cacheKey, provider, collectionKey, page, pageSize, liveResult.items, liveResult.total, 21600);
        
        return buildResponse("success", liveResult.items, liveResult.total, null);
      }
    }

    // Fallback: return whatever we have from DB
    const fallbackResult = await getItemsFromDB(supabase, provider, collectionConfig.categoryKey, page, pageSize);
    return buildResponse("success", fallbackResult.items, fallbackResult.total, null);

  } catch (err) {
    console.error("[catalog-collection] Error:", err);
    return buildResponse("error", [], 0, { 
      message: err instanceof Error ? err.message : "Unknown error", 
      code: "INTERNAL_ERROR" 
    });
  }
});
