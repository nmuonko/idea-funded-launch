/**
 * Shared image URL validator for the frontend.
 * Blocks ad banners, seller logos, promotional graphics, and non-product images.
 */

const BLOCKED_TOKENS = [
  'vital_health', 'vitalhealthy', 'vital healthy', 'lovegrown', 'love-grown', 'love_grown',
  'sellerbanner', 'seller_banner', 'seller-banner',
  'shoplogo', 'shop_logo', 'shop-logo',
  'storelogo', 'store_logo', 'store-logo',
  'brandlogo', 'brand_logo', 'brand-logo',
  'watermark', 'promo_badge', 'promo-badge', 'promotion-badge',
  'promobanner', 'promo_banner', 'promo-banner',
  'header_banner', 'footer_banner', 'hero_banner',
  'template_banner', 'storefront_banner', 'ad_banner',
  'sprite', 'icon_only',
  'no-image-placeholder',
  '/v4/p/ccc/',
  'images3_pi/2024/01/01/00/',
  'site-cars/merchandising', 'heliosconditionaltiles',
  '/banner', '_thumbnail_126x',
  'assets.fastly.carvana.io/merchui/images',
  'pt.ispot.tv',
  // eBay description-area / seller template images
  'descriptionimage', 'seller_pic', 'seller-pic',
  '/00/s/', 'vistaprint', 'ebay.com/usr/',
  // Amazon badges & renewed labels
  'certified-renewed', 'certified_renewed', 'amazon-renewed',
  'a]badge', 'satisfaction-guarantee', 'satisfaction_guarantee',
  // Generic promo / marketing tokens
  'free-shipping', 'free_shipping', 'best-seller', 'best_seller',
  'warranty-badge', 'warranty_badge', 'money-back', 'money_back',
  'trust-badge', 'trust_badge', 'guarantee-badge',
  // SHEIN promo paths, swatches & known placeholder
  'ltwebstatic.com/she_dist/', 'ltwebstatic.com/images/bg/',
  'images3_ccc/', // SHEIN color swatch images
  '1585556531965e5d98ef5a432eab61147c16af31c6', // SHEIN category placeholder
  // Filename-level markers (not domain)
  '-logo.', '_logo.', '-badge.', '_badge.', '-stamp.', '_stamp.',
  '-icon.', '_icon.',
  // Additional promotional / marketing patterns
  'landing-page', 'landing_page', 'landingpage',
  'marketing/', 'campaign/', 'promotional/',
  'coupon', 'discount-badge', 'discount_badge',
  'sale-badge', 'sale_badge', 'deal-badge',
  'storefront/', 'store-front/',
  'brand-page', 'brand_page',
  'lifestyle-banner', 'lifestyle_banner',
  '/ads/', '/advertisement/',
  'comparison-chart', 'comparison_chart',
  'infographic', 'info-graphic',
  // Category / navigation / misc non-product
  'category-banner', 'category_banner', 'nav-banner', 'nav_banner',
  'announcement-bar', 'announcement_bar',
  'gift-card', 'gift_card', 'giftcard',
  'email-banner', 'email_banner',
  'social-share', 'social_share', 'share-icon',
  'review-badge', 'review_badge',
  'top-rated', 'top_rated',
  'best-price', 'best_price',
  'price-drop', 'price_drop',
  'new-arrival', 'new_arrival',
  'trending-badge', 'trending_badge',
  'flash-sale', 'flash_sale',
  '/swatch', '/color-swatch', '/color_swatch',
];

/** Filename patterns that strongly indicate non-product promotional content */
const PROMO_FILENAME_PATTERNS = [
  /^banner/i,
  /^promo/i,
  /^hero[-_]/i,
  /^ad[-_]/i,
  /lovegrown/i,
  /^shop[-_]now/i,
  /^buy[-_]now/i,
  /\bcta\b/i,
  /^sale[-_]/i,
];

/**
 * Check if an image URL is a valid, renderable product image.
 * Returns false for banners, logos, promos, SVGs, GIFs, tiny images, etc.
 */
export function isRenderableImageUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();

  if (!lower.startsWith('http')) return false;
  if (lower.includes('.html')) return false;
  if (lower.endsWith('.svg') || lower.endsWith('.gif')) return false;

  // Block known bad substrings
  if (BLOCKED_TOKENS.some(token => lower.includes(token))) return false;
  if (lower.includes('promotion') && (lower.includes('badge') || lower.includes('banner'))) return false;

  // Block eBay seller template/promo images (non-product photos)
  if (lower.includes('i.ebayimg.com') && (
    !lower.includes('/d/') && !lower.includes('/g/') && !lower.includes('/s-l')
  )) return false;

  // Block suspicious aspect ratio hints from URL dimensions
  const sizeMatch = lower.match(/[\/_](\d+)x(\d+)/);
  if (sizeMatch) {
    const w = Number(sizeMatch[1]);
    const h = Number(sizeMatch[2]);
    if (w < 100 && h < 100) return false;
    const ratio = w / Math.max(h, 1);
    if (ratio > 2.2 || ratio < 0.45) return false;
  }

  // Block Amazon tiny thumbnails (e.g. _SL75_, _SL50_)
  const amazonSlMatch = lower.match(/_sl(\d+)[_.\-]/i);
  if (amazonSlMatch && parseInt(amazonSlMatch[1], 10) < 80) return false;

  // Check filename for promotional patterns
  const filename = lower.split('/').pop()?.split('?')[0] || '';
  if (PROMO_FILENAME_PATTERNS.some(pat => pat.test(filename))) return false;

  return true;
}

/**
 * Filter an array of image URLs to only valid product images.
 * Returns at least the first valid image, or empty array if none are valid.
 */
export function filterGalleryImages(images: string[]): string[] {
  if (!images || !Array.isArray(images)) return [];
  const filtered = images
    .map(url => upgradeToHighRes(url))
    .filter(url => isRenderableImageUrl(url));
  // Deduplicate by normalized URL
  const seen = new Set<string>();
  return filtered.filter(url => {
    const key = url.toLowerCase().replace(/\?.*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Upgrade known provider image URLs to their highest available resolution.
 * eBay: s-l### → s-l1600
 * Amazon: _SL### → _SL1500, _AC_SL### → _AC_SL1500
 * SHEIN: strip _thumbnail_NNNxNNN
 */
function upgradeToHighRes(url: string): string {
  if (!url || typeof url !== 'string') return url;
  // eBay
  if (url.includes('ebayimg.com')) {
    return url.replace(/s-l\d+/gi, 's-l1600');
  }
  // Amazon
  if (url.includes('media-amazon.com') || url.includes('images-amazon.com')) {
    return url
      .replace(/_SL\d{2,4}/gi, '_SL1500')
      .replace(/_SX\d{2,4}/gi, '_SX1500')
      .replace(/_SY\d{2,4}/gi, '_SY1500')
      .replace(/_AC_SL\d{2,4}/gi, '_AC_SL1500');
  }
  // SHEIN
  if (url.includes('ltwebstatic.com') && /_thumbnail_\d+x\d+/i.test(url)) {
    return url.replace(/_thumbnail_\d+x\d+/i, '');
  }
  return url;
}
