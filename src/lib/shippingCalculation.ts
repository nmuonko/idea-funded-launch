/**
 * Canonical shipping calculation utility
 * SINGLE SOURCE OF TRUTH for shipping fee calculation
 * 
 * NEW MODEL (weight-based):
 *   If flat_shipping_usd is set:  shipping = flat_shipping_usd × quantity
 *   Else:                          shipping = est_weight_kg × shipping_rate_per_kg × quantity
 *   Then:                          shipping = shipping × (1 + buffer_percent / 100)
 * 
 * LEGACY FALLBACK (when no category info available):
 *   shipping = baseFee + (baseItemsTotal × shippingPercent)
 */

export interface ShippingCategoryInfo {
  est_weight_kg: number;
  flat_shipping_usd: number | null;
  shipping_buffer_percent: number;
  requires_manual_quote: boolean;
}

/**
 * NEW: Weight-based shipping calculation per category
 */
export function calculateWeightBasedShipping(
  category: ShippingCategoryInfo,
  shippingRatePerKg: number,
  quantity: number = 1,
): number {
  if (category.requires_manual_quote) return 0;

  let baseShipping: number;
  if (category.flat_shipping_usd != null && category.flat_shipping_usd > 0) {
    baseShipping = category.flat_shipping_usd * quantity;
  } else {
    baseShipping = category.est_weight_kg * shippingRatePerKg * quantity;
  }

  const bufferMultiplier = 1 + (category.shipping_buffer_percent / 100);
  return Math.round(baseShipping * bufferMultiplier * 100) / 100;
}

/**
 * LEGACY: Flat fee + percentage shipping calculation
 * Kept for backward compatibility when category info is unavailable
 * 
 * FORMULA: baseFee + (baseItemsTotal × shippingPercent)
 */
export function calculateShippingUsd(
  baseItemsTotalUsd: number,
  baseFeeUsd: number,
  shippingPercent: number
): number {
  const base = Number(baseFeeUsd) || 0;
  const subtotal = Number(baseItemsTotalUsd) || 0;
  const pctRaw = Number(shippingPercent) || 0;
  
  const normalizedPercent = pctRaw > 1 ? pctRaw / 100 : pctRaw;
  const shipping = base + (subtotal * normalizedPercent);
  return Math.round(shipping * 100) / 100;
}

/**
 * Debug utility - returns calculation breakdown
 */
export function calculateShippingUsdDebug(
  baseItemsTotalUsd: number,
  baseFeeUsd: number,
  shippingPercent: number
): {
  baseFeeUsd: number;
  subtotalUsd: number;
  percentRaw: number;
  percentNormalized: number;
  percentPart: number;
  shippingUsd: number;
  formula: string;
} {
  const base = Number(baseFeeUsd) || 0;
  const subtotal = Number(baseItemsTotalUsd) || 0;
  const pctRaw = Number(shippingPercent) || 0;
  const normalizedPercent = pctRaw > 1 ? pctRaw / 100 : pctRaw;
  const percentPart = subtotal * normalizedPercent;
  const shipping = Math.round((base + percentPart) * 100) / 100;
  
  return {
    baseFeeUsd: base,
    subtotalUsd: subtotal,
    percentRaw: pctRaw,
    percentNormalized: normalizedPercent,
    percentPart: Math.round(percentPart * 100) / 100,
    shippingUsd: shipping,
    formula: `$${base.toFixed(2)} + ($${subtotal.toFixed(2)} × ${(normalizedPercent * 100).toFixed(0)}%) = $${shipping.toFixed(2)}`,
  };
}
