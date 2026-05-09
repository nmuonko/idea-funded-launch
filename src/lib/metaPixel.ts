/**
 * Meta (Facebook) Pixel standard event helpers.
 * Base pixel is initialized in index.html. These helpers fire standard
 * ecommerce events with deduplication via in-memory + sessionStorage guards
 * (Purchase in particular must never fire twice for the same order).
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function fbq(): ((...args: unknown[]) => void) | undefined {
  return typeof window !== 'undefined' ? window.fbq : undefined;
}

const firedKeys = new Set<string>();

function fireOnce(key: string, fn: () => void) {
  if (firedKeys.has(key)) return;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const storageKey = `fbq:${key}`;
      if (sessionStorage.getItem(storageKey)) {
        firedKeys.add(key);
        return;
      }
      sessionStorage.setItem(storageKey, '1');
    }
  } catch {
    /* ignore storage errors */
  }
  firedKeys.add(key);
  fn();
}

export function trackMetaViewContent(product?: { id?: string; title?: string; price?: number }) {
  const f = fbq();
  if (!f) return;
  const params: Record<string, unknown> = { currency: 'USD' };
  if (product?.id) params.content_ids = [product.id];
  if (product?.title) params.content_name = product.title;
  if (typeof product?.price === 'number') params.value = product.price;
  params.content_type = 'product';
  f('track', 'ViewContent', params);
}

export function trackMetaAddToCart(product?: { id?: string; title?: string; price?: number }) {
  const f = fbq();
  if (!f) return;
  const params: Record<string, unknown> = { currency: 'USD', content_type: 'product' };
  if (product?.id) params.content_ids = [product.id];
  if (product?.title) params.content_name = product.title;
  if (typeof product?.price === 'number') params.value = product.price;
  f('track', 'AddToCart', params);
}

export function trackMetaInitiateCheckout(totalUsd?: number) {
  const f = fbq();
  if (!f) return;
  const params: Record<string, unknown> = { currency: 'USD' };
  if (typeof totalUsd === 'number') params.value = totalUsd;
  f('track', 'InitiateCheckout', params);
}

/**
 * Purchase — deduped by orderId so it only ever fires once per order,
 * even across reloads of the thank-you page.
 */
export function trackMetaPurchase(orderId: string, totalUsd: number) {
  if (!orderId) return;
  fireOnce(`purchase:${orderId}`, () => {
    fbq()?.('track', 'Purchase', {
      value: totalUsd || 0,
      currency: 'USD',
    });
  });
}
