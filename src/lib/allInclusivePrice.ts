import { calculateShippingUsd, calculateWeightBasedShipping, type ShippingCategoryInfo } from '@/lib/shippingCalculation';

export interface FeeConfig {
  markupPercent: number;
  // Legacy fields (fallback)
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  // New weight-based fields
  shippingRatePerKg?: number;
}

/**
 * Compute all-inclusive display price for a regular (non-vehicle, non-fixed-price) product.
 * 
 * If categoryInfo is provided, uses weight-based shipping.
 * Otherwise falls back to legacy flat+percent shipping.
 */
export function allInclusivePrice(
  basePriceUsd: number,
  fees: FeeConfig,
  quantity: number = 1,
  categoryInfo?: ShippingCategoryInfo | null,
): number {
  const baseTotal = basePriceUsd * quantity;
  const markupRate = fees.markupPercent > 1 ? fees.markupPercent / 100 : fees.markupPercent;
  const markup = Math.round(baseTotal * markupRate * 100) / 100;

  let shipping: number;
  if (categoryInfo && fees.shippingRatePerKg != null) {
    shipping = calculateWeightBasedShipping(categoryInfo, fees.shippingRatePerKg, quantity);
  } else {
    shipping = calculateShippingUsd(baseTotal, fees.shippingBaseFeeUsd, fees.shippingPercent);
  }

  return Math.round((baseTotal + markup + shipping) * 100) / 100;
}
