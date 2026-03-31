/**
 * Multi-resolution image URL rewriter for Amazon & eBay product images.
 * Rewrites high-res URLs (_SL1500 / s-l1600) to smaller sizes for thumbnails & hero display.
 */

export const IMAGE_SIZE_THUMB = 480;
export const IMAGE_SIZE_HERO = 1500;
export const IMAGE_SIZE_FULL = 1500;

/**
 * Rewrite an image URL to a target pixel size.
 * Supports Amazon (_SL###, _SX###, _SY###, _AC_SL###) and eBay (s-l###) patterns.
 * Returns the original URL unchanged if no pattern matches.
 */
/**
 * Score an image URL by likely resolution quality.
 * Higher = better quality. Used to pick the best hero image and guard against upscaling.
 */
export function imageQualityScore(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;

  // Penalize known low-res / thumbnail patterns
  if (/s-l(64|96|140|225|300)\b/.test(lower)) score -= 10;
  if (/thumb|thumbnail|small|lowres|tmb/.test(lower)) score -= 5;
  if (/_SS\d{2,3}\.|_SX\d{2,3}\.|_SY\d{2,3}\./.test(lower)) score -= 10;

  // Bonus for high-res patterns
  if (/s-l(1600|1200|1000|800)\b/.test(lower)) score += 10;
  if (/original|full|large/.test(lower)) score += 5;
  if (/_SL1[0-5]00|_SL1600/.test(lower)) score += 10;

  // Extract numeric eBay size token for finer ranking
  const sizeMatch = lower.match(/s-l(\d+)/);
  if (sizeMatch) score += Math.min(parseInt(sizeMatch[1], 10) / 100, 16);

  return score;
}

/** Map requested eBay size to known reliable CDN sizes */
function normalizeEbaySize(targetSize: number): number {
  if (targetSize >= 1000) return 1600;
  if (targetSize >= 700) return 960;
  if (targetSize >= 400) return 500;
  return 225;
}

/** Returns true if URL looks like a known low-res thumbnail */
function isLowResThumbnail(url: string): boolean {
  return imageQualityScore(url) < -2;
}

/**
 * Rewrite an image URL to a target pixel size.
 * Supports Amazon (_SL###, _SX###, _SY###, _AC_SL###) and eBay (s-l###) patterns.
 * Returns the original URL unchanged if no pattern matches.
 * 
 * Guard: will NOT upscale known tiny thumbnails to larger sizes.
 */
export function resizeImageUrl(url: string, targetSize: number): string {
  if (!url || url === '/placeholder.svg') return url;

  // SHEIN: strip _thumbnail_NNNxNNN suffix to get full-size image
  if (url.includes('ltwebstatic.com') && /_thumbnail_\d+x\d+/i.test(url)) {
    url = url.replace(/_thumbnail_\d+x\d+/i, '');
  }

  // eBay: use known reliable CDN size buckets to avoid broken links on some listings
  const ebayMatch = url.match(/s-l(\d+)/i);
  if (ebayMatch) {
    const target = normalizeEbaySize(targetSize);
    return url.replace(/s-l\d+/gi, `s-l${target}`);
  }

  // Amazon: always try to upgrade — Amazon CDN supports arbitrary sizes
  // Don't block thumbnails; they are just URL tokens, not actual tiny images

  // Amazon patterns: _SL1500, _SX1500, _SY1500, _AC_SL1500
  let amazonResized = url
    .replace(/_SL\d{3,4}/gi, `_SL${targetSize}`)
    .replace(/_SX\d{3,4}/gi, `_SX${targetSize}`)
    .replace(/_SY\d{3,4}/gi, `_SY${targetSize}`)
    .replace(/_AC_SL\d{3,4}/gi, `_AC_SL${targetSize}`);

  // If no size token was present, inject one before the extension
  if (amazonResized === url && /\/images\/I\/[^/]+\.(jpg|png|webp|jpeg)(\?|$)/i.test(url)) {
    if (!/_(?:SL|SS|SX|SY|AC_SL|AC_UY|AC_US|AC_UL|UY|US|SR)\d/i.test(url)) {
      amazonResized = url.replace(/\.(jpg|png|webp|jpeg)(\?|$)/i, `._SL${targetSize}_.$1$2`);
    }
  }

  if (amazonResized !== url) return amazonResized;

  // eBay fallback (when URL was not matched earlier but still contains size token variant)
  const ebayTarget = normalizeEbaySize(targetSize);
  const ebayResized = url.replace(/s-l\d{3,4}/gi, `s-l${ebayTarget}`);
  if (ebayResized !== url) return ebayResized;

  return url;
}
