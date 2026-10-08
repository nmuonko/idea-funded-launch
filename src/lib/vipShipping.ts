// Italy FedEx weight-bracket shipping for the VIP importer.
// Brackets come from the vip_shipping_brackets table (admin-editable);
// this module is pure math shared by the UI preview and tests.

export interface ShippingBracket {
  min_kg: number;
  max_kg: number;
  express_eur: number | null;
  standard_eur: number | null;
}

export type FedExCarrier = 'express' | 'standard';

/** Find the bracket covering a total shipment weight. Bounds are inclusive on the lower edge. */
export function findBracket(brackets: ShippingBracket[], totalWeightKg: number): ShippingBracket | null {
  const sorted = [...brackets].sort((a, b) => a.min_kg - b.min_kg);
  return (
    sorted.find((b) => totalWeightKg >= b.min_kg && totalWeightKg <= b.max_kg) ??
    // Heavier than every bracket → use the last (highest) bracket
    (totalWeightKg > 0 && sorted.length && totalWeightKg > sorted[sorted.length - 1].max_kg
      ? sorted[sorted.length - 1]
      : null)
  );
}

/** EUR shipping charge for a shipment, or null when the service is unavailable for that bracket. */
export function bracketCostEur(bracket: ShippingBracket, carrier: FedExCarrier): number | null {
  return carrier === 'express' ? bracket.express_eur : bracket.standard_eur;
}

/**
 * Allocate a total shipment shipping cost across items proportionally by weight.
 * Returns per-item costs in cents (integer) that sum exactly to the total.
 */
export function allocateShipping(totalCostCents: number, itemWeightsKg: number[]): number[] {
  const totalWeight = itemWeightsKg.reduce((s, w) => s + w, 0);
  if (!itemWeightsKg.length || totalWeight <= 0) return itemWeightsKg.map(() => 0);
  // Largest-remainder rounding so allocations sum to the exact total
  const raw = itemWeightsKg.map((w) => (w / totalWeight) * totalCostCents);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalCostCents - floors.reduce((s, f) => s + f, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

/** Convert EUR cents to USD cents at a rate like 1.08 (USD per EUR). */
export function eurCentsToUsdCents(eurCents: number, eurUsdRate: number): number {
  return Math.round(eurCents * eurUsdRate);
}

export interface ItalyPriceInput {
  purchasePriceUsd: number;
  allocatedShippingUsd: number;
  bufferPct: number;
  markupPct: number;
}

/** Final VIP price: purchase + allocated shipping + buffer + profit (profit on purchase only). */
export function computeItalyPrice({ purchasePriceUsd, allocatedShippingUsd, bufferPct, markupPct }: ItalyPriceInput) {
  const p = Math.round(purchasePriceUsd * 100);
  const shipping = Math.round(allocatedShippingUsd * 100);
  const buffer = Math.round((shipping * bufferPct) / 100);
  const profit = Math.round((p * markupPct) / 100);
  return {
    shipping_cost: shipping / 100,
    shipping_buffer: buffer / 100,
    profit: profit / 100,
    final_price: (p + shipping + buffer + profit) / 100,
  };
}
