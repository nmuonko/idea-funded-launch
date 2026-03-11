export interface AdminOrderProductLinkItem {
  store?: string | null;
  product_url?: string | null;
  canonical_url?: string | null;
  provider_product_id?: string | null;
}

const AMAZON_ASIN_PATTERN = /(?:\/dp\/|\/gp\/(?:product|aw\/d)\/|\/product\/)([A-Z0-9]{10})/i;
const AMAZON_HOST_PATTERN = /^https?:\/\/([^/]*amazon\.[^/]+)\//i;
const AMAZON_HOME_PATTERN = /^https?:\/\/(?:www\.)?amazon\.[^/]+\/?$/i;

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
    // ignore malformed URLs and fall back
  }

  return 'www.amazon.com';
}

function isAmazonProductDetailUrl(url?: string | null): boolean {
  if (!url) return false;
  if (AMAZON_HOME_PATTERN.test(url)) return false;
  return AMAZON_ASIN_PATTERN.test(url);
}

export function extractAmazonAsinFromOrderItem(item: AdminOrderProductLinkItem): string | null {
  const fromProviderId = item.provider_product_id?.trim().toUpperCase() || '';
  if (/^[A-Z0-9]{10}$/.test(fromProviderId)) {
    return fromProviderId;
  }

  for (const value of [item.product_url, item.canonical_url]) {
    const match = value?.match(AMAZON_ASIN_PATTERN);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

export function buildAmazonCanonicalOrderUrl(item: AdminOrderProductLinkItem): string | null {
  const asin = extractAmazonAsinFromOrderItem(item);
  if (!asin) return null;

  if (isAmazonProductDetailUrl(item.product_url)) {
    return item.product_url!;
  }

  if (isAmazonProductDetailUrl(item.canonical_url)) {
    return item.canonical_url!;
  }

  const host = normalizeAmazonHost(item.product_url || item.canonical_url);
  return `https://${host}/dp/${asin}`;
}

export function getAdminOrderProductLink(item: AdminOrderProductLinkItem): string | null {
  const store = item.store?.toUpperCase();

  if (store === 'AMAZON') {
    return buildAmazonCanonicalOrderUrl(item);
  }

  const candidate = item.canonical_url || item.product_url || null;
  if (!candidate) return null;

  if (AMAZON_HOME_PATTERN.test(candidate)) {
    return null;
  }

  return candidate;
}
