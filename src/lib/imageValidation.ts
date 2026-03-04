/**
 * Shared image URL validator for the frontend.
 * Blocks ad banners, seller logos, promotional graphics, and non-product images.
 */

const BLOCKED_TOKENS = [
  'vital_health', 'vitalhealthy', 'vital healthy',
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

  return true;
}
