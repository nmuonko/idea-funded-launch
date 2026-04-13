import { calculateWeightBasedShipping, type ShippingCategoryInfo } from '@/lib/shippingCalculation';
import { detectShippingCategory, type ShippingCategoryRow } from '@/lib/shippingCategoryDetector';

/** Default fallback category when no category is detected */
const DEFAULT_FALLBACK_CATEGORY: ShippingCategoryInfo = {
  est_weight_kg: 0.5,
  flat_shipping_usd: null,
  shipping_buffer_percent: 25,
  requires_manual_quote: false,
};

export interface FeeConfig {
  markupPercent: number;
  shippingRatePerKg?: number;
  shippingCategories?: ShippingCategoryRow[];
}

/**
 * Compute all-inclusive display price for a regular (non-vehicle, non-fixed-price) product.
 * 
 * Auto-detects shipping category from title when categories are available.
 * Falls back to a safe default category (0.5kg, 25% buffer) when no category is detected.
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

  const ratePerKg = fees.shippingRatePerKg ?? 20;

  let shipping: number;

  // Priority 1: Explicit categoryInfo passed in
  if (categoryInfo) {
    shipping = calculateWeightBasedShipping(categoryInfo, ratePerKg, quantity);
  }
  // Priority 2: Auto-detect from title + available categories
  else if (fees.shippingCategories?.length && productTitle) {
    const detected = detectShippingCategory(productTitle, productCategoryKey, fees.shippingCategories);
    shipping = calculateWeightBasedShipping(detected, ratePerKg, quantity);
  }
  // Fallback: Safe default category (0.5kg, 25% buffer)
  else {
    shipping = calculateWeightBasedShipping(DEFAULT_FALLBACK_CATEGORY, ratePerKg, quantity);
  }

  return Math.round((baseTotal + markup + shipping) * 100) / 100;
}
