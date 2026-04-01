/**
 * TikTok Pixel event helpers.
 * Base pixel is loaded globally in index.html (pixel ID: D76IOI3C77U5P0Q2C2AG).
 * These helpers fire standard e-commerce events with real product data.
 *
 * All calls are safe to invoke even if the pixel hasn't loaded —
 * ttq queues events automatically.
 */

declare global {
  interface Window {
    ttq?: {
      track: (event: string, params?: Record<string, unknown>) => void;
      page: () => void;
    };
  }
}

function ttq() {
  return window.ttq;
}

/* ── ViewContent ── product detail page */
export function trackViewContent(product: {
  id: string;
  title: string;
  price: number;
}) {
  ttq()?.track('ViewContent', {
    content_id: product.id,
    content_name: product.title,
    content_type: 'product',
    value: product.price,
    currency: 'USD',
  });
}

/* ── AddToCart ── */
export function trackAddToCart(product: {
  id: string;
  title: string;
  price: number;
}) {
  ttq()?.track('AddToCart', {
    content_id: product.id,
    content_name: product.title,
    content_type: 'product',
    value: product.price,
    currency: 'USD',
  });
}

/* ── Search ── */
export function trackSearch(query: string) {
  ttq()?.track('Search', {
    search_string: query,
  });
}

/* ── InitiateCheckout ── */
export function trackInitiateCheckout(totalUsd: number) {
  ttq()?.track('InitiateCheckout', {
    value: totalUsd,
    currency: 'USD',
  });
}

/* ── Purchase ── */
export function trackPurchase(totalUsd: number) {
  ttq()?.track('Purchase', {
    value: totalUsd,
    currency: 'USD',
  });
}
