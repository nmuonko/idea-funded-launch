const AMAZON_ASIN_PATTERN = /(?:\/dp\/|\/gp\/(?:product|aw\/d)\/|\/product\/)([A-Z0-9]{10})/i;
const AMAZON_HOST_PATTERN = /^https?:\/\/([^/]*amazon\.[^/]+)\//i;
const AMAZON_HOME_PATTERN = /^https?:\/\/(?:www\.)?amazon\.[^/]+\/?$/i;
const BARE_ASIN_PATTERN = /^[A-Z0-9]{10}$/i;
const PREFIXED_ASIN_PATTERN = /^(?:amazon|rainforest)_([A-Z0-9]{10})$/i;

/**
 * Extract an ASIN from any input: raw URL, plain ASIN, or prefixed ID.
 */
function extractAsin(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Plain ASIN
  if (BARE_ASIN_PATTERN.test(trimmed)) return trimmed.toUpperCase();

  // Prefixed ID like amazon_B0BYLM8RRW
  const prefixMatch = trimmed.match(PREFIXED_ASIN_PATTERN);
  if (prefixMatch?.[1]) return prefixMatch[1].toUpperCase();

  // URL containing /dp/ASIN or /gp/product/ASIN
  const urlMatch = trimmed.match(AMAZON_ASIN_PATTERN);
  if (urlMatch?.[1]) return urlMatch[1].toUpperCase();

  return null;
}

/**
 * Normalize any Amazon-related input into a canonical PDP URL.
 * Accepts: raw URLs, plain ASINs, prefixed IDs (amazon_B0..., rainforest_B0...).
 * Always returns https://www.amazon.com/dp/{ASIN} or null.
 */
export function normalizeAmazonProductUrl(input?: string | null): string | null {
  const asin = extractAsin(input);
  if (!asin) return null;
  return `https://www.amazon.com/dp/${asin}`;
}

/**
 * Build an Amazon PDP URL from multiple possible sources.
 * Tries productId first, then productUrl.
 * Returns canonical URL or null.
 */
export function buildAmazonProductDetailUrl({
  productId,
  productUrl,
}: {
  productId?: string | null;
  productUrl?: string | null;
}): string | null {
  // Try productId first (may be ASIN or prefixed)
  const fromId = normalizeAmazonProductUrl(productId);
  if (fromId) return fromId;

  // Try productUrl
  const fromUrl = normalizeAmazonProductUrl(productUrl);
  if (fromUrl) return fromUrl;

  return null;
}
