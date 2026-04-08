import { calculateShippingUsd, calculateWeightBasedShipping, type ShippingCategoryInfo } from '@/lib/shippingCalculation';
import { detectShippingCategory, type ShippingCategoryRow } from '@/lib/shippingCategoryDetector';

export interface FeeConfig {
  markupPercent: number;
  // Legacy fields (fallback)
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  // New weight-based fields
  shippingRatePerKg?: number;
  shippingCategories?: ShippingCategoryRow[];
}

/**
 * Compute all-inclusive display price for a regular (non-vehicle, non-fixed-price) product.
 * 
 * Auto-detects shipping category from title when categories are available.
 * Otherwise falls back to legacy flat+percent shipping.
 */
export function allInclusivePrice(
  basePriceUsd: number,
  fees: FeeConfig,
  quantity: number = 1,
  categoryInfo?: ShippingCategoryInfo | null,
  productTitle?: string,
  productCategoryKey?: string | null,
): number {
  const baseTotal = basePriceUsd * quantity;
  const markupRate = fees.markupPercent > 1 ? fees.markupPercent / 100 : fees.markupPercent;
  const markup = Math.round(baseTotal * markupRate * 100) / 100;

  let shipping: number;

  // Priority 1: Explicit categoryInfo passed in
  if (categoryInfo && fees.shippingRatePerKg != null) {
    shipping = calculateWeightBasedShipping(categoryInfo, fees.shippingRatePerKg, quantity);
  }
  // Priority 2: Auto-detect from title + available categories
  else if (fees.shippingCategories?.length && fees.shippingRatePerKg != null && productTitle) {
    const detected = detectShippingCategory(productTitle, productCategoryKey, fees.shippingCategories);
    shipping = calculateWeightBasedShipping(detected, fees.shippingRatePerKg, quantity);
  }
  // Fallback: Legacy formula
  else {
    shipping = calculateShippingUsd(baseTotal, fees.shippingBaseFeeUsd, fees.shippingPercent);
  }

  return Math.round((baseTotal + markup + shipping) * 100) / 100;
}
