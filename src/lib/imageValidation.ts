/**
 * Shared image URL validator for the frontend.
 * Blocks ad banners, seller logos, promotional graphics, and non-product images.
 * 
 * This is the FRONTEND FALLBACK GUARD — the backend should filter first,
 * but this catches anything that slips through.
 */

const BLOCKED_TOKENS = [
  // Seller branding
  'lovegrown', 'love-grown', 'love_grown',
  'vital_health', 'vitalhealthy', 'vital healthy',
  'sellerbanner', 'seller_banner', 'seller-banner',
  'shoplogo', 'shop_logo', 'shop-logo',
  'storelogo', 'store_logo', 'store-logo',
  'brandlogo', 'brand_logo', 'brand-logo',
  'watermark',

  // Promo badges & banners
  'promo_badge', 'promo-badge', 'promotion-badge',
  'promobanner', 'promo_banner', 'promo-banner',
  'header_banner', 'footer_banner', 'hero_banner',
  'template_banner', 'storefront_banner', 'ad_banner',
  'category-banner', 'category_banner',
  'announcement-bar', 'announcement_bar',
  'email-banner', 'email_banner',
  'nav-banner', 'nav_banner',
  'lifestyle-banner', 'lifestyle_banner',

  // Generic non-product
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
  'asurion', 'protection-plan', 'protection_plan',
  'trust-badge', 'trust_badge', 'guarantee-badge',

  // SHEIN promo paths
  'ltwebstatic.com/she_dist/', 'ltwebstatic.com/images/bg/',
  '/v4/p/ccc/', 'images3_ccc/',
  '1585556531965e5d98ef5a432eab61147c16af31c6',
  'site_failover',

  // Carvana merchandising
  'assets.fastly.carvana.io/merchui/images',
  'site-cars/merchandising', 'heliosconditionaltiles',

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

  // Ad tracking / ad system images (NOT product photos)
  'amazon-adsystem.com', 'aax-us-east', 'aax-us-west',
  'fls-na.amazon.com', 'fls-eu.amazon.com',
  'ir-na.amazon-adsystem.com', 'ir-uk.amazon-adsystem.com',
  'assoc-amazon.com', 'rcm-na.amazon-adsystem.com',
  '/e/is/', '/impb?', 'ad-spec-', 'ad_spec_',
  'serving-sys.com', 'doubleclick.net', 'googlesyndication',
  'googleadservices', 'adsserver', 'adnxs.com',

  // eBay ad/tracking
  'rover.ebay.com', 'srp.ebay.com',

  // Generic ad network / tracking
  'pixel.', 'tracking.', 'beacon.',
  '1x1.', 'spacer.gif', 'blank.gif',

  // Shop Now / CTA overlays
  'shop-now', 'shop_now', 'shopnow',
  'buy-now', 'buy_now', 'buynow',
  'order-now', 'order_now',
  'add-to-cart', 'add_to_cart',
  'limited-time', 'limited_time',
  'sponsored-', 'sponsored_', '/sponsored',

  // Amazon video play-button overlays (not product photos)
  'pkmb-play-button-overlay',
  'play-button-overlay',
  'play_button_overlay',
];

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
 * Check if an image URL is a valid, renderable product image.
 * Returns false for banners, logos, promos, SVGs, GIFs, tiny images, etc.
 */
export function isRenderableImageUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();

  if (!lower.startsWith('http')) return false;
  if (lower.includes('.html')) return false;
  if (lower.endsWith('.svg') || lower.endsWith('.gif')) return false;
  if (lower.startsWith('data:')) return false;

  // Block known bad substrings
  if (BLOCKED_TOKENS.some(token => lower.includes(token))) return false;

  // Block eBay seller template/promo images
  if (lower.includes('i.ebayimg.com') && (
    !lower.includes('/d/') && !lower.includes('/g/') && !lower.includes('/s-l')
  )) return false;

  // Check WxH dimension patterns (NOT provider thumbnail tokens which are upgradeable)
  const sizeMatch = lower.match(/[\/_](\d+)x(\d+)/);
  if (sizeMatch) {
    const w = Number(sizeMatch[1]);
    const h = Number(sizeMatch[2]);
    if (w < 50 && h < 50) return false;
    const ratio = w / Math.max(h, 1);
    if (ratio > 2.5 || ratio < 0.4) return false;
  }

  // Check filename for promotional patterns
  const filename = lower.split('/').pop()?.split('?')[0] || '';
  if (PROMO_FILENAME_PATTERNS.some(pat => pat.test(filename))) return false;

  return true;
}

/**
 * Filter an array of image URLs to only valid product images.
 * Deduplicates by normalized URL.
 */
/**
 * Extract the base Amazon image ID for deduplication.
 * e.g. "41msggSuaoL._SL75_.jpg" and "41msggSuaoL.jpg" → "41msggsuaol"
 */
function amazonImageBaseId(url: string): string | null {
  const m = url.match(/\/images\/I\/([A-Za-z0-9+_-]+?)(?:\._[^/]*)?\.(?:jpg|png|webp|jpeg)/i);
  return m ? m[1].toLowerCase() : null;
}

export function filterGalleryImages(images: string[]): string[] {
  if (!images || !Array.isArray(images)) return [];
  const filtered = images
    .map(url => upgradeToHighRes(url))
    .filter(url => isRenderableImageUrl(url));
  // Deduplicate by normalized URL + Amazon base image ID
  const seen = new Set<string>();
  const seenAmazonBase = new Set<string>();
  return filtered.filter(url => {
    const key = url.toLowerCase().replace(/\?.*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    // Amazon dedup: same base image ID at different sizes → keep first
    if (url.includes('media-amazon.com') || url.includes('images-amazon.com')) {
      const baseId = amazonImageBaseId(url);
      if (baseId) {
        if (seenAmazonBase.has(baseId)) return false;
        seenAmazonBase.add(baseId);
      }
    }
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
  // Amazon: upgrade ALL thumbnail tokens to high-res
  if (url.includes('media-amazon.com') || url.includes('images-amazon.com') || url.includes('ssl-images-amazon.com')) {
    let upgraded = url
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
    // If no size token was present at all, inject one before the extension
    if (upgraded === url && /\/images\/I\/[^/]+\.(jpg|png|webp|jpeg)(\?|$)/i.test(upgraded)) {
      if (!/_(?:SL|SS|SX|SY|AC_SL|AC_UY|AC_US|AC_UL|UY|US|SR)\d/i.test(upgraded)) {
        upgraded = upgraded.replace(/\.(jpg|png|webp|jpeg)(\?|$)/i, '._SL1500_.$1$2');
      }
    }
    return upgraded;
  }
  // SHEIN
  if (url.includes('ltwebstatic.com') && /_thumbnail_\d+x\d+/i.test(url)) {
    return url.replace(/_thumbnail_\d+x\d+/i, '');
  }
  return url;
}

/**
 * Pick the best valid product image from a list.
 * Returns the first renderable image URL, or '/placeholder.svg' if none valid.
 */
export function pickBestImage(images: string[], currentUrl?: string): string {
  // If current URL is valid, keep it
  if (currentUrl && isRenderableImageUrl(currentUrl)) return currentUrl;
  // Try each image in the list
  for (const url of (images || [])) {
    if (isRenderableImageUrl(url)) return upgradeToHighRes(url);
  }
  return '/placeholder.svg';
}

/**
 * Score an image URL for "studio cleanliness" — higher = more catalog-like.
 * Used to surface clean white-background hero shots over busy lifestyle photos.
 */
function cleanImageScore(url: string): number {
  if (!url) return -1;
  const u = url.toLowerCase();
  let s = 0;
  // Amazon main hero shots typically use _AC_ tokens with white backgrounds.
  if (u.includes('media-amazon.com') || u.includes('images-amazon.com') || u.includes('ssl-images-amazon.com')) {
    s += 5;
    if (/_ac_(sl|sx|sy|ul|us)/i.test(u)) s += 3;
    if (/_sl1500|_ac_sl1500/i.test(u)) s += 1;
  }
  // eBay high-res s-l1600 is the studio version.
  if (u.includes('ebayimg.com')) {
    s += 3;
    if (/s-l1600/i.test(u)) s += 2;
  }
  // Penalize obvious lifestyle/secondary tokens.
  if (/lifestyle|hand|model|wearing|in[-_]use|installed/.test(u)) s -= 4;
  if (/_pt\d|_v1_/i.test(u)) s -= 2;
  return s;
}

/**
 * Pick the cleanest, most catalog-like image from a list.
 * Falls back to pickBestImage logic when no clear winner exists.
 */
export function pickCleanestImage(images: string[], currentUrl?: string): string {
  const valid = (images || []).filter(isRenderableImageUrl);
  if (currentUrl && isRenderableImageUrl(currentUrl)) valid.unshift(currentUrl);
  if (valid.length === 0) return '/placeholder.svg';
  let best = valid[0];
  let bestScore = cleanImageScore(best);
  for (let i = 1; i < valid.length; i++) {
    const sc = cleanImageScore(valid[i]);
    if (sc > bestScore) { best = valid[i]; bestScore = sc; }
  }
  return upgradeToHighRes(best);
}

/**
 * Returns the URL if it's a valid product image, otherwise returns fallback.
 * Use in cart/checkout to block ad banners inline.
 */
export function sanitizeCartImage(url: string | null | undefined, fallback = '/placeholder.svg'): string {
  return isRenderableImageUrl(url) ? url! : fallback;
}

/**
 * Runtime image load error handler for <img> elements.
 * Tries next valid image from data-fallback-images before placeholder.
 */
export function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src === '/placeholder.svg') return;
  // Try fallback images stored in data attribute
  const fallbacks = img.dataset.fallbackImages?.split('|||').filter(Boolean) || [];
  for (const url of fallbacks) {
    if (isRenderableImageUrl(url) && url !== img.src) {
      img.src = upgradeToHighRes(url);
      // Remove this URL from fallbacks so we don't retry
      img.dataset.fallbackImages = fallbacks.filter(u => u !== url).join('|||');
      return;
    }
  }
  img.src = '/placeholder.svg';
}

/**
 * Runtime check after image loads — detect banner-like images by aspect ratio.
 * If detected, tries next fallback image before placeholder.
 */
export function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src === '/placeholder.svg') return;
  const { naturalWidth, naturalHeight } = img;
  if (naturalWidth > 0 && naturalHeight > 0) {
    const ratio = naturalWidth / naturalHeight;
    if (ratio > 3 || ratio < 0.33 || (naturalWidth < 50 && naturalHeight < 50)) {
      // Trigger error handler which tries next fallback
      handleImageError(e);
    }
  }
}
