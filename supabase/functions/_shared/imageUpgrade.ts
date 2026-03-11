/**
 * Image URL Upgrade & Sanitization Module — SINGLE SOURCE OF TRUTH
 * 
 * ALL image filtering across the entire backend MUST use this module.
 * Do NOT create local copies of isPromotionalImage in individual functions.
 * 
 * Covers: search results, product detail galleries, cached catalog data,
 * ingestion pipelines, and live provider results.
 */

// ─── Promotional / Non-Product Image Detection ──────────────────────────────

/**
 * URL path/token patterns that indicate non-product images.
 * Matches are case-insensitive substring checks against the full URL.
 */
const PROMO_BLOCKED_TOKENS = [
  // Seller branding
  'lovegrown', 'love-grown', 'love_grown',
  'vital_health', 'vitalhealthy',
  'sellerbanner', 'seller_banner', 'seller-banner',
  'shoplogo', 'shop_logo', 'shop-logo', 'store_logo', 'store-logo', 'storelogo',
  'brandlogo', 'brand_logo', 'brand-logo',
  'watermark',

  // Promo badges & banners
  'promo_badge', 'promo-badge', 'promotion-badge',
  'promobanner', 'promo_banner', 'promo-banner',
  'header_banner', 'footer_banner', 'hero_banner', 'ad_banner',
  'template_banner', 'storefront_banner',
  'category-banner', 'category_banner',
  'announcement-bar', 'announcement_bar',
  'email-banner', 'email_banner',
  'nav-banner', 'nav_banner',
  'lifestyle-banner', 'lifestyle_banner',

  // Generic non-product tokens
  'sprite', 'icon_only',
  'no-image-placeholder',
  '/banner', '_thumbnail_126x',
  'descriptionimage', 'seller_pic', 'seller-pic',
  '/00/s/', 'vistaprint', 'ebay.com/usr/',

  // Amazon badges & renewed labels
  'certified-renewed', 'certified_renewed', 'amazon-renewed',
  'satisfaction-guarantee', 'satisfaction_guarantee',
  'free-shipping', 'free_shipping', 'best-seller', 'best_seller',
  'warranty-badge', 'warranty_badge', 'money-back', 'money_back',
  'trust-badge', 'trust_badge', 'guarantee-badge',

  // Filename-level markers
  '-logo.', '_logo.', '-badge.', '_badge.', '-stamp.', '_stamp.',
  '-icon.', '_icon.',

  // Marketing / campaign paths
  'landing-page', 'landing_page', 'landingpage',
  'marketing/', 'campaign/', 'promotional/',
  'coupon', 'discount-badge', 'discount_badge',
  'sale-badge', 'sale_badge', 'deal-badge',
  'storefront/', 'store-front/',
  'brand-page', 'brand_page',
  '/ads/', '/advertisement/',
  'comparison-chart', 'comparison_chart',
  'infographic', 'info-graphic',

  // SHEIN-specific promo paths
  '/v4/p/ccc/', 'images3_ccc/',
  'ltwebstatic.com/she_dist/', 'ltwebstatic.com/images/bg/',
  'images3_pi/2024/01/01/00/',

  // Carvana merchandising
  'assets.fastly.carvana.io/merchui/images',
  'site-cars/merchandising', 'heliosconditionaltiles',

  // Misc non-product
  'flash-sale', 'flash_sale',
  '/swatch', '/color-swatch', '/color_swatch',
  'gift-card', 'gift_card', 'giftcard',
  'social-share', 'social_share', 'share-icon',
  'review-badge', 'review_badge',
  'top-rated', 'top_rated',
  'best-price', 'best_price',
  'price-drop', 'price_drop',
  'new-arrival', 'new_arrival',
  'trending-badge', 'trending_badge',
  'pt.ispot.tv',

  // Amazon ad tracking / ad system images (these are NOT product photos)
  'amazon-adsystem.com', 'aax-us-east', 'aax-us-west',
  'fls-na.amazon.com', 'fls-eu.amazon.com',
  'ir-na.amazon-adsystem.com', 'ir-uk.amazon-adsystem.com',
  'assoc-amazon.com', 'rcm-na.amazon-adsystem.com',
  '/e/is/', '/impb?', 'ad-spec-', 'ad_spec_',
  'serving-sys.com', 'doubleclick.net', 'googlesyndication',
  'googleadservices', 'adsserver', 'adnxs.com',

  // eBay ad/tracking pixels
  'rover.ebay.com', 'srp.ebay.com',

  // Generic ad network images
  'pixel.', 'tracking.', 'beacon.',
  '1x1.', 'spacer.gif', 'blank.gif',

  // Shop Now / CTA overlays
  'shop-now', 'shop_now', 'shopnow',
  'buy-now', 'buy_now', 'buynow',
  'order-now', 'order_now',
  'add-to-cart', 'add_to_cart',
  'limited-time', 'limited_time',
  'sponsored-', 'sponsored_', '/sponsored',
];

/** Filename patterns that strongly indicate non-product promotional content */
const PROMO_FILENAME_RE = [
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
 * Check if a URL is a promotional/banner/non-product image.
 * Used across ALL backend entry points: search, product detail, ingestion, cache.
 * 
 * Returns true → block this image
 * Returns false → this looks like a real product image
 */
export function isPromotionalImage(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (!lower.startsWith('http')) return true;

  // Block non-image file types
  if (lower.endsWith('.svg') || lower.endsWith('.gif')) return true;
  if (lower.includes('.html')) return true;

  // Block known promo/ad tokens
  if (PROMO_BLOCKED_TOKENS.some(t => lower.includes(t))) return true;

  // eBay non-gallery images (not from /d/, /g/, or /s-l paths)
  if (lower.includes('i.ebayimg.com') && !lower.includes('/d/') && !lower.includes('/g/') && !lower.includes('/s-l')) return true;

  // URL-embedded dimension checks (aspect ratio / tiny image detection)
  const sizeMatch = lower.match(/[\/_](\d+)x(\d+)/);
  if (sizeMatch) {
    const w = Number(sizeMatch[1]);
    const h = Number(sizeMatch[2]);
    // Tiny images (< 100x100) are tracking pixels or icons
    if (w < 100 && h < 100) return true;
    // Extreme aspect ratios indicate banners (> 2.5:1 or < 1:2.5)
    const ratio = w / Math.max(h, 1);
    if (ratio > 2.5 || ratio < 0.4) return true;
  }

  // Amazon tiny thumbnails
  const slMatch = lower.match(/_sl(\d+)[_.\-]/i);
  if (slMatch && parseInt(slMatch[1], 10) < 80) return true;

  // Filename-level promo pattern check
  const filename = lower.split('/').pop()?.split('?')[0] || '';
  if (PROMO_FILENAME_RE.some(pat => pat.test(filename))) return true;

  // Data URIs or base64 images (sometimes injected by ad systems)
  if (lower.startsWith('data:')) return true;

  return false;
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
    if (isPromotionalImage(u)) continue;
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
  // Upgrade first valid image to high-res
  const first = filtered[0];
  if (provider === 'ebay' || first.includes('ebayimg.com')) return upgradeEbayImage(first);
  if (provider === 'amazon' || provider === 'rainforest' || first.includes('amazon.com') || first.includes('media-amazon.com')) return upgradeAmazonImage(first);
  return first;
}

// ─── Image Resolution Upgrade ────────────────────────────────────────────────

/**
 * Upgrade eBay image URL to highest resolution (s-l1600)
 */
export function upgradeEbayImage(url: string | null): string | null {
  if (!url) return null;
  if (isPromotionalImage(url)) return null;
  return url.replace(/s-l\d+/gi, "s-l1600");
}

/**
 * Upgrade Amazon image URL to highest resolution
 * Handles all known Amazon size tokens: _SL###, _SX###, _SY###, _SS###, _AC_SL###, _AC_US###, _SR###,###
 */
export function upgradeAmazonImage(url: string | null): string | null {
  if (!url) return null;
  if (isPromotionalImage(url)) return null;

  // Already high-res
  if (url.includes("_SL1500") || url.includes("_SL1600")) return url;

  // Upgrade all Amazon size tokens
  let upgraded = url
    .replace(/_S[XYLR]\d{2,4}[._]/gi, (m) => `_SL1500${m.charAt(m.length - 1)}`)
    .replace(/_SS\d{2,3}[._]/gi, (m) => `_SL1500${m.charAt(m.length - 1)}`)
    .replace(/_AC_U[SYL]\d{2,4}/gi, "_AC_SL1500")
    .replace(/_AC_SL\d{2,4}/gi, "_AC_SL1500")
    .replace(/_SR\d+,\d+[._]/gi, (m) => `_SL1500${m.charAt(m.length - 1)}`);

  return upgraded;
}

/**
 * Upgrade image URL based on provider
 */
export function upgradeImageByProvider(url: string | null, provider: string): string | null {
  if (!url) return null;

  if (provider === "rainforest" || provider === "amazon") {
    return upgradeAmazonImage(url);
  } else if (provider === "ebay") {
    return upgradeEbayImage(url);
  }

  // For unknown providers, still check if promotional
  if (isPromotionalImage(url)) return null;
  return url;
}
