/**
 * Server-side pricing utilities.
 * All price computation happens in Postgres via RPC — zero frontend calculation.
 */
import { supabase } from '@/integrations/supabase/client';

/**
 * Resolve display prices for an array of base prices via the backend.
 * Returns an array of all-inclusive prices in the same order.
 */
export async function resolveDisplayPrices(basePrices: number[]): Promise<number[]> {
  if (!basePrices.length) return [];
  try {
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
 * Resolve a single display price via the backend.
 */
export async function resolveDisplayPrice(basePriceUsd: number): Promise<number> {
  if (!basePriceUsd || basePriceUsd <= 0) return basePriceUsd;
  try {
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
 * Mutates priceUsd in-place and returns the same array.
 */
export async function applyServerPrices<T extends { priceUsd: number }>(
  items: T[],
): Promise<T[]> {
  if (!items.length) return items;
  const basePrices = items.map(i => i.priceUsd);
  const displayPrices = await resolveDisplayPrices(basePrices);
  for (let i = 0; i < items.length; i++) {
    items[i].priceUsd = displayPrices[i] ?? items[i].priceUsd;
  }
  return items;
}
