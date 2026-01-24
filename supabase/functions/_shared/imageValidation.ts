/**
 * Shared image validation utilities for filtering out generic/placeholder images.
 * Used across cart functions and product scraper to prevent logos from appearing in cart.
 */

/**
 * Patterns that match known generic/placeholder images that should be rejected.
 * These commonly appear when og:image returns a site logo instead of product image.
 */
export const BLOCKED_IMAGE_PATTERNS: RegExp[] = [
  // Amazon generic logos and placeholders
  /amazon.*social[_-]?share.*amazon[_-]?logo/i,
  /amazon.*images\/I\/[A-Za-z0-9]+.*amazon[_-]?logo/i,
  /amazon.*no[_-]?image/i,
  /images-na\.ssl-images-amazon\.com.*amazon[_-]?logo/i,
  /m\.media-amazon\.com.*amazon[_-]?logo/i,
  
  // Generic placeholder patterns
  /placeholder/i,
  /no[_-]?image/i,
  /image[_-]?not[_-]?available/i,
  /default[_-]?image/i,
  /default[_-]?product/i,
  /missing[_-]?image/i,
  /unavailable/i,
  
  // Social share / OG defaults (often logos)
  /og[_-]?default/i,
  /social[_-]?share[_-]?default/i,
  /share[_-]?image[_-]?default/i,
  
  // Generic logo file patterns (at end of URL path)
  /\/logo\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /\/site[_-]?logo\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /\/brand[_-]?logo\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /\/company[_-]?logo\.(png|jpg|jpeg|gif|svg|webp)$/i,
  
  // eBay generic images
  /ebay.*logo/i,
  /ebaystatic.*logo/i,
  
  // Walmart generic images
  /walmart.*spark.*logo/i,
  /i5\.walmartimages\.com.*logo/i,
  
  // Target generic images
  /target.*bullseye/i,
  /target.*logo/i,
  
  // Best Buy generic images
  /bestbuy.*logo/i,
  
  // AfriShop logo (our own app logo showing up incorrectly)
  /afrishop.*logo/i,
  /afrifund.*logo/i,
  
  // Common 1x1 tracking pixels or tiny images
  /1x1\.(gif|png)/i,
  /pixel\.(gif|png)/i,
  /spacer\.(gif|png)/i,
];

/**
 * Check if an image URL matches known blocked patterns.
 * @param url - The image URL to check
 * @returns true if the URL should be blocked (is a generic/placeholder image)
 */
export function isBlockedImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return true;
  
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return true;
  
  for (const pattern of BLOCKED_IMAGE_PATTERNS) {
    if (pattern.test(trimmedUrl)) {
      console.log('[IMAGE_BLOCKED] Rejected generic image:', trimmedUrl.substring(0, 80));
      return true;
    }
  }
  
  return false;
}

/**
 * Normalize and validate an image URL, rejecting blocked patterns.
 * This combines URL normalization with blocklist filtering.
 * 
 * @param raw - Raw image URL (may be protocol-relative or relative path)
 * @param productUrl - Product URL for resolving relative paths
 * @returns Normalized absolute https URL or null if invalid/blocked
 */
export function normalizeAndValidateImageUrl(raw: unknown, productUrl?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // Ignore non-web URIs
  if (s.startsWith("data:") || s.startsWith("blob:")) return null;

  // Protocol-relative → https
  if (s.startsWith("//")) {
    s = "https:" + s;
  }

  // Relative path → resolve against product URL origin (if available)
  if (s.startsWith("/") || (!s.startsWith("http://") && !s.startsWith("https://"))) {
    if (productUrl) {
      try {
        const base = new URL(productUrl);
        s = new URL(s, base.origin).toString();
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  // Final URL validation
  let validatedUrl: string;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    validatedUrl = u.toString();
  } catch {
    return null;
  }

  // Check against blocklist
  if (isBlockedImageUrl(validatedUrl)) {
    return null;
  }

  return validatedUrl;
}
