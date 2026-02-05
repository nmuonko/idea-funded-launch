/**
 * Cart Images Module
 * Image fetching and validation for cart operations
 */

import { normalizeImageUrl } from "./validate.ts";

// Image blocklist patterns - generic logos and placeholders
const IMAGE_BLOCKLIST_PATTERNS = [
  /amazon.*logo/i,
  /placeholder/i,
  /no-image/i,
  /default.*image/i,
  /image.*not.*found/i,
  /spinner/i,
  /loading/i,
  /transparent.*pixel/i,
];

/**
 * Check if image URL is blocked (generic logo, placeholder, etc.)
 */
export function isBlockedImageUrl(url: string): boolean {
  if (!url) return true;
  
  return IMAGE_BLOCKLIST_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Validate and normalize an image URL, checking against blocklist
 */
export function validateImageUrl(raw: unknown, productUrl?: string): string | null {
  const normalized = normalizeImageUrl(raw, productUrl);
  if (!normalized) return null;
  
  if (isBlockedImageUrl(normalized)) {
    return null;
  }
  
  return normalized;
}

/**
 * Scrape product info (image, title) from a URL via edge function
 */
export async function scrapeProductInfo(
  productUrl: string,
  correlationId: string
): Promise<{ imageUrl: string | null; title: string | null }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`[CART_ADD] ${correlationId} Cannot scrape - missing config`);
    return { imageUrl: null, title: null };
  }
  
  const scrapeStart = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.warn(`[CART_ADD] ${correlationId} Scrape timeout reached (4s)`);
    controller.abort();
  }, 4000);
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/get-product-info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ url: productUrl }),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    const data = await response.json().catch(() => ({}));
    const duration = Date.now() - scrapeStart;
    
    console.log(`[CART_ADD] ${correlationId} Scraped product info (${duration}ms, status: ${response.status})`);
    
    let imageUrl: string | null = null;
    let title: string | null = null;
    
    if (data.imageUrl) {
      imageUrl = validateImageUrl(data.imageUrl, productUrl);
    }
    if (data.productTitle) {
      title = data.productTitle;
    }
    
    return { imageUrl, title };
  } catch (e: unknown) {
    clearTimeout(timeout);
    const duration = Date.now() - scrapeStart;
    
    if ((e as Error).name === "AbortError") {
      console.warn(`[CART_ADD] ${correlationId} Scrape aborted after ${duration}ms`);
    } else {
      console.error(`[CART_ADD] ${correlationId} Scrape error (${duration}ms):`, (e as Error).message);
    }
    
    return { imageUrl: null, title: null };
  }
}

/**
 * Try to get image from product cache as fallback
 */
export async function getImageFromCache(
  db: { from: (table: string) => unknown },
  productUrl: string,
  correlationId: string
): Promise<{ imageUrl: string | null; title: string | null }> {
  try {
    const result = await (db.from("product_cache") as any)
      .select("image_url, title")
      .eq("product_url", productUrl)
      .maybeSingle();
    
    if (result.error || !result.data) {
      return { imageUrl: null, title: null };
    }
    
    const imageUrl = validateImageUrl(result.data.image_url, productUrl);
    const title = result.data.title || null;
    
    if (imageUrl) {
      console.log(`[CART_ADD] ${correlationId} Got image from cache: ${imageUrl.substring(0, 60)}`);
    }
    
    return { imageUrl, title };
  } catch (e: unknown) {
    console.warn(`[CART_ADD] ${correlationId} Cache lookup failed:`, (e as Error).message);
    return { imageUrl: null, title: null };
  }
}
