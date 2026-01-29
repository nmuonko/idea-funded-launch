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

  const items: CatalogItem[] = itemSummaries.map((item: any) => ({
    id: `ebay:${item.itemId}`,
    provider: "ebay",
    providerProductId: item.itemId,
    title: item.title || "Unknown",
    priceUsd: extractPrice(item.price),
    currency: item.price?.currency || "USD",
    imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
    images: extractImages(item),
    productUrl: item.itemWebUrl || item.itemHref || "",
    inStock: item.itemAvailability?.availabilityStatus !== "OUT_OF_STOCK",
    rating: null, // eBay doesn't return ratings in search
  }));

  return { items, total, hasMore };
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
  const cleanId = itemId.startsWith("ebay:") ? itemId.slice(5) : itemId;
  
  // eBay item IDs need pipe encoding
  const encodedId = cleanId.replace(/\|/g, "%7C");
  
  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item/${encodedId}`;
  
  debugLog("EBAY_ITEM_REQ", { itemId: cleanId, marketplace, endpoint });

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
  const item = normalizeItemDetail(data);
  
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
  const encodedId = itemId.replace(/\|/g, "%7C");
  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item/${encodedId}`;

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
  const item = normalizeItemDetail(data);
  
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

function normalizeItemDetail(item: any): CatalogItem {
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

  return {
    id: `ebay:${item.itemId}`,
    provider: "ebay",
    providerProductId: item.itemId,
    title: item.title || "Unknown",
    priceUsd: extractPrice(item.price),
    currency: item.price?.currency || "USD",
    imageUrl: item.image?.imageUrl || null,
    images: extractDetailImages(item),
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

function extractImages(item: any): string[] {
  const images: string[] = [];
  
  if (item.image?.imageUrl) {
    images.push(item.image.imageUrl);
  }
  
  if (item.thumbnailImages) {
    for (const thumb of item.thumbnailImages) {
      if (thumb.imageUrl && !images.includes(thumb.imageUrl)) {
        images.push(thumb.imageUrl);
      }
    }
  }
  
  if (item.additionalImages) {
    for (const img of item.additionalImages) {
      if (img.imageUrl && !images.includes(img.imageUrl)) {
        images.push(img.imageUrl);
      }
    }
  }
  
  return images.slice(0, 10); // Max 10 images
}

function extractDetailImages(item: any): string[] {
  const images: string[] = [];
  
  if (item.image?.imageUrl) {
    images.push(item.image.imageUrl);
  }
  
  if (item.additionalImages) {
    for (const img of item.additionalImages) {
      if (img.imageUrl && !images.includes(img.imageUrl)) {
        images.push(img.imageUrl);
      }
    }
  }
  
  return images.slice(0, 10);
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
