/**
 * Image URL Upgrade Module
 * 
 * Utility functions to upgrade image URLs to higher resolution versions
 * and filter out promotional/banner images at the backend level.
 */

// ─── Promotional Image Detection ─────────────────────────────────────────────

const PROMO_BLOCKED_TOKENS = [
  'lovegrown', 'love-grown', 'love_grown',
  'vital_health', 'vitalhealthy',
  'sellerbanner', 'seller_banner', 'seller-banner',
  'shoplogo', 'shop_logo', 'shop-logo', 'store_logo', 'store-logo', 'storelogo',
  'brandlogo', 'brand_logo', 'brand-logo',
  'watermark', 'promo_badge', 'promo-badge', 'promotion-badge',
  'promobanner', 'promo_banner', 'promo-banner',
  'header_banner', 'footer_banner', 'hero_banner', 'ad_banner',
  'template_banner', 'storefront_banner', 'sprite', 'icon_only',
  'no-image-placeholder', '/banner', '_thumbnail_126x',
  'descriptionimage', 'seller_pic', 'seller-pic',
  '/00/s/', 'vistaprint', 'ebay.com/usr/',
  'certified-renewed', 'certified_renewed', 'amazon-renewed',
  'satisfaction-guarantee', 'satisfaction_guarantee',
  'free-shipping', 'free_shipping', 'best-seller', 'best_seller',
  'warranty-badge', 'warranty_badge', 'money-back', 'money_back',
  'trust-badge', 'trust_badge', 'guarantee-badge',
  '-logo.', '_logo.', '-badge.', '_badge.', '-stamp.', '_stamp.',
  '-icon.', '_icon.', 'landing-page', 'landing_page', 'landingpage',
  'marketing/', 'campaign/', 'promotional/', 'coupon',
  'discount-badge', 'discount_badge', 'sale-badge', 'sale_badge', 'deal-badge',
  'storefront/', 'store-front/', 'brand-page', 'brand_page',
  'lifestyle-banner', 'lifestyle_banner',
  '/ads/', '/advertisement/', 'comparison-chart', 'comparison_chart',
  'infographic', 'info-graphic',
  '/v4/p/ccc/', 'images3_ccc/', 'ltwebstatic.com/she_dist/',
  'ltwebstatic.com/images/bg/', 'pt.ispot.tv',
  'images3_pi/2024/01/01/00/',
  'assets.fastly.carvana.io/merchui/images',
  'site-cars/merchandising', 'heliosconditionaltiles',
  'category-banner', 'category_banner',
  'announcement-bar', 'announcement_bar',
  'email-banner', 'email_banner',
  'flash-sale', 'flash_sale',
  '/swatch', '/color-swatch', '/color_swatch',
  'nav-banner', 'nav_banner',
  'gift-card', 'gift_card', 'giftcard',
  'social-share', 'social_share', 'share-icon',
  'review-badge', 'review_badge',
  'top-rated', 'top_rated',
  'best-price', 'best_price',
  'price-drop', 'price_drop',
  'new-arrival', 'new_arrival',
  'trending-badge', 'trending_badge',
];

/**
 * Check if a URL is a promotional/banner/non-product image.
 * Used to filter images at the backend before they reach clients.
 */
export function isPromotionalImage(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (!lower.startsWith('http')) return true;
  if (lower.endsWith('.svg') || lower.endsWith('.gif')) return true;
  if (lower.includes('.html')) return true;

  if (PROMO_BLOCKED_TOKENS.some(t => lower.includes(t))) return true;

  // eBay non-gallery images (not from /d/, /g/, or /s-l paths)
  if (lower.includes('i.ebayimg.com') && !lower.includes('/d/') && !lower.includes('/g/') && !lower.includes('/s-l')) return true;

  // Aspect ratio from URL dimensions
  const sizeMatch = lower.match(/[\/_](\d+)x(\d+)/);
  if (sizeMatch) {
    const w = Number(sizeMatch[1]);
    const h = Number(sizeMatch[2]);
    if (w < 100 && h < 100) return true;
    const ratio = w / Math.max(h, 1);
    if (ratio > 2.2 || ratio < 0.45) return true;
  }

  // Amazon tiny thumbnails
  const slMatch = lower.match(/_sl(\d+)[_.\-]/i);
  if (slMatch && parseInt(slMatch[1], 10) < 80) return true;

  return false;
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

  // Upgrade all Amazon size tokens (match with trailing dot, underscore, or end-of-string)
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
