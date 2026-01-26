/**
 * Canonical shipping calculation utility
 * SINGLE SOURCE OF TRUTH for shipping fee calculation
 * 
 * FORMULA: baseFee + (baseItemsTotal × shippingPercent)
 * 
 * @param baseItemsTotalUsd - Sum of item BASE prices (before markup/margin)
 * @param baseFeeUsd - Flat base shipping fee (e.g., $40)
 * @param shippingPercent - Shipping percentage (can be decimal 0.1 or whole 10)
 * @returns Shipping fee rounded to 2 decimal places
 * 
 * @example
 * calculateShippingUsd(12.36, 40, 10)  → 41.24  (10 normalized to 0.1)
 * calculateShippingUsd(12.36, 40, 0.1) → 41.24  (0.1 used directly)
 * calculateShippingUsd(100, 40, 10)    → 50.00  (40 + 100*0.1)
 */
export function calculateShippingUsd(
  baseItemsTotalUsd: number,
  baseFeeUsd: number,
  shippingPercent: number
): number {
  // Validate inputs
  const base = Number(baseFeeUsd) || 0;
  const subtotal = Number(baseItemsTotalUsd) || 0;
  const pctRaw = Number(shippingPercent) || 0;
  
  // Guard: normalize if passed as whole number (10) instead of decimal (0.1)
  // Values > 1 are treated as percentages and divided by 100
  const normalizedPercent = pctRaw > 1 
    ? pctRaw / 100 
    : pctRaw;
  
  // Calculate shipping: base fee + (subtotal × percent)
  const shipping = base + (subtotal * normalizedPercent);
  
  // Round to 2 decimal places
  return Math.round(shipping * 100) / 100;
}

/**
 * Debug utility - returns calculation breakdown
 * Use for development/debugging only
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
