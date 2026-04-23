/**
 * Server-side pricing utilities.
 * All price computation happens in Postgres via RPC — zero frontend calculation.
 *
 * IMPORTANT: prices MUST match what product detail / cart / mobile show.
 * The unified backend formula (compute_display_price_titled) detects the
 * shipping category from the product title, so we always pass titles when
 * available. Without a title, the SQL falls back to a generic category which
 * produces a different (wrong) number — never call the title-less version
 * for a real product.
 */
import { supabase } from '@/integrations/supabase/client';

/**
 * Resolve display prices for an array of base prices via the backend.
 * Pass `titles` aligned with `basePrices` so category-aware shipping is used.
 */
export async function resolveDisplayPrices(
  basePrices: number[],
  titles?: (string | null | undefined)[],
): Promise<number[]> {
  if (!basePrices.length) return [];
  try {
    if (titles && titles.length) {
      const { data, error } = await supabase.rpc('compute_display_prices_titled' as any, {
        base_prices: basePrices,
        titles: titles.map(t => t ?? ''),
      });
      if (error) throw error;
      return (data as number[]) || basePrices;
    }
    const { data, error } = await supabase.rpc('compute_display_prices' as any, {
      base_prices: basePrices,
    });
    if (error) throw error;
    return (data as number[]) || basePrices;
  } catch (e) {
    console.warn('[serverPricing] batch RPC failed, returning raw prices', e);
    return basePrices;
  }
}

/**
 * Resolve a single display price via the backend. Pass the product title for
 * category-aware shipping (matches product detail / cart prices).
 */
export async function resolveDisplayPrice(
  basePriceUsd: number,
  title?: string | null,
): Promise<number> {
  if (!basePriceUsd || basePriceUsd <= 0) return basePriceUsd;
  try {
    if (title) {
      const { data, error } = await supabase.rpc('compute_display_price_titled' as any, {
        base_price_usd: basePriceUsd,
        p_title: title,
        quantity: 1,
      });
      if (error) throw error;
      return Number(data) || basePriceUsd;
    }
    const { data, error } = await supabase.rpc('compute_display_price' as any, {
      base_price_usd: basePriceUsd,
    });
    if (error) throw error;
    return Number(data) || basePriceUsd;
  } catch {
    return basePriceUsd;
  }
}

/**
 * Apply server-computed prices to a mapped product array.
 * Mutates priceUsd in-place using each item's title for accurate category
 * detection — guarantees parity with product detail / cart prices.
 */
export async function applyServerPrices<T extends { priceUsd: number; title?: string | null; productTitle?: string | null }>(
  items: T[],
): Promise<T[]> {
  if (!items.length) return items;
  const basePrices = items.map(i => i.priceUsd);
  const titles = items.map(i => i.title ?? i.productTitle ?? '');
  const displayPrices = await resolveDisplayPrices(basePrices, titles);
  for (let i = 0; i < items.length; i++) {
    items[i].priceUsd = displayPrices[i] ?? items[i].priceUsd;
  }
  return items;
}
