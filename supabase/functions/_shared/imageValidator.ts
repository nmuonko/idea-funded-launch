/**
 * Shared image URL validator for edge functions.
 * Blocks ad banners, seller logos, promotional graphics, and non-product images.
 * 
 * SINGLE SOURCE OF TRUTH for all backend image validation.
 * Frontend mirrors this in src/lib/imageValidation.ts
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

  // Seller branding
  "lovegrown", "love-grown", "love_grown",
  "descriptionimage", "seller_pic", "seller-pic",
  "/00/s/", "vistaprint", "ebay.com/usr/",

  // Amazon badges & renewed labels
  "certified-renewed", "certified_renewed", "amazon-renewed",
  "satisfaction-guarantee", "satisfaction_guarantee",
  "free-shipping", "free_shipping", "best-seller", "best_seller",
  "warranty-badge", "warranty_badge", "money-back", "money_back",
  "trust-badge", "trust_badge", "guarantee-badge",

  // SHEIN promo paths
  "ltwebstatic.com/she_dist/", "ltwebstatic.com/images/bg/",
  "images3_ccc/",

  // Filename-level markers
  "-logo.", "_logo.", "-badge.", "_badge.", "-stamp.", "_stamp.",
  "-icon.", "_icon.",

  // Marketing / campaign paths
  "landing-page", "landing_page", "landingpage",
  "marketing/", "campaign/", "promotional/",
  "coupon", "discount-badge", "discount_badge",
  "sale-badge", "sale_badge", "deal-badge",
  "storefront/", "store-front/",
  "brand-page", "brand_page",
  "/ads/", "/advertisement/",
  "comparison-chart", "comparison_chart",
  "infographic", "info-graphic",

  // Misc non-product
  "flash-sale", "flash_sale",
  "/swatch", "/color-swatch", "/color_swatch",
  "gift-card", "gift_card", "giftcard",
  "social-share", "social_share", "share-icon",
  "review-badge", "review_badge",
  "top-rated", "top_rated",
  "best-price", "best_price",
  "price-drop", "price_drop",
  "new-arrival", "new_arrival",
  "trending-badge", "trending_badge",

  // Ad tracking / ad system images
  "amazon-adsystem.com", "aax-us-east", "aax-us-west",
  "fls-na.amazon.com", "fls-eu.amazon.com",
  "ir-na.amazon-adsystem.com", "ir-uk.amazon-adsystem.com",
  "assoc-amazon.com", "rcm-na.amazon-adsystem.com",
  "/e/is/", "/impb?", "ad-spec-", "ad_spec_",
  "serving-sys.com", "doubleclick.net", "googlesyndication",
  "googleadservices", "adsserver", "adnxs.com",

  // eBay ad/tracking
  "rover.ebay.com", "srp.ebay.com",

  // Generic ad network / tracking
  "pixel.", "tracking.", "beacon.",
  "1x1.", "spacer.gif", "blank.gif",

  // Amazon renewed/certified badge overlays
  "renewed-badge", "renewed_badge", "certified-badge",
  "amazon-certified", "premium-badge", "premium_badge",
  "a]+-view", "lifestyle-image", "lifestyle_image",

  // Common ad overlay / composite image patterns
  "comparison-image", "comparison_image",
  "before-after", "before_after",
  "text-overlay", "text_overlay",
  "promo-overlay", "promo_overlay",
  "sale-overlay", "sale_overlay",
  "badge-overlay", "badge_overlay",

  // Amazon A+ content / brand story images (non-product photos)
  "aplus-media", "aplus_media", "/aplus/",
  "brand-story", "brand_story",
  "fromthebrand", "from-the-brand", "from_the_brand",
  "brandstory", "rich-product-description",
  "editorial-", "editorial_",
  "feature-callout", "feature_callout",

  // Shop Now / CTA overlays
  "shop-now", "shop_now", "shopnow",
  "buy-now", "buy_now", "buynow",
  "order-now", "order_now",
  "add-to-cart", "add_to_cart",
  "limited-time", "limited_time",
  "sponsored-", "sponsored_", "/sponsored",

  // Amazon video play-button overlays (not product photos)
  "pkmb-play-button-overlay",
  "play-button-overlay",
  "play_button_overlay",

  // Category banners
  "category-banner", "category_banner",
  "announcement-bar", "announcement_bar",
  "email-banner", "email_banner",
  "nav-banner", "nav_banner",
  "lifestyle-banner", "lifestyle_banner",
];

// eBay standard product image paths
const EBAY_VALID_PATHS = ["/d/", "/g/", "/s-l"];

/** Filename patterns that strongly indicate non-product promotional content */
const PROMO_FILENAME_PATTERNS = [
  /^banner/i,
  /^promo/i,
  /^hero[-_]/i,
  /^ad[-_]/i,
  /^shop[-_]?now/i,
  /^buy[-_]?now/i,
  /\bcta\b/i,
  /^sale[-_]/i,
  /^offer[-_]/i,
  /^deal[-_]/i,
  /^coupon/i,
  /^sponsored/i,
];

/**
 * Check if an image URL is a valid product image.
 * Returns true if the URL appears to be a genuine product photo.
 * Returns false for banners, logos, promos, SVGs, GIFs, etc.
 * 
 * IMPORTANT: Does NOT reject based on Amazon/eBay thumbnail size tokens
 * (_AC_UY218_, s-l225) because those are upgradeable to high-res.
 * Only rejects truly tiny images from WxH patterns or non-product content.
 */
export function isValidProductImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;

  const lower = url.toLowerCase();

  if (!lower.startsWith("http")) return false;
  if (lower.includes(".html")) return false;
  if (lower.startsWith("data:")) return false;

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

  // Check WxH dimension patterns (NOT provider thumbnail tokens which are upgradeable)
  const whMatch = lower.match(/[/_](\d{2,4})x(\d{2,4})[/_.]/);
  if (whMatch) {
    const w = parseInt(whMatch[1]);
    const h = parseInt(whMatch[2]);
    // Block truly tiny images (tracking pixels, spacers)
    if (w < 50 && h < 50) return false;
    if (w < 50 || h < 50) return false;
    // Block extreme aspect ratios
    const ratio = w / Math.max(h, 1);
    if (ratio > 2.5 || ratio < 0.4) return false;
  }

  // Check filename for promotional patterns
  const filename = lower.split('/').pop()?.split('?')[0] || '';
  if (PROMO_FILENAME_PATTERNS.some(pat => pat.test(filename))) return false;

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
  if (upgraded.includes("carvana.io") && !upgraded.includes("standardizedHero") && upgraded.includes("/stock/")) {
    upgraded = upgraded.replace(/\/[^/]+\.jpg$/i, "/standardizedHero.jpg");
  }

  return upgraded;
}

/**
 * Sanitize an image URL: upgrade to high-res and validate.
 * Returns the upgraded URL if valid, or null if it's a banner/ad.
 */
export function sanitizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!isValidProductImageUrl(url)) return null;
  return upgradeToHighRes(url);
}

/**
 * Filter and upgrade a gallery array.
 * Validates, upgrades to high-res, and deduplicates.
 */
export function sanitizeGallery(urls: string[]): string[] {
  if (!urls || !Array.isArray(urls)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const u of urls) {
    if (typeof u !== 'string' || !u.startsWith('http')) continue;
    if (!isValidProductImageUrl(u)) continue;
    const upgraded = upgradeToHighRes(u) || u;
    const key = upgraded.toLowerCase().replace(/\?.*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(upgraded);
  }
  return result;
}