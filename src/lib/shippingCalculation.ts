/**
 * Canonical shipping calculation utility
 * SINGLE SOURCE OF TRUTH for shipping fee calculation
 * 
 * Weight-based model:
 *   If flat_shipping_usd is set:  shipping = flat_shipping_usd × quantity
 *   Else:                          shipping = est_weight_kg × shipping_rate_per_kg × quantity
 *   Then:                          shipping = shipping × (1 + buffer_percent / 100)
 */

export interface ShippingCategoryInfo {
  est_weight_kg: number;
  flat_shipping_usd: number | null;
  shipping_buffer_percent: number;
  requires_manual_quote: boolean;
}

/**
 * Weight-based shipping calculation per category
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
