import { buildAmazonProductDetailUrl, normalizeAmazonProductUrl } from '@/lib/amazonProductLinks';

export interface AdminOrderProductLinkItem {
  store?: string | null;
  product_url?: string | null;
  canonical_url?: string | null;
  provider_product_id?: string | null;
  title?: string | null;
}

export function extractAmazonAsinFromOrderItem(item: AdminOrderProductLinkItem): string | null {
  for (const value of [item.provider_product_id, item.product_url, item.canonical_url]) {
    const url = normalizeAmazonProductUrl(value);
    if (url) {
      // Extract ASIN from the canonical URL
      const match = url.match(/\/dp\/([A-Z0-9]{10})$/);
      return match?.[1] || null;
    }
  }
  return null;
}

export function buildAmazonCanonicalOrderUrl(item: AdminOrderProductLinkItem): string | null {
  return buildAmazonProductDetailUrl({
    productId: item.provider_product_id,
    productUrl: item.product_url || item.canonical_url,
  });
}

export function getAdminOrderProductLink(item: AdminOrderProductLinkItem): string | null {
  const store = item.store?.toUpperCase();

  if (store === 'AMAZON') {
    return buildAmazonCanonicalOrderUrl(item);
  }

  const candidate = item.canonical_url || item.product_url || null;
  if (!candidate) return null;

  // Don't return Amazon home pages
  if (/^https?:\/\/(?:www\.)?amazon\.[^/]+\/?$/i.test(candidate)) {
    return null;
  }

  return candidate;
}
