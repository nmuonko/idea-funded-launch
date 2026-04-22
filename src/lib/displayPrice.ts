/**
 * Shared display price utility.
 *
 * The API returns an all-inclusive USD price (markup + shipping already applied
 * server-side per the all-inclusive pricing policy). Both the homepage product
 * cards and the product detail page MUST render this exact same value with the
 * exact same formatting — no client-side recalculation, no double-markup.
 *
 * Use this single helper everywhere a product price is shown so the homepage
 * card and the product detail page can never drift apart.
 */

/**
 * Normalize the raw API price to the canonical numeric value used for display.
 * Returns 0 for invalid / missing prices so callers can decide how to render.
 */
export function getDisplayPriceUsd(apiPriceUsd: number | null | undefined): number {
  if (apiPriceUsd == null) return 0;
  const n = Number(apiPriceUsd);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/**
 * Format the API price for display. Always USD, no decimals, no currency
 * conversion. Identical output on cards and detail pages.
 */
export function formatDisplayPriceUsd(apiPriceUsd: number | null | undefined): string {
  const n = getDisplayPriceUsd(apiPriceUsd);
  return `$${n.toFixed(0)}`;
}
