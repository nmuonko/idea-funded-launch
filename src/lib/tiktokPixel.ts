/**
 * TikTok Pixel + Events API helpers.
 *
 * Browser pixel (index.html) fires client-side events.
 * Each helper also sends the same event server-side via the tiktok-events
 * edge function, using a shared event_id for deduplication.
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

/** Generate a unique event_id for deduplication between browser + server */
function genEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * Fire-and-forget POST to server-side TikTok Events API relay.
 * Never throws — errors are silently logged.
 */
function sendServerEvent(payload: {
  event: string;
  event_id: string;
  properties?: Record<string, unknown>;
  user_email?: string;
  user_phone?: string;
  user_id?: string;
}) {
  fetch(`${SUPABASE_URL}/functions/v1/tiktok-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  }).catch((err) => console.warn('[TikTok S2S] send failed:', err.message));
}

/** Optional user context passed from call sites */
export interface TikTokUserCtx {
  email?: string;
  phone?: string;
  userId?: string;
}

/* ── ViewContent ── product detail page */
export function trackViewContent(
  product: { id: string; title: string; price: number },
  userCtx?: TikTokUserCtx,
) {
  const eventId = genEventId();
  ttq()?.track('ViewContent', {
    event_id: eventId,
    content_id: product.id,
    content_name: product.title,
    content_type: 'product',
    value: product.price,
    currency: 'USD',
  });
  sendServerEvent({
    event: 'ViewContent',
    event_id: eventId,
    properties: {
      content_id: product.id,
      content_name: product.title,
      content_type: 'product',
      value: product.price,
      currency: 'USD',
    },
    user_email: userCtx?.email,
    user_phone: userCtx?.phone,
    user_id: userCtx?.userId,
  });
}

/* ── AddToCart ── */
export function trackAddToCart(
  product: { id: string; title: string; price: number },
  userCtx?: TikTokUserCtx,
) {
  const eventId = genEventId();
  ttq()?.track('AddToCart', {
    event_id: eventId,
    content_id: product.id,
    content_name: product.title,
    content_type: 'product',
    value: product.price,
    currency: 'USD',
  });
  sendServerEvent({
    event: 'AddToCart',
    event_id: eventId,
    properties: {
      content_id: product.id,
      content_name: product.title,
      content_type: 'product',
      value: product.price,
      currency: 'USD',
    },
    user_email: userCtx?.email,
    user_phone: userCtx?.phone,
    user_id: userCtx?.userId,
  });
}

/* ── Search ── */
export function trackSearch(query: string, userCtx?: TikTokUserCtx) {
  const eventId = genEventId();
  ttq()?.track('Search', {
    event_id: eventId,
    search_string: query,
  });
  sendServerEvent({
    event: 'Search',
    event_id: eventId,
    properties: { search_string: query },
    user_email: userCtx?.email,
    user_phone: userCtx?.phone,
    user_id: userCtx?.userId,
  });
}

/* ── InitiateCheckout ── */
export function trackInitiateCheckout(totalUsd: number, userCtx?: TikTokUserCtx) {
  const eventId = genEventId();
  ttq()?.track('InitiateCheckout', {
    event_id: eventId,
    value: totalUsd,
    currency: 'USD',
  });
  sendServerEvent({
    event: 'InitiateCheckout',
    event_id: eventId,
    properties: { value: totalUsd, currency: 'USD' },
    user_email: userCtx?.email,
    user_phone: userCtx?.phone,
    user_id: userCtx?.userId,
  });
}

/* ── Purchase ── */
export function trackPurchase(totalUsd: number, userCtx?: TikTokUserCtx) {
  const eventId = genEventId();
  ttq()?.track('Purchase', {
    event_id: eventId,
    value: totalUsd,
    currency: 'USD',
  });
  sendServerEvent({
    event: 'Purchase',
    event_id: eventId,
    properties: { value: totalUsd, currency: 'USD' },
    user_email: userCtx?.email,
    user_phone: userCtx?.phone,
    user_id: userCtx?.userId,
  });
}
