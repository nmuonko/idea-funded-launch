/**
 * Shared image validator for the frontend.
 *
 * Layers:
 * 1) URL / path / filename heuristics
 * 2) Gallery candidate extraction + fallback selection
 * 3) Runtime loaded-image dimension checks
 * 4) Async homepage preflight checks for curated feeds
 */

export type ImageValidationPolicy = 'default' | 'homepage';

type ImageCheckResult = {
  ok: boolean;
  reason: string;
  normalizedUrl?: string;
};

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

  // Amazon A+ / brand-content / marketing banners (NOT product photos)
  // Real Amazon product images live at /images/I/ — these paths are marketing only
  '/images/g/01/', '/images/g/02/',
  'aplusmedia', 'aplus-media', '/aplus/',
  'brandstore', 'brand-store', 'brand_store',
  'amazon-business', 'amazonbusiness',
  'amazon-renewed', 'amazonrenewed',
  'sharper-screen', 'sharper_screen',
  'pre-loved', 'preloved',
  'shop-top-categories', 'shop_top_categories',
  'ship-internationally', 'ship_internationally',
  'global-store', 'global_store',
  'amzl_', '/amzl/',
  'merchandised', 'merchandising',
  'category-tile', 'category_tile', 'categorytile',
  'lifestyle-shot', 'lifestyle_shot',
];

const HOMEPAGE_STRICT_TOKENS = [
  'shop-top-categories', 'shop_top_categories',
  'top-categories', 'top_categories',
  'promo-strip', 'promo_strip',
  'ad-strip', 'ad_strip',
  'shipping-strip', 'shipping_strip',
  'marketing-tile', 'marketing_tile',
  'category-promo', 'category_promo',
  'category-tile', 'category_tile',
  'hero-tile', 'hero_tile',
  'brand-tile', 'brand_tile',
  'gift-guide', 'gift_guide',
  'global-store', 'global_store',
  'ship-internationally', 'ship_internationally',
  'storefront-content', 'storefront_content',
  'promotional-content', 'promotional_content',
];

const HOMEPAGE_SUSPECT_FILENAME_WORDS = new Set([
  'ad', 'ads', 'banner', 'promo', 'promotion', 'shop', 'store', 'category', 'categories',
  'deal', 'deals', 'offer', 'offers', 'shipping', 'delivery', 'hero', 'brand', 'sponsored',
  'internationally', 'global', 'renewed', 'tile', 'tiles', 'marketing', 'campaign',
]);

const PRODUCT_IMAGE_FIELD_KEYS = [
  'imageUrl', 'image_url', 'mainImageUrl', 'image', 'url', 'src',
  'large', 'hiRes', 'hi_res', 'main', 'images', 'imageUrls', 'gallery', 'media',
];

const inspectedUrlCache = new Map<string, { ok: boolean; reason: string }>();
const inspectedUrlPromises = new Map<string, Promise<{ ok: boolean; reason: string }>>();

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

function evaluateImageUrl(url?: string | null, policy: ImageValidationPolicy = 'default'): ImageCheckResult {
  if (!url || typeof url !== 'string') return { ok: false, reason: 'missing-url' };

  const normalizedUrl = upgradeToHighRes(url);
  const lower = normalizedUrl.toLowerCase();

  if (!lower.startsWith('http')) return { ok: false, reason: 'non-http-url' };
  if (lower.includes('.html')) return { ok: false, reason: 'html-url' };
  if (lower.endsWith('.svg') || lower.endsWith('.gif')) return { ok: false, reason: 'unsupported-extension' };
  if (lower.startsWith('data:')) return { ok: false, reason: 'data-url' };

  if (BLOCKED_TOKENS.some(token => lower.includes(token))) {
    return { ok: false, reason: 'blocked-token' };
  }

  if (policy === 'homepage' && HOMEPAGE_STRICT_TOKENS.some(token => lower.includes(token))) {
    return { ok: false, reason: 'homepage-strict-token' };
  }

  if (
    lower.includes('media-amazon.com') ||
    lower.includes('images-amazon.com') ||
    lower.includes('ssl-images-amazon.com')
  ) {
    if (!lower.includes('/images/i/')) {
      return { ok: false, reason: 'amazon-non-product-path' };
    }
  }

  if (lower.includes('i.ebayimg.com') && !lower.includes('/d/') && !lower.includes('/g/') && !lower.includes('/s-l')) {
    return { ok: false, reason: 'ebay-non-product-path' };
  }

  const sizeMatch = lower.match(/[\/_](\d+)x(\d+)/);
  if (sizeMatch) {
    const w = Number(sizeMatch[1]);
    const h = Number(sizeMatch[2]);
    const shortEdge = Math.min(w, h);
    const ratio = w / Math.max(h, 1);

    if (shortEdge < 50) return { ok: false, reason: 'size-pattern-too-small' };
    if (policy === 'homepage') {
      if (ratio > 1.45 || ratio < 0.42) return { ok: false, reason: 'homepage-size-pattern-strip' };
      if (shortEdge < 110) return { ok: false, reason: 'homepage-size-pattern-too-small' };
    } else if (ratio > 1.8 || ratio < 0.45) {
      return { ok: false, reason: 'size-pattern-strip' };
    }
  }

  const filename = lower.split('/').pop()?.split('?')[0] || '';
  if (PROMO_FILENAME_PATTERNS.some(pat => pat.test(filename))) {
    return { ok: false, reason: 'promo-filename-pattern' };
  }

  if (policy === 'homepage') {
    const filenameWords = filename
      .replace(/\.(jpg|jpeg|png|webp)$/i, '')
      .split(/[^a-z0-9]+/i)
      .filter(Boolean);
    const suspiciousWordCount = filenameWords.filter(word => HOMEPAGE_SUSPECT_FILENAME_WORDS.has(word)).length;
    if (suspiciousWordCount >= 2) {
      return { ok: false, reason: 'homepage-suspect-filename' };
    }
  }

  return { ok: true, reason: 'ok', normalizedUrl };
}

function validateLoadedImageDimensions(
  naturalWidth: number,
  naturalHeight: number,
  policy: ImageValidationPolicy = 'default'
): { ok: boolean; reason: string } {
  if (naturalWidth <= 0 || naturalHeight <= 0) return { ok: false, reason: 'missing-dimensions' };

  const ratio = naturalWidth / Math.max(naturalHeight, 1);
  const shortEdge = Math.min(naturalWidth, naturalHeight);
  const longEdge = Math.max(naturalWidth, naturalHeight);

  if (policy === 'homepage') {
    if (shortEdge < 140) return { ok: false, reason: 'homepage-loaded-too-small' };
    if (ratio > 1.45 || ratio < 0.42) return { ok: false, reason: 'homepage-loaded-strip' };
    if (longEdge / Math.max(shortEdge, 1) > 1.65 && shortEdge < 220) {
      return { ok: false, reason: 'homepage-loaded-banner-layout' };
    }
    return { ok: true, reason: 'ok' };
  }

  if (shortEdge < 80) return { ok: false, reason: 'loaded-too-small' };
  if (ratio > 1.8 || ratio < 0.45) return { ok: false, reason: 'loaded-strip' };
  if (longEdge / Math.max(shortEdge, 1) > 2.1 && shortEdge < 160) {
    return { ok: false, reason: 'loaded-banner-layout' };
  }

  return { ok: true, reason: 'ok' };
}

function readPolicy(img: HTMLImageElement): ImageValidationPolicy {
  return img.dataset.imagePolicy === 'homepage' ? 'homepage' : 'default';
}

function debugImageDecision(debugKey: string | undefined, message: string, payload: Record<string, unknown>) {
  if (!debugKey) return;
  console.info(`[ImageValidation] ${message}`, { debugKey, ...payload });
}

function collectRawImageStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(entry => collectRawImageStrings(entry, seen));
  if (typeof value !== 'object') return [];
  if (seen.has(value as object)) return [];

  seen.add(value as object);
  const result: string[] = [];

  for (const key of PRODUCT_IMAGE_FIELD_KEYS) {
    const candidate = (value as Record<string, unknown>)[key];
    if (!candidate) continue;
    result.push(...collectRawImageStrings(candidate, seen));
  }

  return result;
}

export function isRenderableImageUrl(url?: string | null, policy: ImageValidationPolicy = 'default'): boolean {
  return evaluateImageUrl(url, policy).ok;
}

export function isStrictHomepageRenderableImageUrl(url?: string | null): boolean {
  return isRenderableImageUrl(url, 'homepage');
}

export function collectProductImageCandidates(...sources: unknown[]): string[] {
  const raw = sources.flatMap(source => collectRawImageStrings(source));
  return filterGalleryImages(raw);
}

export async function inspectImageCandidate(
  url: string,
  policy: ImageValidationPolicy = 'default'
): Promise<{ ok: boolean; reason: string }> {
  const checked = evaluateImageUrl(url, policy);
  if (!checked.ok || !checked.normalizedUrl) return { ok: false, reason: checked.reason };

  const cacheKey = `${policy}:${checked.normalizedUrl}`;
  const cached = inspectedUrlCache.get(cacheKey);
  if (cached) return cached;

  const inFlight = inspectedUrlPromises.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = new Promise<{ ok: boolean; reason: string }>((resolve) => {
    const img = new Image();
    let settled = false;
    const settle = (result: { ok: boolean; reason: string }) => {
      if (settled) return;
      settled = true;
      inspectedUrlCache.set(cacheKey, result);
      inspectedUrlPromises.delete(cacheKey);
      resolve(result);
    };

    const timer = window.setTimeout(() => settle({ ok: false, reason: 'image-load-timeout' }), 4500);

    img.onload = () => {
      window.clearTimeout(timer);
      settle(validateLoadedImageDimensions(img.naturalWidth, img.naturalHeight, policy));
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      settle({ ok: false, reason: 'image-load-error' });
    };
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = checked.normalizedUrl;
  });

  inspectedUrlPromises.set(cacheKey, promise);
  return promise;
}

export async function pickBestImageAsync(
  images: unknown[],
  currentUrl?: string | null,
  options?: { policy?: ImageValidationPolicy; debugKey?: string }
): Promise<string | null> {
  const policy = options?.policy ?? 'default';
  const candidates = collectProductImageCandidates(currentUrl, images);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const checked = evaluateImageUrl(candidate, policy);
    if (!checked.ok || !checked.normalizedUrl) {
      debugImageDecision(options?.debugKey, 'Rejected candidate before load', {
        candidate,
        reason: checked.reason,
        policy,
      });
      continue;
    }

    const inspected = await inspectImageCandidate(checked.normalizedUrl, policy);
    if (!inspected.ok) {
      debugImageDecision(options?.debugKey, 'Rejected candidate after load', {
        candidate: checked.normalizedUrl,
        reason: inspected.reason,
        policy,
      });
      continue;
    }

    debugImageDecision(options?.debugKey, index === 0 ? 'Accepted primary candidate' : 'Accepted fallback candidate', {
      selectedImage: checked.normalizedUrl,
      fallbackIndex: index,
      policy,
    });
    return checked.normalizedUrl;
  }

  debugImageDecision(options?.debugKey, 'No valid product image candidates remain', { policy });
  return null;
}

export function clearImageValidationCaches(): void {
  inspectedUrlCache.clear();
  inspectedUrlPromises.clear();
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
export function pickBestImage(
  images: unknown[],
  currentUrl?: string | null,
  options?: { policy?: ImageValidationPolicy }
): string {
  const policy = options?.policy ?? 'default';
  const candidates = collectProductImageCandidates(currentUrl, images);

  for (const url of candidates) {
    const checked = evaluateImageUrl(url, policy);
    if (checked.ok && checked.normalizedUrl) return checked.normalizedUrl;
  }
  return '/placeholder.svg';
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
  const policy = readPolicy(img);
  // Try fallback images stored in data attribute
  const fallbacks = img.dataset.fallbackImages?.split('|||').filter(Boolean) || [];
  for (const url of fallbacks) {
    const checked = evaluateImageUrl(url, policy);
    if (checked.ok && checked.normalizedUrl && checked.normalizedUrl !== img.src) {
      img.src = checked.normalizedUrl;
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
  const policy = readPolicy(img);
  const { naturalWidth, naturalHeight } = img;
  const result = validateLoadedImageDimensions(naturalWidth, naturalHeight, policy);
  if (!result.ok) {
    handleImageError(e);
  }
}
