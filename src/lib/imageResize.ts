/**
 * Multi-resolution image URL rewriter for Amazon & eBay product images.
 * Rewrites high-res URLs (_SL1500 / s-l1600) to smaller sizes for thumbnails & hero display.
 */

export const IMAGE_SIZE_THUMB = 300;
export const IMAGE_SIZE_HERO = 800;
export const IMAGE_SIZE_FULL = 1500;

/**
 * Rewrite an image URL to a target pixel size.
 * Supports Amazon (_SL###, _SX###, _SY###, _AC_SL###) and eBay (s-l###) patterns.
 * Returns the original URL unchanged if no pattern matches.
 */
export function resizeImageUrl(url: string, targetSize: number): string {
  if (!url || url === '/placeholder.svg') return url;

  // Amazon patterns: _SL1500, _SX1500, _SY1500, _AC_SL1500
  const amazonResized = url
    .replace(/_SL\d{3,4}/gi, `_SL${targetSize}`)
    .replace(/_SX\d{3,4}/gi, `_SX${targetSize}`)
    .replace(/_SY\d{3,4}/gi, `_SY${targetSize}`)
    .replace(/_AC_SL\d{3,4}/gi, `_AC_SL${targetSize}`);

  if (amazonResized !== url) return amazonResized;

  // eBay pattern: s-l1600, s-l1200, etc.
  const ebayResized = url.replace(/s-l\d{3,4}/gi, `s-l${targetSize}`);
  if (ebayResized !== url) return ebayResized;

  return url;
}
