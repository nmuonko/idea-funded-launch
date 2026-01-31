/**
 * eBay Browse API Adapter
 * Handles OAuth token caching and product search/detail
 * For display-only catalog (no purchases)
 * 
 * Enhanced with staging-only debug logging and marketplace header support
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EbayConfig {
  environment: "production" | "sandbox";
  marketplace: string;
  searchLimit: number;
  filter?: string; // Custom filter string to override default
}

export interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  currency: string;
  imageUrl: string | null;
  images: string[];
  productUrl: string;
  inStock: boolean;
  rating: number | null;
  description?: string;
  attributes?: Record<string, string>;
}

interface TokenRecord {
  provider: string;
  access_token: string;
  token_type: string;
  expires_at: string;
}

export interface EbayTokenDebug {
  ok: boolean;
  status?: number;
  expiresIn?: number;
  expiresAt?: string;
  error?: string;
  cached?: boolean;
}

export interface EbaySearchDebug {
  enabled: boolean;
  tokenOk: boolean;
  httpStatus?: number;
  itemCount: number;
  warnings?: string[];
  error?: string;
  filteredOut?: number;
  filterOverblock?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EBAY_OAUTH_SCOPES = "https://api.ebay.com/oauth/api_scope";

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

// Token expiry buffer (60 seconds before actual expiry)
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

// Negative cache TTL (60-120 seconds for empty/failed results)
const NEGATIVE_CACHE_TTL_SECONDS = 90;

// ─── Environment Helpers ─────────────────────────────────────────────────────

function isStaging(): boolean {
  // Check if we're in staging environment for debug logging
  return Deno.env.get("EBAY_ENV") === "sandbox" || 
         Deno.env.get("DENO_DEPLOYMENT_ID")?.includes("staging") ||
         false;
}

function debugLog(marker: string, data: Record<string, any>): void {
  // Always log for now to debug, but can be restricted to staging later
  console.log(`[${marker}]`, JSON.stringify(data));
}

// ─── OAuth Token Management ──────────────────────────────────────────────────

/**
 * Get a valid OAuth token, using cache or minting new
 */
export async function getEbayToken(supabase: any): Promise<{ token: string; debug: EbayTokenDebug }> {
  // Check for cached token
  const { data: cached } = await supabase
    .from("provider_tokens")
    .select("access_token, expires_at")
    .eq("provider", "ebay")
    .maybeSingle();

  if (cached) {
    const expiresAt = new Date(cached.expires_at).getTime();
    const now = Date.now();
    
    // If token is still valid (with buffer), reuse it
    if (expiresAt > now + TOKEN_EXPIRY_BUFFER_MS) {
      const debug: EbayTokenDebug = {
        ok: true,
        cached: true,
        expiresAt: cached.expires_at,
        expiresIn: Math.floor((expiresAt - now) / 1000),
      };
      debugLog("EBAY_TOKEN", debug);
      return { token: cached.access_token, debug };
    }
  }

  // Mint new token
  return await mintNewToken(supabase);
}

/**
 * Mint a new OAuth application access token
 */
async function mintNewToken(supabase: any): Promise<{ token: string; debug: EbayTokenDebug }> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";

  if (!clientId || !clientSecret) {
    const debug: EbayTokenDebug = {
      ok: false,
      error: "EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured",
    };
    debugLog("EBAY_TOKEN", debug);
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
  }

  const endpoint = EBAY_ENDPOINTS[environment].oauth;
  const credentials = btoa(`${clientId}:${clientSecret}`);

  debugLog("EBAY_TOKEN", { minting: true, endpoint, environment });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_OAUTH_SCOPES)}`,
    });
  } catch (err) {
    const debug: EbayTokenDebug = {
      ok: false,
      error: `Network error: ${err instanceof Error ? err.message : "Unknown"}`,
    };
    debugLog("EBAY_TOKEN", debug);
    throw new Error(`eBay OAuth network error: ${debug.error}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const debug: EbayTokenDebug = {
      ok: false,
      status: response.status,
      error: errorText.slice(0, 500),
    };
    debugLog("EBAY_TOKEN", debug);
    throw new Error(`eBay OAuth failed: ${response.status}`);
  }

  const data = await response.json();
  const { access_token, expires_in, token_type } = data;

  // Calculate expiry time (subtract buffer)
  const expiresAt = new Date(Date.now() + (expires_in * 1000) - TOKEN_EXPIRY_BUFFER_MS);

  // Store token in database
  const { error } = await supabase
    .from("provider_tokens")
    .upsert({
      provider: "ebay",
      access_token,
      token_type: token_type || "Bearer",
      expires_at: expiresAt.toISOString(),
      scopes: [EBAY_OAUTH_SCOPES],
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider" });

  if (error) {
    console.error("[ebayAdapter] Failed to cache token:", error);
    // Continue anyway - token is valid
  }

  const debug: EbayTokenDebug = {
    ok: true,
    cached: false,
    status: response.status,
    expiresIn: expires_in,
    expiresAt: expiresAt.toISOString(),
  };
  debugLog("EBAY_TOKEN", debug);

  return { token: access_token, debug };
}

// ─── Search API ──────────────────────────────────────────────────────────────

interface SearchResult {
  items: CatalogItem[];
  total: number;
  hasMore: boolean;
  debug: EbaySearchDebug;
}

/**
 * Search eBay for products
 */
export async function searchEbay(
  supabase: any,
  query: string,
  page: number = 1,
  pageSize: number = 20,
  config?: Partial<EbayConfig>
): Promise<SearchResult> {
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const marketplace = config?.marketplace || "EBAY_US";
  
  let tokenDebug: EbayTokenDebug;
  let token: string;
  
  try {
    const result = await getEbayToken(supabase);
    token = result.token;
    tokenDebug = result.debug;
  } catch (err) {
    return {
      items: [],
      total: 0,
      hasMore: false,
      debug: {
        enabled: true,
        tokenOk: false,
        itemCount: 0,
        error: err instanceof Error ? err.message : "Token error",
      },
    };
  }
  
  const offset = (page - 1) * pageSize;
  
  // Use custom filter if provided, otherwise default
  const filterString = config?.filter || "buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}";
  
  const params = new URLSearchParams({
    q: query,
    limit: String(pageSize),
    offset: String(offset),
    filter: filterString,
  });

  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item_summary/search?${params}`;
  
  debugLog("EBAY_SEARCH_REQ", {
    q: query,
    limit: pageSize,
    offset,
    marketplace,
    url: endpoint,
    environment,
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    const debug: EbaySearchDebug = {
      enabled: true,
      tokenOk: tokenDebug.ok,
      itemCount: 0,
      error: `Network error: ${err instanceof Error ? err.message : "Unknown"}`,
    };
    debugLog("EBAY_SEARCH_RES", debug);
    return { items: [], total: 0, hasMore: false, debug };
  }

  if (!response.ok) {
    const errorText = await response.text();
    
    // If unauthorized, try minting new token once
    if (response.status === 401) {
      debugLog("EBAY_SEARCH_RES", { status: 401, retrying: true });
      try {
        const newTokenResult = await mintNewToken(supabase);
        return searchEbayWithToken(newTokenResult.token, query, page, pageSize, marketplace, environment, newTokenResult.debug);
      } catch (retryErr) {
        return {
          items: [],
          total: 0,
          hasMore: false,
          debug: {
            enabled: true,
            tokenOk: false,
            httpStatus: 401,
            itemCount: 0,
            error: "Token refresh failed",
          },
        };
      }
    }
    
    const debug: EbaySearchDebug = {
      enabled: true,
      tokenOk: tokenDebug.ok,
      httpStatus: response.status,
      itemCount: 0,
      error: errorText.slice(0, 500),
    };
    debugLog("EBAY_SEARCH_RES", debug);
    return { items: [], total: 0, hasMore: false, debug };
  }

  const data = await response.json();
  const result = normalizeSearchResults(data);
  
  const debug: EbaySearchDebug = {
    enabled: true,
    tokenOk: tokenDebug.ok,
    httpStatus: response.status,
    itemCount: result.items.length,
    warnings: data.warnings?.map((w: any) => w.message) || [],
  };
  
  debugLog("EBAY_SEARCH_RES", {
    ...debug,
    total: result.total,
    hasMore: result.hasMore,
    firstTitle: result.items[0]?.title?.slice(0, 50),
  });
  
  return { ...result, debug };
}

async function searchEbayWithToken(
  token: string,
  query: string,
  page: number,
  pageSize: number,
  marketplace: string,
  environment: "production" | "sandbox",
  tokenDebug: EbayTokenDebug
): Promise<SearchResult> {
  const offset = (page - 1) * pageSize;
  
  const params = new URLSearchParams({
    q: query,
    limit: String(pageSize),
    offset: String(offset),
    filter: "buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}",
  });

  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item_summary/search?${params}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      items: [],
      total: 0,
      hasMore: false,
      debug: {
        enabled: true,
        tokenOk: tokenDebug.ok,
        httpStatus: response.status,
        itemCount: 0,
        error: errorText.slice(0, 500),
      },
    };
  }

  const data = await response.json();
  const result = normalizeSearchResults(data);
  
  return {
    ...result,
    debug: {
      enabled: true,
      tokenOk: tokenDebug.ok,
      httpStatus: response.status,
      itemCount: result.items.length,
      warnings: data.warnings?.map((w: any) => w.message) || [],
    },
  };
}

function normalizeSearchResults(data: any): { items: CatalogItem[]; total: number; hasMore: boolean } {
  const itemSummaries = data.itemSummaries || [];
  const total = data.total || 0;
  const hasMore = data.next !== undefined;

  const items: CatalogItem[] = itemSummaries.map((item: any) => {
    // Use optimized image selection for high-res main image
    const bestImage = selectBestEbayImageInternal(item);
    const images = extractImages(item);
    
    return {
      id: `ebay:${item.itemId}`,
      provider: "ebay",
      providerProductId: item.itemId,
      title: item.title || "Unknown",
      priceUsd: extractPrice(item.price),
      currency: item.price?.currency || "USD",
      imageUrl: bestImage,
      images,
      productUrl: item.itemWebUrl || item.itemHref || "",
      inStock: item.itemAvailability?.availabilityStatus !== "OUT_OF_STOCK",
      rating: null, // eBay doesn't return ratings in search
    };
  });

  return { items, total, hasMore };
}

/**
 * Internal function to select best image from eBay item
 * Priority: image.imageUrl > additionalImages[0] > thumbnailImages[0]
 * All URLs are upgraded to s-l1600
 */
function selectBestEbayImageInternal(item: any): string | null {
  // Priority 1: Primary image field (always prefer this)
  if (item.image?.imageUrl) {
    const upgraded = upgradeImageToHighRes(item.image.imageUrl);
    const wasThumbnail = /s-l(64|96|140|200|225|300|400|500)\b/i.test(item.image.imageUrl);
    if (wasThumbnail) {
      debugLog("EBAY_LIST_IMAGE_UPGRADED", {
        itemId: item.itemId,
        source: "image.imageUrl",
        original: item.image.imageUrl.substring(0, 60),
        upgraded: upgraded.substring(0, 60),
      });
    }
    return upgraded;
  }
  
  // Priority 2: Additional images (still high quality)
  if (item.additionalImages?.length > 0 && item.additionalImages[0]?.imageUrl) {
    const upgraded = upgradeImageToHighRes(item.additionalImages[0].imageUrl);
    debugLog("EBAY_LIST_IMAGE_FALLBACK", {
      itemId: item.itemId,
      source: "additionalImages[0]",
      upgraded: upgraded.substring(0, 60),
    });
    return upgraded;
  }
  
  // Priority 3: Thumbnail images (last resort, but still upgrade)
  if (item.thumbnailImages?.length > 0 && item.thumbnailImages[0]?.imageUrl) {
    const upgraded = upgradeImageToHighRes(item.thumbnailImages[0].imageUrl);
    debugLog("EBAY_LIST_IMAGE_THUMBNAIL", {
      itemId: item.itemId,
      source: "thumbnailImages[0]",
      warning: "Using thumbnail as fallback",
      upgraded: upgraded.substring(0, 60),
    });
    return upgraded;
  }
  
  debugLog("EBAY_NO_IMAGE", { itemId: item.itemId });
  return null;
}

// ─── Product Detail API ──────────────────────────────────────────────────────

/**
 * Get a single eBay item by ID
 */
export async function getEbayItem(
  supabase: any,
  itemId: string,
  config?: Partial<EbayConfig>
): Promise<{ item: CatalogItem | null; debug: EbaySearchDebug }> {
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const marketplace = config?.marketplace || "EBAY_US";

  let tokenDebug: EbayTokenDebug;
  let token: string;
  
  try {
    const result = await getEbayToken(supabase);
    token = result.token;
    tokenDebug = result.debug;
  } catch (err) {
    return {
      item: null,
      debug: {
        enabled: true,
        tokenOk: false,
        itemCount: 0,
        error: err instanceof Error ? err.message : "Token error",
      },
    };
  }

  // Clean the item ID (remove ebay: prefix if present)
  let cleanId = itemId.startsWith("ebay:") ? itemId.slice(5) : itemId;
  
  // If the ID doesn't contain pipes, convert to RESTful format v1|itemId|0
  // The Browse API expects this format: v1|<itemId>|<variationId or 0>
  if (!cleanId.includes("|") && /^\d+$/.test(cleanId)) {
    cleanId = `v1|${cleanId}|0`;
    debugLog("EBAY_ITEM_ID_CONVERTED", { original: itemId, converted: cleanId });
  }
  
  // eBay item IDs need pipe encoding
  const encodedId = cleanId.replace(/\|/g, "%7C");
  
  // Request PRODUCT fieldgroup to get additional images from product catalog
  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item/${encodedId}?fieldgroups=PRODUCT`;
  
  debugLog("EBAY_ITEM_REQ", { itemId: cleanId, marketplace, endpoint, fieldgroups: "PRODUCT" });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return {
      item: null,
      debug: {
        enabled: true,
        tokenOk: tokenDebug.ok,
        itemCount: 0,
        error: `Network error: ${err instanceof Error ? err.message : "Unknown"}`,
      },
    };
  }

  if (!response.ok) {
    if (response.status === 404) {
      debugLog("EBAY_ITEM_RES", { status: 404, itemId: cleanId, found: false });
      return {
        item: null,
        debug: {
          enabled: true,
          tokenOk: tokenDebug.ok,
          httpStatus: 404,
          itemCount: 0,
          error: "Item not found",
        },
      };
    }
    
    // If unauthorized, try minting new token once
    if (response.status === 401) {
      try {
        const newTokenResult = await mintNewToken(supabase);
        return getEbayItemWithToken(newTokenResult.token, cleanId, marketplace, environment, newTokenResult.debug);
      } catch {
        return {
          item: null,
          debug: {
            enabled: true,
            tokenOk: false,
            httpStatus: 401,
            itemCount: 0,
            error: "Token refresh failed",
          },
        };
      }
    }
    
    const errorText = await response.text();
    return {
      item: null,
      debug: {
        enabled: true,
        tokenOk: tokenDebug.ok,
        httpStatus: response.status,
        itemCount: 0,
        error: errorText.slice(0, 500),
      },
    };
  }

  const data = await response.json();
  const item = await normalizeItemDetail(data, supabase);
  
  debugLog("EBAY_ITEM_RES", { 
    status: response.status, 
    itemId: cleanId, 
    found: true, 
    title: item.title.slice(0, 50) 
  });
  
  return {
    item,
    debug: {
      enabled: true,
      tokenOk: tokenDebug.ok,
      httpStatus: response.status,
      itemCount: 1,
    },
  };
}

async function getEbayItemWithToken(
  token: string,
  itemId: string,
  marketplace: string,
  environment: "production" | "sandbox",
  tokenDebug: EbayTokenDebug
): Promise<{ item: CatalogItem | null; debug: EbaySearchDebug }> {
  // If the ID doesn't contain pipes, convert to RESTful format v1|itemId|0
  let cleanId = itemId;
  if (!cleanId.includes("|") && /^\d+$/.test(cleanId)) {
    cleanId = `v1|${cleanId}|0`;
  }
  const encodedId = cleanId.replace(/\|/g, "%7C");
  // Request PRODUCT fieldgroup to get additional images from product catalog
  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item/${encodedId}?fieldgroups=PRODUCT`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return {
        item: null,
        debug: {
          enabled: true,
          tokenOk: tokenDebug.ok,
          httpStatus: 404,
          itemCount: 0,
          error: "Item not found",
        },
      };
    }
    const errorText = await response.text();
    return {
      item: null,
      debug: {
        enabled: true,
        tokenOk: tokenDebug.ok,
        httpStatus: response.status,
        itemCount: 0,
        error: errorText.slice(0, 500),
      },
    };
  }

  const data = await response.json();
  const item = await normalizeItemDetail(data, null); // No supabase in token retry path
  
  return {
    item,
    debug: {
      enabled: true,
      tokenOk: tokenDebug.ok,
      httpStatus: response.status,
      itemCount: 1,
    },
  };
}

async function normalizeItemDetail(item: any, supabase?: any): Promise<CatalogItem> {
  // Extract attributes from localizedAspects
  const attributes: Record<string, string> = {};
  if (item.localizedAspects) {
    for (const aspect of item.localizedAspects) {
      if (aspect.name && aspect.value) {
        attributes[aspect.name] = aspect.value;
      }
    }
  }

  // Add condition as attribute
  if (item.condition) {
    attributes["Condition"] = item.condition;
  }

  // Use high-res image for main display
  const mainImage = item.image?.imageUrl ? upgradeImageToHighRes(item.image.imageUrl) : null;
  
  // Use async image extraction to potentially scrape more images
  const images = await extractDetailImagesAsync(item, supabase);
  
  return {
    id: `ebay:${item.itemId}`,
    provider: "ebay",
    providerProductId: item.itemId,
    title: item.title || "Unknown",
    priceUsd: extractPrice(item.price),
    currency: item.price?.currency || "USD",
    imageUrl: mainImage,
    images,
    productUrl: item.itemWebUrl || "",
    inStock: item.estimatedAvailabilities?.[0]?.availabilityStatus !== "OUT_OF_STOCK",
    rating: null,
    description: item.shortDescription || item.description || undefined,
    attributes,
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function extractPrice(priceObj: any): number | null {
  if (!priceObj?.value) return null;
  
  const value = parseFloat(priceObj.value);
  if (isNaN(value)) return null;
  
  // If currency is not USD, we'd need conversion
  // For now, assume USD or return as-is
  return value;
}

/**
 * Upgrade eBay image URL to highest resolution (s-l1600)
 * eBay uses s-l### pattern where ### is the size (64, 140, 225, 300, 500, 1600)
 */
function upgradeImageToHighRes(url: string): string {
  return url.replace(/s-l\d+/g, "s-l1600");
}

/**
 * Extract ALL images from eBay item for LIST views
 * Returns all available images from the API response
 */
function extractImages(item: any): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  
  // Primary image (highest priority, upgrade to high-res)
  if (item.image?.imageUrl) {
    const upgraded = upgradeImageToHighRes(item.image.imageUrl);
    if (!seen.has(upgraded)) {
      seen.add(upgraded);
      images.push(upgraded);
    }
  }
  
  // ALL additional images
  if (item.additionalImages && Array.isArray(item.additionalImages)) {
    for (const img of item.additionalImages) {
      if (img.imageUrl) {
        const upgraded = upgradeImageToHighRes(img.imageUrl);
        if (!seen.has(upgraded)) {
          seen.add(upgraded);
          images.push(upgraded);
        }
      }
    }
  }
  
  // Fallback to thumbnails if no primary/additional
  if (images.length === 0 && item.thumbnailImages) {
    for (const thumb of item.thumbnailImages) {
      if (thumb.imageUrl) {
        const upgraded = upgradeImageToHighRes(thumb.imageUrl);
        if (!seen.has(upgraded)) {
          seen.add(upgraded);
          images.push(upgraded);
        }
      }
    }
  }
  
  return images; // Return ALL images, no limit
}

// ─── Scraping Safeguards ───────────────────────────────────────────────────

// In-memory error tracking for auto-disable (reset on cold start)
const scrapeErrorTracker = {
  errorCount: 0,
  successCount: 0,
  windowStart: Date.now(),
  windowMs: 5 * 60 * 1000, // 5-minute window
  disabledUntil: 0,
};

// Reset error window if expired
function maybeResetScrapeWindow() {
  const now = Date.now();
  if (now - scrapeErrorTracker.windowStart > scrapeErrorTracker.windowMs) {
    scrapeErrorTracker.errorCount = 0;
    scrapeErrorTracker.successCount = 0;
    scrapeErrorTracker.windowStart = now;
  }
}

// Check if scraping is currently auto-disabled due to high error rate
function isScrapingAutoDisabled(): boolean {
  const now = Date.now();
  if (now < scrapeErrorTracker.disabledUntil) {
    return true;
  }
  
  maybeResetScrapeWindow();
  
  const totalRequests = scrapeErrorTracker.errorCount + scrapeErrorTracker.successCount;
  // If error rate > 50% in window with at least 5 attempts, auto-disable for 10 minutes
  if (totalRequests >= 5) {
    const errorRate = scrapeErrorTracker.errorCount / totalRequests;
    if (errorRate > 0.5) {
      scrapeErrorTracker.disabledUntil = now + 10 * 60 * 1000; // 10 min backoff
      console.warn(`[EBAY_SCRAPE] Auto-disabled for 10 min due to high error rate: ${(errorRate * 100).toFixed(0)}%`);
      return true;
    }
  }
  return false;
}

// Check admin kill-switch from settings
async function isScrapingEnabled(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "ebay_scraping_enabled")
      .maybeSingle();
    
    // Default to enabled if setting doesn't exist
    if (!data) return true;
    return data.value !== "false" && data.value !== "0";
  } catch {
    return true; // Default enabled on error
  }
}

/**
 * Scrape images directly from eBay item webpage
 * Used as fallback when Browse API returns limited images
 * Returns array of high-res image URLs
 * 
 * SAFEGUARDS:
 * - Admin kill-switch via admin_settings.ebay_scraping_enabled
 * - Auto-disable on high error rate (>50% in 5 min window)
 * - 10-minute backoff when disabled
 */
async function scrapeEbayImages(itemId: string, supabase?: any): Promise<string[]> {
  const images: string[] = [];
  const seen = new Set<string>();
  
  // Check auto-disable first (no DB call needed)
  if (isScrapingAutoDisabled()) {
    debugLog("EBAY_SCRAPE_SKIPPED", { itemId, reason: "auto_disabled" });
    return [];
  }
  
  // Check admin kill-switch
  if (supabase) {
    const enabled = await isScrapingEnabled(supabase);
    if (!enabled) {
      debugLog("EBAY_SCRAPE_SKIPPED", { itemId, reason: "admin_disabled" });
      return [];
    }
  }
  
  try {
    const url = `https://www.ebay.com/itm/${itemId}`;
    debugLog("EBAY_SCRAPE_START", { itemId, url });
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    
    if (!response.ok) {
      scrapeErrorTracker.errorCount++;
      debugLog("EBAY_SCRAPE_FAILED", { itemId, status: response.status });
      return [];
    }
    
    const html = await response.text();
    
    // Pattern 1: Match image URLs in the format https://i.ebayimg.com/images/g/{hash}/s-l{size}.{ext}
    const imgPattern = /https:\/\/i\.ebayimg\.com\/images\/g\/[A-Za-z0-9~_-]+\/s-l\d+\.(jpg|webp|png)/gi;
    const matches = html.match(imgPattern) || [];
    
    for (const imgUrl of matches) {
      // Upgrade all to high-res s-l1600
      const upgraded = imgUrl.replace(/s-l\d+/g, "s-l1600").replace(/\.webp$/, ".jpg");
      if (!seen.has(upgraded)) {
        seen.add(upgraded);
        images.push(upgraded);
      }
    }
    
    // Track success
    scrapeErrorTracker.successCount++;
    debugLog("EBAY_SCRAPE_RESULT", { itemId, imagesFound: images.length });
    return images;
    
  } catch (err) {
    scrapeErrorTracker.errorCount++;
    debugLog("EBAY_SCRAPE_ERROR", { itemId, error: err instanceof Error ? err.message : "Unknown" });
    return [];
  }
}

/**
 * Extract ALL images from eBay item detail for PRODUCT DETAIL view
 * NO LIMIT - returns all available images in high-res
 * Used by getItem for product detail pages
 * 
 * eBay Browse API may return images in various fields:
 * - item.image - primary image object
 * - item.additionalImages[] - additional gallery images
 * - item.galleryImages[] - alternate gallery field (rare)
 * - item.images[] - sometimes a flat array of image objects
 * - item.pictureURLs[] - eBay-specific field in some responses (strings)
 * 
 * For multi-variation listings with many images, also tries scraping the webpage
 */
async function extractDetailImagesAsync(item: any, supabase?: any): Promise<string[]> {
  // First, get images from API response
  const apiImages = extractDetailImagesFromApi(item);
  
  // Only attempt scraping if we have an item ID and API returned incomplete data
  // Threshold: scrape if API returned fewer than 15 images (multi-variation listings often have 30+)
  if (item.itemId && apiImages.length < 15) {
    debugLog("EBAY_IMAGES_SCRAPING", { 
      itemId: item.itemId, 
      apiImageCount: apiImages.length,
      reason: "API returned < 15 images, trying scrape for more"
    });
    
    const scrapedImages = await scrapeEbayImages(item.itemId, supabase);
    
    if (scrapedImages.length > apiImages.length) {
      debugLog("EBAY_IMAGES_SCRAPED_MORE", { 
        itemId: item.itemId, 
        apiCount: apiImages.length,
        scrapedCount: scrapedImages.length,
        using: "scraped"
      });
      return scrapedImages;
    }
  }
  
  return apiImages;
}

/**
 * Extract images from API response only (synchronous, for backwards compat)
 */
function extractDetailImagesFromApi(item: any): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  
  debugLog("EBAY_DETAIL_IMAGES_RAW", {
    itemId: item.itemId,
    hasImage: !!item.image?.imageUrl,
    additionalImagesCount: item.additionalImages?.length ?? 0,
    galleryImagesCount: item.galleryImages?.length ?? 0,
    imagesArrayCount: item.images?.length ?? 0,
    pictureURLsCount: item.pictureURLs?.length ?? 0,
    // NEW: Check product and itemGroup fields (from PRODUCT fieldgroup)
    hasProduct: !!item.product,
    productAdditionalImagesCount: item.product?.additionalImages?.length ?? 0,
    hasPrimaryItemGroup: !!item.primaryItemGroup,
    itemGroupAdditionalImagesCount: item.primaryItemGroup?.itemGroupAdditionalImages?.length ?? 0,
  });
  
  // Helper to add upgraded image
  const addImage = (url: string | undefined | null) => {
    if (!url || typeof url !== "string") return;
    const upgraded = upgradeImageToHighRes(url);
    if (!seen.has(upgraded)) {
      seen.add(upgraded);
      images.push(upgraded);
    }
  };
  
  // Source 1: Primary image (first and highest priority)
  if (item.image?.imageUrl) {
    addImage(item.image.imageUrl);
  }
  
  // Source 2: ALL additional images from item level (seller-uploaded photos)
  if (item.additionalImages && Array.isArray(item.additionalImages)) {
    for (const img of item.additionalImages) {
      addImage(img?.imageUrl);
    }
  }
  
  // Source 3: Product catalog images (from PRODUCT fieldgroup)
  // These are eBay catalog product images that may include additional angles
  if (item.product) {
    // Product primary image
    if (item.product.image?.imageUrl) {
      addImage(item.product.image.imageUrl);
    }
    // Product additional images
    if (item.product.additionalImages && Array.isArray(item.product.additionalImages)) {
      for (const img of item.product.additionalImages) {
        addImage(img?.imageUrl);
      }
    }
  }
  
  // Source 4: Item group images (for multi-variation listings)
  // primaryItemGroup contains images shared across variations
  if (item.primaryItemGroup) {
    // Item group main image
    if (item.primaryItemGroup.itemGroupImage?.imageUrl) {
      addImage(item.primaryItemGroup.itemGroupImage.imageUrl);
    }
    // Item group additional images
    if (item.primaryItemGroup.itemGroupAdditionalImages && Array.isArray(item.primaryItemGroup.itemGroupAdditionalImages)) {
      for (const img of item.primaryItemGroup.itemGroupAdditionalImages) {
        addImage(img?.imageUrl);
      }
    }
  }
  
  // Source 5: Gallery/variant images if present (legacy field)
  if (item.galleryImages && Array.isArray(item.galleryImages)) {
    for (const img of item.galleryImages) {
      addImage(img?.imageUrl);
    }
  }
  
  // Source 6: Flat images array (sometimes present in eBay responses)
  if (item.images && Array.isArray(item.images)) {
    for (const img of item.images) {
      if (typeof img === "string") {
        addImage(img);
      } else if (img?.imageUrl) {
        addImage(img.imageUrl);
      }
    }
  }
  
  // Source 7: pictureURLs - eBay-specific field (array of URL strings)
  if (item.pictureURLs && Array.isArray(item.pictureURLs)) {
    for (const url of item.pictureURLs) {
      addImage(url);
    }
  }
  
  // Source 8: Fallback to thumbnails only if nothing else (upgrade them)
  if (images.length === 0 && item.thumbnailImages && Array.isArray(item.thumbnailImages)) {
    for (const thumb of item.thumbnailImages) {
      addImage(thumb?.imageUrl);
    }
  }
  
  debugLog("EBAY_DETAIL_IMAGES_RESULT", {
    itemId: item.itemId,
    totalImages: images.length,
    sources: {
      primaryImage: item.image?.imageUrl ? 1 : 0,
      additionalImages: item.additionalImages?.length ?? 0,
      productImages: (item.product?.additionalImages?.length ?? 0) + (item.product?.image?.imageUrl ? 1 : 0),
      itemGroupImages: (item.primaryItemGroup?.itemGroupAdditionalImages?.length ?? 0) + (item.primaryItemGroup?.itemGroupImage?.imageUrl ? 1 : 0),
    },
    firstImage: images[0]?.substring(0, 60),
  });
  
  return images; // NO LIMIT for product details
}

// ─── Quick Debug Self-Test ───────────────────────────────────────────────────

export async function debugEbaySearch(
  supabase: any,
  query: string = "iphone",
  limit: number = 5
): Promise<{
  ok: boolean;
  tokenOk: boolean;
  status?: number;
  itemCount: number;
  firstItem?: { id: string; title: string; priceUsd: number | null };
  error?: string;
}> {
  try {
    const result = await searchEbay(supabase, query, 1, limit);
    
    return {
      ok: result.items.length > 0,
      tokenOk: result.debug.tokenOk,
      status: result.debug.httpStatus,
      itemCount: result.items.length,
      firstItem: result.items[0] ? {
        id: result.items[0].id,
        title: result.items[0].title,
        priceUsd: result.items[0].priceUsd,
      } : undefined,
      error: result.debug.error,
    };
  } catch (err) {
    return {
      ok: false,
      tokenOk: false,
      itemCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  search: searchEbay,
  getItem: getEbayItem,
  getToken: getEbayToken,
};
