/**
 * eBay Browse API Adapter
 * Handles OAuth token caching and product search/detail
 * For display-only catalog (no purchases)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EbayConfig {
  environment: "production" | "sandbox";
  marketplace: string;
  searchLimit: number;
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

// ─── OAuth Token Management ──────────────────────────────────────────────────

/**
 * Get a valid OAuth token, using cache or minting new
 */
export async function getEbayToken(supabase: any): Promise<string> {
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
      console.log("[ebayAdapter] Using cached token, expires:", cached.expires_at);
      return cached.access_token;
    }
  }

  // Mint new token
  console.log("[ebayAdapter] Minting new OAuth token");
  return await mintNewToken(supabase);
}

/**
 * Mint a new OAuth application access token
 */
async function mintNewToken(supabase: any): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
  }

  const endpoint = EBAY_ENDPOINTS[environment].oauth;
  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_OAUTH_SCOPES)}`,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[ebayAdapter] Token mint failed:", response.status, errorText);
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

  console.log("[ebayAdapter] Token minted, expires:", expiresAt.toISOString());
  return access_token;
}

// ─── Search API ──────────────────────────────────────────────────────────────

/**
 * Search eBay for products
 */
export async function searchEbay(
  supabase: any,
  query: string,
  page: number = 1,
  pageSize: number = 20,
  config?: Partial<EbayConfig>
): Promise<{ items: CatalogItem[]; total: number; hasMore: boolean }> {
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const token = await getEbayToken(supabase);
  
  const offset = (page - 1) * pageSize;
  const marketplace = config?.marketplace || "EBAY_US";
  
  const params = new URLSearchParams({
    q: query,
    limit: String(pageSize),
    offset: String(offset),
    // Filter to fixed price items in good condition
    filter: "buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}",
  });

  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item_summary/search?${params}`;
  
  console.log("[ebayAdapter] Searching:", query, "page:", page);

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
    console.error("[ebayAdapter] Search failed:", response.status, errorText);
    
    // If unauthorized, try minting new token once
    if (response.status === 401) {
      console.log("[ebayAdapter] Token expired, re-minting");
      const newToken = await mintNewToken(supabase);
      return searchEbayWithToken(newToken, query, page, pageSize, marketplace, environment);
    }
    
    throw new Error(`eBay search failed: ${response.status}`);
  }

  const data = await response.json();
  return normalizeSearchResults(data);
}

async function searchEbayWithToken(
  token: string,
  query: string,
  page: number,
  pageSize: number,
  marketplace: string,
  environment: "production" | "sandbox"
): Promise<{ items: CatalogItem[]; total: number; hasMore: boolean }> {
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
    throw new Error(`eBay search failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return normalizeSearchResults(data);
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
): Promise<CatalogItem | null> {
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const token = await getEbayToken(supabase);
  const marketplace = config?.marketplace || "EBAY_US";

  // Clean the item ID (remove ebay: prefix if present)
  const cleanId = itemId.startsWith("ebay:") ? itemId.slice(5) : itemId;
  
  // eBay item IDs need pipe encoding
  const encodedId = cleanId.replace(/\|/g, "%7C");
  
  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item/${encodedId}`;
  
  console.log("[ebayAdapter] Getting item:", cleanId);

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
      console.log("[ebayAdapter] Item not found:", cleanId);
      return null;
    }
    
    // If unauthorized, try minting new token once
    if (response.status === 401) {
      console.log("[ebayAdapter] Token expired, re-minting");
      const newToken = await mintNewToken(supabase);
      return getEbayItemWithToken(newToken, cleanId, marketplace, environment);
    }
    
    const errorText = await response.text();
    console.error("[ebayAdapter] Get item failed:", response.status, errorText);
    throw new Error(`eBay getItem failed: ${response.status}`);
  }

  const data = await response.json();
  return normalizeItemDetail(data);
}

async function getEbayItemWithToken(
  token: string,
  itemId: string,
  marketplace: string,
  environment: "production" | "sandbox"
): Promise<CatalogItem | null> {
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
    if (response.status === 404) return null;
    const errorText = await response.text();
    throw new Error(`eBay getItem failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return normalizeItemDetail(data);
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

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  search: searchEbay,
  getItem: getEbayItem,
  getToken: getEbayToken,
};
