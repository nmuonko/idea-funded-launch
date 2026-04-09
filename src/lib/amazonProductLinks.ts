const AMAZON_ASIN_PATTERN = /(?:\/dp\/|\/gp\/(?:product|aw\/d)\/|\/product\/)([A-Z0-9]{10})/i;
const AMAZON_HOST_PATTERN = /^https?:\/\/([^/]*amazon\.[^/]+)\//i;
const AMAZON_HOME_PATTERN = /^https?:\/\/(?:www\.)?amazon\.[^/]+\/?$/i;

function stripQueryAndHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeAmazonHost(url?: string | null): string {
  if (!url) return 'www.amazon.com';

  const hostMatch = url.match(AMAZON_HOST_PATTERN);
  if (hostMatch?.[1]) {
    return hostMatch[1].toLowerCase();
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().includes('amazon.')) {
      return parsed.hostname.toLowerCase();
    }
  } catch {
    // Ignore malformed URLs and fall back to amazon.com
  }

  return 'www.amazon.com';
}

function isAmazonProductDetailUrl(url?: string | null): boolean {
  if (!url) return false;
  if (AMAZON_HOME_PATTERN.test(url)) return false;
  return AMAZON_ASIN_PATTERN.test(url);
}

function extractAmazonAsin(productUrl?: string | null, productId?: string | null): string | null {
  const cleanProductId = productId?.trim().toUpperCase() || '';
  if (/^[A-Z0-9]{10}$/.test(cleanProductId)) {
    return cleanProductId;
  }

  const match = productUrl?.match(AMAZON_ASIN_PATTERN);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }

  return null;
}

export function buildAmazonProductDetailUrl({
  productId,
  productUrl,
}: {
  productId?: string | null;
  productUrl?: string | null;
}): string | null {
  const asin = extractAmazonAsin(productUrl, productId);
  if (!asin) {
    return productUrl && isAmazonProductDetailUrl(productUrl)
      ? stripQueryAndHash(productUrl)
      : productUrl || null;
  }

  const host = normalizeAmazonHost(productUrl);
  return `https://${host}/-/dp/${asin}`;
}