/**
 * Media Cache Utility
 * Provides exact image counts for catalog items by caching gallery data from /catalog-product
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const DEV = Deno.env.get("ENVIRONMENT") !== "production";

interface MediaCacheRecord {
  provider: string;
  provider_item_id: string;
  image_urls: string[];
  image_count: number;
  fetched_at: string;
  expires_at: string;
}

interface MediaCacheSettings {
  ttlDays: number;
  prefetchEnabled: boolean;
  maxItemsPerPage: number;
  fetchTimeoutMs: number;
  fetchConcurrency: number;
}

interface MediaEnrichmentStats {
  checked: number;
  cacheHit: number;
  fetched: number;
  timedOut: number;
}

interface EnrichedItem {
  image_count: number;
  imageCount: number;
  image_count_status?: "pending" | "cached" | "fresh";
}

/**
 * Parse composite ID to extract provider and raw item ID
 * Formats:
 *   - "ebay:123456789" -> { provider: "ebay", itemId: "123456789" }
 *   - "ebay:v1|..." (compact format) -> { provider: "ebay", itemId: "v1|..." }
 *   - "rainforest:B08XYZ123" -> { provider: "amazon", itemId: "B08XYZ123" }
 *   - "amazon:B08XYZ123" -> { provider: "amazon", itemId: "B08XYZ123" }
 */
export function parseProviderKey(compositeId: string): { provider: "ebay" | "amazon"; itemId: string } | null {
  if (!compositeId || typeof compositeId !== "string") return null;

  // Handle "ebay:..." format
  if (compositeId.startsWith("ebay:")) {
    const itemId = compositeId.slice(5);
    return { provider: "ebay", itemId };
  }

  // Handle "rainforest:..." format (treat as amazon)
  if (compositeId.startsWith("rainforest:")) {
    const itemId = compositeId.slice(11);
    return { provider: "amazon", itemId };
  }

  // Handle "amazon:..." format
  if (compositeId.startsWith("amazon:")) {
    const itemId = compositeId.slice(7);
    return { provider: "amazon", itemId };
  }

  return null;
}

/**
 * Get media cache settings from admin_settings table
 */
export async function getMediaCacheSettings(supabase: SupabaseClient): Promise<MediaCacheSettings> {
  const keys = [
    "media_cache_ttl_days",
    "media_prefetch_enabled",
    "media_prefetch_max_items_per_page",
    "media_fetch_timeout_ms",
    "media_fetch_concurrency",
  ];

  const { data } = await supabase
    .from("admin_settings")
    .select("key, value")
    .in("key", keys);

  const settings: Record<string, string> = {};
  if (data) {
    for (const row of data) {
      settings[row.key] = row.value;
    }
  }

  return {
    ttlDays: parseInt(settings["media_cache_ttl_days"] || "30", 10),
    prefetchEnabled: settings["media_prefetch_enabled"] !== "false",
    maxItemsPerPage: parseInt(settings["media_prefetch_max_items_per_page"] || "20", 10),
    fetchTimeoutMs: parseInt(settings["media_fetch_timeout_ms"] || "1200", 10),
    fetchConcurrency: parseInt(settings["media_fetch_concurrency"] || "6", 10),
  };
}

/**
 * Get cached media record if not expired
 */
export async function getCachedMedia(
  supabase: SupabaseClient,
  provider: string,
  itemId: string
): Promise<MediaCacheRecord | null> {
  const { data, error } = await supabase
    .from("catalog_item_media")
    .select("*")
    .eq("provider", provider)
    .eq("provider_item_id", itemId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  return {
    provider: data.provider,
    provider_item_id: data.provider_item_id,
    image_urls: Array.isArray(data.image_urls) ? data.image_urls : [],
    image_count: data.image_count || 0,
    fetched_at: data.fetched_at,
    expires_at: data.expires_at,
  };
}

/**
 * Fetch media from /catalog-product and cache it
 * Returns the cached record on success, null on failure/timeout
 */
export async function fetchAndCacheMedia(
  supabase: SupabaseClient,
  provider: string,
  itemId: string,
  compositeId: string,
  settings: MediaCacheSettings
): Promise<MediaCacheRecord | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error("[MEDIA_CACHE] Missing Supabase environment variables");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.fetchTimeoutMs);

  try {
    const productUrl = `${supabaseUrl}/functions/v1/catalog-product?id=${encodeURIComponent(compositeId)}`;

    const response = await fetch(productUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (DEV) console.log(`[MEDIA_CACHE] Product fetch failed: ${response.status} for ${compositeId}`);
      return null;
    }

    const productData = await response.json();

    // Extract imageUrls from the product response
    let imageUrls: string[] = [];

    if (productData.imageUrls && Array.isArray(productData.imageUrls)) {
      imageUrls = productData.imageUrls;
    } else if (productData.product?.imageUrls && Array.isArray(productData.product.imageUrls)) {
      imageUrls = productData.product.imageUrls;
    }

    // Filter to valid image URLs only (no videos, no empty)
    imageUrls = imageUrls.filter((url: string) => {
      if (!url || typeof url !== "string") return false;
      const lowerUrl = url.toLowerCase();
      // Exclude video URLs
      if (lowerUrl.includes(".mp4") || lowerUrl.includes(".webm") || lowerUrl.includes(".mov")) return false;
      if (lowerUrl.includes("/video/") || lowerUrl.includes("video.")) return false;
      // Must be a valid image-looking URL
      if (!lowerUrl.includes("http")) return false;
      return true;
    });

    // Deduplicate
    imageUrls = [...new Set(imageUrls)];

    const imageCount = imageUrls.length || 1;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + settings.ttlDays);

    // Upsert to cache
    const { error } = await supabase
      .from("catalog_item_media")
      .upsert(
        {
          provider,
          provider_item_id: itemId,
          image_urls: imageUrls,
          image_count: imageCount,
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "provider,provider_item_id" }
      );

    if (error) {
      if (DEV) console.log(`[MEDIA_CACHE] Upsert error: ${error.message}`);
      return null;
    }

    if (DEV) {
      console.log(`[MEDIA_CACHE] Cached ${imageCount} images for ${provider}:${itemId}`);
    }

    return {
      provider,
      provider_item_id: itemId,
      image_urls: imageUrls,
      image_count: imageCount,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      if (DEV) console.log(`[MEDIA_CACHE] Timeout for ${compositeId}`);
    } else {
      if (DEV) console.log(`[MEDIA_CACHE] Fetch error for ${compositeId}: ${err}`);
    }
    return null;
  }
}

/**
 * Enrich a list of catalog items with exact image counts
 * Returns the enriched items and stats
 */
export async function enrichItemsWithMediaCounts<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  items: T[],
  settings?: MediaCacheSettings
): Promise<{ items: T[]; stats: MediaEnrichmentStats }> {
  if (!items || items.length === 0) {
    return { items, stats: { checked: 0, cacheHit: 0, fetched: 0, timedOut: 0 } };
  }

  // Get settings if not provided
  const config = settings || (await getMediaCacheSettings(supabase));

  const stats: MediaEnrichmentStats = {
    checked: 0,
    cacheHit: 0,
    fetched: 0,
    timedOut: 0,
  };

  const enrichedItems = [...items];

  // Process items with concurrency limit
  const maxPrefetch = Math.min(config.maxItemsPerPage, items.length);
  const prefetchQueue: Array<{ index: number; parsed: { provider: "ebay" | "amazon"; itemId: string }; compositeId: string }> = [];

  // First pass: check cache and build prefetch queue
  for (let i = 0; i < enrichedItems.length; i++) {
    const item = enrichedItems[i];
    const compositeId = (item.id as string) || "";
    const parsed = parseProviderKey(compositeId);

    if (!parsed) {
      // Can't parse, use existing count or default
      const existingCount = (item.image_count as number) || (item.imageCount as number) || 1;
      (enrichedItems[i] as Record<string, unknown>).image_count = existingCount;
      (enrichedItems[i] as Record<string, unknown>).imageCount = existingCount;
      continue;
    }

    stats.checked++;

    // Check cache first
    const cached = await getCachedMedia(supabase, parsed.provider, parsed.itemId);

    if (cached) {
      stats.cacheHit++;
      (enrichedItems[i] as Record<string, unknown>).image_count = cached.image_count;
      (enrichedItems[i] as Record<string, unknown>).imageCount = cached.image_count;
      (enrichedItems[i] as Record<string, unknown>).image_count_status = "cached";
    } else if (config.prefetchEnabled && prefetchQueue.length < maxPrefetch) {
      // Add to prefetch queue
      prefetchQueue.push({ index: i, parsed, compositeId });
    } else {
      // Beyond prefetch limit or disabled - use fallback
      const fallbackCount = (item.image_count as number) || (item.imageCount as number) || 1;
      (enrichedItems[i] as Record<string, unknown>).image_count = fallbackCount;
      (enrichedItems[i] as Record<string, unknown>).imageCount = fallbackCount;
      (enrichedItems[i] as Record<string, unknown>).image_count_status = "pending";
    }
  }

  // Second pass: prefetch with concurrency limit
  if (prefetchQueue.length > 0 && config.prefetchEnabled) {
    const concurrency = config.fetchConcurrency;
    const batches: typeof prefetchQueue[] = [];

    for (let i = 0; i < prefetchQueue.length; i += concurrency) {
      batches.push(prefetchQueue.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const fetchPromises = batch.map(async ({ index, parsed, compositeId }) => {
        const result = await fetchAndCacheMedia(supabase, parsed.provider, parsed.itemId, compositeId, config);

        if (result) {
          stats.fetched++;
          (enrichedItems[index] as Record<string, unknown>).image_count = result.image_count;
          (enrichedItems[index] as Record<string, unknown>).imageCount = result.image_count;
          (enrichedItems[index] as Record<string, unknown>).image_count_status = "fresh";
        } else {
          stats.timedOut++;
          // Use fallback
          const item = enrichedItems[index];
          const fallbackCount = (item.image_count as number) || (item.imageCount as number) || 1;
          (enrichedItems[index] as Record<string, unknown>).image_count = fallbackCount;
          (enrichedItems[index] as Record<string, unknown>).imageCount = fallbackCount;
          (enrichedItems[index] as Record<string, unknown>).image_count_status = "pending";
        }
      });

      await Promise.all(fetchPromises);
    }
  }

  if (DEV) {
    console.log(`[MEDIA] cacheHit=${stats.cacheHit} fetched=${stats.fetched} timeout=${stats.timedOut}`);
  }

  return { items: enrichedItems, stats };
}

/**
 * Batch lookup cached media for multiple items (no prefetch)
 * Used for items beyond the prefetch limit
 */
export async function batchLookupCachedMedia(
  supabase: SupabaseClient,
  compositeIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (!compositeIds || compositeIds.length === 0) return result;

  // Parse all IDs
  const parsedItems: Array<{ compositeId: string; provider: string; itemId: string }> = [];
  for (const id of compositeIds) {
    const parsed = parseProviderKey(id);
    if (parsed) {
      parsedItems.push({ compositeId: id, provider: parsed.provider, itemId: parsed.itemId });
    }
  }

  if (parsedItems.length === 0) return result;

  // Batch query by provider
  const ebayIds = parsedItems.filter((p) => p.provider === "ebay").map((p) => p.itemId);
  const amazonIds = parsedItems.filter((p) => p.provider === "amazon").map((p) => p.itemId);

  const now = new Date().toISOString();

  // Query eBay cache
  if (ebayIds.length > 0) {
    const { data: ebayData } = await supabase
      .from("catalog_item_media")
      .select("provider_item_id, image_count")
      .eq("provider", "ebay")
      .in("provider_item_id", ebayIds)
      .gt("expires_at", now);

    if (ebayData) {
      for (const row of ebayData) {
        const compositeId = `ebay:${row.provider_item_id}`;
        result.set(compositeId, row.image_count);
      }
    }
  }

  // Query Amazon cache
  if (amazonIds.length > 0) {
    const { data: amazonData } = await supabase
      .from("catalog_item_media")
      .select("provider_item_id, image_count")
      .eq("provider", "amazon")
      .in("provider_item_id", amazonIds)
      .gt("expires_at", now);

    if (amazonData) {
      for (const row of amazonData) {
        // Could be rainforest: or amazon: in original ID
        const rainforestId = `rainforest:${row.provider_item_id}`;
        const amazonId = `amazon:${row.provider_item_id}`;
        result.set(rainforestId, row.image_count);
        result.set(amazonId, row.image_count);
      }
    }
  }

  return result;
}

/**
 * Parse product URL to extract provider and provider_item_id
 * Used for cart items which store product_url rather than composite IDs
 * 
 * Examples:
 *   - https://www.ebay.com/itm/123456789 -> { provider: "ebay", itemId: "123456789" }
 *   - https://www.amazon.com/dp/B08XYZ123 -> { provider: "amazon", itemId: "B08XYZ123" }
 */
export function parseProductUrl(productUrl: string): { provider: "ebay" | "amazon"; itemId: string } | null {
  if (!productUrl || typeof productUrl !== "string") return null;

  const lowerUrl = productUrl.toLowerCase();

  // eBay patterns
  if (lowerUrl.includes("ebay.")) {
    // Match /itm/123456789 or /itm/some-title/123456789
    const itmMatch = productUrl.match(/\/itm\/(?:[^\/]+\/)?(\d+)/i);
    if (itmMatch) return { provider: "ebay", itemId: itmMatch[1] };
    
    // Match /p/123456789
    const pMatch = productUrl.match(/\/p\/(\d+)/i);
    if (pMatch) return { provider: "ebay", itemId: pMatch[1] };
    
    return null;
  }

  // Amazon patterns
  if (lowerUrl.includes("amazon.")) {
    // Match /dp/B08XYZ123 or /gp/product/B08XYZ123
    const dpMatch = productUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (dpMatch) return { provider: "amazon", itemId: dpMatch[1].toUpperCase() };
    
    // Match /product/B08XYZ123
    const productMatch = productUrl.match(/\/product\/([A-Z0-9]{10})/i);
    if (productMatch) return { provider: "amazon", itemId: productMatch[1].toUpperCase() };
    
    return null;
  }

  return null;
}

/**
 * Lookup image counts for cart items from catalog_item_media cache (no prefetch)
 * Returns a map of product_url -> { image_count, status }
 */
export async function lookupCartItemMediaCounts(
  supabase: SupabaseClient,
  productUrls: string[]
): Promise<Map<string, { image_count: number; image_count_status: "cached" | "pending" }>> {
  const result = new Map<string, { image_count: number; image_count_status: "cached" | "pending" }>();

  if (!productUrls || productUrls.length === 0) return result;

  // Parse all URLs to extract provider/itemId
  const parsedItems: Array<{ productUrl: string; provider: string; itemId: string }> = [];
  for (const url of productUrls) {
    const parsed = parseProductUrl(url);
    if (parsed) {
      parsedItems.push({ productUrl: url, provider: parsed.provider, itemId: parsed.itemId });
    } else {
      // Can't parse - mark as pending
      result.set(url, { image_count: 1, image_count_status: "pending" });
    }
  }

  if (parsedItems.length === 0) return result;

  // Group by provider for batch queries
  const ebayItems = parsedItems.filter((p) => p.provider === "ebay");
  const amazonItems = parsedItems.filter((p) => p.provider === "amazon");

  const now = new Date().toISOString();

  // Query eBay cache
  if (ebayItems.length > 0) {
    const ebayIds = ebayItems.map((p) => p.itemId);
    const { data: ebayData } = await supabase
      .from("catalog_item_media")
      .select("provider_item_id, image_count")
      .eq("provider", "ebay")
      .in("provider_item_id", ebayIds)
      .gt("expires_at", now);

    const ebayMap = new Map<string, number>();
    if (ebayData) {
      for (const row of ebayData) {
        ebayMap.set(row.provider_item_id, row.image_count);
      }
    }

    // Map back to product URLs
    for (const item of ebayItems) {
      if (ebayMap.has(item.itemId)) {
        result.set(item.productUrl, { 
          image_count: ebayMap.get(item.itemId)!, 
          image_count_status: "cached" 
        });
      } else {
        result.set(item.productUrl, { image_count: 1, image_count_status: "pending" });
      }
    }
  }

  // Query Amazon cache
  if (amazonItems.length > 0) {
    const amazonIds = amazonItems.map((p) => p.itemId);
    const { data: amazonData } = await supabase
      .from("catalog_item_media")
      .select("provider_item_id, image_count")
      .eq("provider", "amazon")
      .in("provider_item_id", amazonIds)
      .gt("expires_at", now);

    const amazonMap = new Map<string, number>();
    if (amazonData) {
      for (const row of amazonData) {
        amazonMap.set(row.provider_item_id, row.image_count);
      }
    }

    // Map back to product URLs
    for (const item of amazonItems) {
      if (amazonMap.has(item.itemId)) {
        result.set(item.productUrl, { 
          image_count: amazonMap.get(item.itemId)!, 
          image_count_status: "cached" 
        });
      } else {
        result.set(item.productUrl, { image_count: 1, image_count_status: "pending" });
      }
    }
  }

  if (DEV) {
    const cachedCount = [...result.values()].filter((v) => v.image_count_status === "cached").length;
    console.log(`[CART_MEDIA] Looked up ${productUrls.length} URLs, cached=${cachedCount}`);
  }

  return result;
}
