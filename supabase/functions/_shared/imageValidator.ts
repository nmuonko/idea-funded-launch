/**
 * Shared image URL validator for edge functions.
 * Blocks ad banners, seller logos, promotional graphics, and non-product images.
 * Mirrors the frontend `isRenderableImageUrl` logic with additional server-side patterns.
 */

// ─── BLOCKED URL PATTERNS ─────────────────────────────────────────────────────

const BLOCKED_SUBSTRINGS = [
  // Carvana promotional assets
  "merchui/images",
  "promobanner",
  "promo_banner",
  "promo-banner",
  "heliosconditionaltiles",
  "pt.ispot.tv",

  // SHEIN banners
  "_thumbnail_126x",

  // Generic banner/promo patterns
  "/banner",
  "seller_banner",
  "seller-banner",
  "sellerbanner",
  "hero_banner",
  "header_banner",
  "footer_banner",
  "template_banner",
  "storefront_banner",
  "ad_banner",
  "watermark",

  // Logo patterns
  "shoplogo",
  "shop_logo",
  "shop-logo",
  "storelogo",
  "store_logo",
  "store-logo",
  "brandlogo",
  "brand_logo",
  "brand-logo",

  // Badge/promo patterns
  "promo_badge",
  "promo-badge",
  "promotion-badge",

  // Misc non-product patterns
  "icon_only",
  "sprite",
  "no-image-placeholder",
  "no_image_available",
  "image-not-available",
  "imagenotavailable",

  // Health spam images
  "vitalhealthy",
  "vital_health",
  "vital healthy",

  // Specific blocked paths
  "/v4/p/ccc/",
  "images3_pi/2024/01/01/00/",
  "site-cars/merchandising",

  // File types that are never product photos
  ".svg",
  ".gif",
];

// eBay standard product image paths
const EBAY_VALID_PATHS = ["/d/", "/g/", "/s-l"];

/**
 * Extract width/height hints from URL patterns like `_SL500_`, `200x300`, `w=80`, etc.
 */
function extractDimensionHints(url: string): { w: number; h: number } | null {
  // Amazon _SLnnn_ pattern
  const slMatch = url.match(/_SL(\d+)[_.\-]/i);
  if (slMatch) {
    const size = parseInt(slMatch[1]);
    return { w: size, h: size };
  }

  // Amazon _AC_UYnnn_ or _AC_USnnn_ patterns (common thumbnails)
  const acMatch = url.match(/_AC_U[SY](\d+)/i);
  if (acMatch) {
    const size = parseInt(acMatch[1]);
    return { w: size, h: size };
  }

  // Amazon _UYnnn_ or _USnnn_ (without _AC_ prefix)
  const uyMatch = url.match(/_U[SY](\d+)[_.\-]/i);
  if (uyMatch) {
    const size = parseInt(uyMatch[1]);
    return { w: size, h: size };
  }

  // WxH pattern in path: /200x300/ or _200x300.
  const whMatch = url.match(/[/_](\d{2,4})x(\d{2,4})[/_.]/);
  if (whMatch) {
    return { w: parseInt(whMatch[1]), h: parseInt(whMatch[2]) };
  }

  // Width query param
  const wParam = url.match(/[?&]w(?:idth)?=(\d+)/i);
  const hParam = url.match(/[?&]h(?:eight)?=(\d+)/i);
  if (wParam && hParam) {
    return { w: parseInt(wParam[1]), h: parseInt(hParam[1]) };
  }

  return null;
}

/**
 * Check if an image URL is a valid product image.
 * Returns true if the URL appears to be a genuine product photo.
 * Returns false for banners, logos, promos, SVGs, GIFs, tiny images, etc.
 */
export function isValidProductImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;

  const lower = url.toLowerCase();

  // Must start with http
  if (!lower.startsWith("http")) return false;

  // Block .html pages
  if (lower.includes(".html")) return false;

  // Block known bad substrings
  for (const pattern of BLOCKED_SUBSTRINGS) {
    if (lower.includes(pattern)) return false;
  }

  // Block promotion + badge/banner combo
  if (lower.includes("promotion") && (lower.includes("badge") || lower.includes("banner"))) return false;

  // eBay-specific: only allow standard product photo paths
  if (lower.includes("ebayimg.com")) {
    const hasValidPath = EBAY_VALID_PATHS.some(p => lower.includes(p));
    if (!hasValidPath) return false;
  }

  // Check dimension hints for extreme aspect ratios or tiny/blurry images
  const dims = extractDimensionHints(url);
  if (dims) {
    const { w, h } = dims;
    // Block small images (< 150px either dimension → blurry on modern screens)
    if (w > 0 && w < 150) return false;
    if (h > 0 && h < 150) return false;

    // Block extreme aspect ratios (banners are wide, logos are tall)
    if (w > 0 && h > 0) {
      const ratio = w / h;
      if (ratio > 2.2 || ratio < 0.45) return false;
    }
  }

  return true;
}

/**
 * Upgrade image URL to highest available resolution.
 * Works for Amazon, eBay, SHEIN, and Carvana CDN patterns.
 * Handles ALL known thumbnail tokens including _AC_UY###_, _US###_, _SX###_, _SR###,###
 */
export function upgradeToHighRes(url: string | null | undefined): string | null {
  if (!url) return null;

  let upgraded = url;

  // Amazon: upgrade ALL thumbnail/resize patterns to high-res
  if (upgraded.includes("m.media-amazon.com") || upgraded.includes("images-amazon.com") || upgraded.includes("ssl-images-amazon.com")) {
    upgraded = upgraded
      .replace(/_SL\d{2,4}([_.])/gi, '_SL1500$1')
      .replace(/_SS\d{2,4}([_.])/gi, '_SL1500$1')
      .replace(/_SX\d{2,4}([_.])/gi, '_SL1500$1')
      .replace(/_SY\d{2,4}([_.])/gi, '_SL1500$1')
      .replace(/_AC_SL\d{2,4}/gi, '_AC_SL1500')
      .replace(/_AC_UY\d{2,4}/gi, '_AC_SL1500')
      .replace(/_AC_US\d{2,4}/gi, '_AC_SL1500')
      .replace(/_AC_UL\d{2,4}/gi, '_AC_SL1500')
      .replace(/_UY\d{2,4}([_.])/gi, '_SL1500$1')
      .replace(/_US\d{2,4}([_.])/gi, '_SL1500$1')
      .replace(/_SR\d+,\d+([_.])/gi, '_SL1500$1');
  }

  // eBay: replace s-l225 / s-l300 / s-l500 with s-l1600
  if (upgraded.includes("ebayimg.com")) {
    upgraded = upgraded.replace(/s-l\d+/gi, "s-l1600");
  }

  // SHEIN: strip _thumbnail_xxx to get original full-size
  if (upgraded.includes("ltwebstatic.com")) {
    upgraded = upgraded.replace(/_thumbnail_\d+x\d*/gi, "");
  }

  // Carvana: ensure standardizedHero
  if (upgraded.includes("carvana.io") && !upgraded.includes("standardizedHero")) {
    upgraded = upgraded.replace(/\/\w+\.jpg$/i, "/standardizedHero.jpg");
  }

  return upgraded;
}

/**
 * Sanitize an image URL: returns the URL if valid, or null if it's a banner/ad.
 * Use this when building upsert records.
 */
export function sanitizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return isValidProductImageUrl(url) ? url : null;
}
