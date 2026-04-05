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
  // Amazon known generic placeholder (tiny product icon)
  /\/21dM81tBHEL\./i,
  
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
  /ebaystatic\.com\/cr\/v\/c1\/.*logo/i,
  /i\.ebayimg\.com\/.*thumbs\/images\/g\/logo/i,
  
  // Walmart generic images
  /walmart.*spark.*logo/i,
  /i5\.walmartimages\.com.*logo/i,
  /walmart\.com\/static\/.*logo/i,
  
  // Target generic images
  /target.*bullseye/i,
  /target.*logo/i,
  /target\.scene7\.com\/.*logo/i,
  
  // Best Buy generic images
  /bestbuy.*logo/i,
  /pisces\.bbystatic\.com.*logo/i,
  
  // SHEIN generic images
  /shein.*logo/i,
  /sheinsz\.ltwebstatic\.com.*logo/i,
  /img\.ltwebstatic\.com.*logo/i,
  // SHEIN known category placeholder image
  /1585556531965e5d98ef5a432eab61147c16af31c6/i,
  // SHEIN color swatch images (tiny solid-color squares)
  /ltwebstatic\.com\/v4\/p\/ccc\//i,
  /ltwebstatic\.com\/images3_ccc\//i,

  // Vehicle dealer overlay/composite images
  /autonationoverlays/i,
  /nophoneoverlay/i,
  /anwhitebg/i,
  
  // Macy's generic images
  /macys.*logo/i,
  /slimages\.macysassets\.com.*logo/i,
  
  // Home Depot generic images
  /homedepot.*logo/i,
  /images\.homedepot-static\.com.*logo/i,
  
  // Mercari generic images
  /mercari.*logo/i,
  /static\.mercdn\.net.*logo/i,
  
  // Wayfair generic images
  /wayfair.*logo/i,
  /secure\.img1-fg\.wfcdn\.com.*logo/i,
  
  // AfriShop logo (our own app logo showing up incorrectly)
  /afrishop.*logo/i,
  /afrifund.*logo/i,
  
  // Common 1x1 tracking pixels or tiny images
  /1x1\.(gif|png)/i,
  /pixel\.(gif|png)/i,
  /spacer\.(gif|png)/i,

  // CTA / promotional overlay images
  /shop[_-]?now/i,
  /buy[_-]?now/i,
  /add[_-]?to[_-]?cart/i,
  /sponsored/i,
  /review[_-]?badge/i,
  /warranty[_-]?badge/i,
  /trust[_-]?badge/i,
  /guarantee[_-]?badge/i,
  /promo[_-]?overlay/i,
  /text[_-]?overlay/i,
  /badge[_-]?overlay/i,

  // Amazon overlay/support-plan images
  /pkmb-play-button-overlay/i,
  /play[_-]?button[_-]?overlay/i,
  /asurion/i,
  /protection[_-]?plan/i,

  // Marketing/brand-story images
  /aplus[_-]?media/i,
  /\/aplus\//i,
  /brand[_-]?story/i,
  /from[_-]?the[_-]?brand/i,
  /rich[_-]?product[_-]?description/i,
  /social[_-]?share/i,
  /gift[_-]?card/i,
  /watermark/i,
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

// ─── IMAGE RESOLUTION UPGRADE ────────────────────────────────────────────────

/**
 * Upgrade eBay image URL to highest resolution (s-l1600)
 * eBay uses s-l### pattern where ### is the size (64, 140, 225, 300, 500, 1600)
 */
function upgradeEbayToHighRes(url: string): string {
  return url.replace(/s-l\d+/gi, "s-l1600");
}

/**
 * Upgrade Amazon image URL to highest resolution
 * Amazon uses various size tokens: _SX###, _SY###, _AC_US###, etc.
 */
function upgradeAmazonToHighRes(url: string): string {
  // Already high-res
  if (url.includes("_SL1500") || url.includes("_SL1600")) return url;
  
  // Upgrade size tokens to SL1500
  return url
    .replace(/_S[XYL]\d{2,3}\./gi, "_SL1500.")
    .replace(/_SS\d{2,3}\./gi, "_SL1500.")
    .replace(/_AC_U[SYL]\d{2,3}/gi, "_AC_SL1500")
    .replace(/_SR\d+,\d+\./gi, "_SL1500.");
}

/**
 * Detect if URL is from a known provider and upgrade to high-res
 */
function upgradeToHighRes(url: string): string {
  // eBay images
  if (url.includes("ebayimg.com") || url.includes("i.ebayimg")) {
    const upgraded = upgradeEbayToHighRes(url);
    if (upgraded !== url) {
      console.log("[IMAGE_UPGRADE] eBay:", url.substring(0, 50), "→ high-res");
    }
    return upgraded;
  }
  
  // Amazon images
  if (url.includes("amazon") || url.includes("media-amazon") || url.includes("ssl-images-amazon")) {
    const upgraded = upgradeAmazonToHighRes(url);
    if (upgraded !== url) {
      console.log("[IMAGE_UPGRADE] Amazon:", url.substring(0, 50), "→ high-res");
    }
    return upgraded;
  }
  
  // SHEIN images: strip thumbnail suffix for full-size
  if (url.includes("ltwebstatic.com") && /_thumbnail_\d+x\d+/i.test(url)) {
    const upgraded = url.replace(/_thumbnail_\d+x\d+/i, '');
    console.log("[IMAGE_UPGRADE] SHEIN:", url.substring(0, 50), "→ full-size");
    return upgraded;
  }
  
  return url;
}

/**
 * Normalize and validate an image URL, rejecting blocked patterns.
 * This combines URL normalization with blocklist filtering AND resolution upgrade.
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

  // Upgrade to high-res version
  const upgradedUrl = upgradeToHighRes(validatedUrl);

  return upgradedUrl;
}
