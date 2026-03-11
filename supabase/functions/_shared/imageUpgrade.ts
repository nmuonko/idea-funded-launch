/**
 * Image URL Upgrade & Sanitization Module
 * 
 * DELEGATES core image validation to imageValidator.ts (single source of truth).
 * This module adds provider-specific resolution upgrade logic on top.
 */

import { isValidProductImageUrl } from "./imageValidator.ts";

/**
 * Check if a URL is a promotional/banner/non-product image.
 * DELEGATES to the shared imageValidator — single source of truth.
 * 
 * Returns true → block this image
 * Returns false → this looks like a real product image
 */
export function isPromotionalImage(url: string): boolean {
  return !isValidProductImageUrl(url);
}

/**
 * Filter an array of image URLs, removing all promotional/non-product images.
 * Deduplicates by normalized URL. Returns only valid product images.
 */
export function filterProductImages(urls: string[]): string[] {
  if (!urls || !Array.isArray(urls)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const u of urls) {
    if (typeof u !== 'string' || !u.startsWith('http')) continue;
    if (!isValidProductImageUrl(u)) continue;
    const key = u.toLowerCase().replace(/\?.*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(u);
  }
  return result;
}

/**
 * Select the best primary product image from a list.
 * Prefers high-res images, filters out promos, returns null if none valid.
 */
export function selectBestProductImage(urls: string[], provider?: string): string | null {
  const filtered = filterProductImages(urls);
  if (filtered.length === 0) return null;
  const first = filtered[0];
  if (provider === 'ebay' || first.includes('ebayimg.com')) return upgradeEbayImage(first);
  if (provider === 'amazon' || provider === 'rainforest' || first.includes('amazon.com') || first.includes('media-amazon.com')) return upgradeAmazonImage(first);
  return first;
}

// ─── Image Resolution Upgrade ────────────────────────────────────────────────

export function upgradeEbayImage(url: string | null): string | null {
  if (!url) return null;
  if (!isValidProductImageUrl(url)) return null;
  return url.replace(/s-l\d+/gi, "s-l1600");
}

export function upgradeAmazonImage(url: string | null): string | null {
  if (!url) return null;
  if (!isValidProductImageUrl(url)) return null;
  if (url.includes("_SL1500") || url.includes("_SL1600")) return url;
  let upgraded = url
    .replace(/_S[XYLR]\d{2,4}[._]/gi, (m) => `_SL1500${m.charAt(m.length - 1)}`)
    .replace(/_SS\d{2,3}[._]/gi, (m) => `_SL1500${m.charAt(m.length - 1)}`)
    .replace(/_AC_U[SYL]\d{2,4}/gi, "_AC_SL1500")
    .replace(/_AC_SL\d{2,4}/gi, "_AC_SL1500")
    .replace(/_SR\d+,\d+[._]/gi, (m) => `_SL1500${m.charAt(m.length - 1)}`);
  return upgraded;
}

export function upgradeImageByProvider(url: string | null, provider: string): string | null {
  if (!url) return null;
  if (provider === "rainforest" || provider === "amazon") return upgradeAmazonImage(url);
  if (provider === "ebay") return upgradeEbayImage(url);
  if (!isValidProductImageUrl(url)) return null;
  return url;
}
