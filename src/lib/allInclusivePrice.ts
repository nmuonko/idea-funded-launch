import { calculateShippingUsd } from '@/lib/shippingCalculation';

export interface FeeConfig {
  markupPercent: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
}

/**
 * Compute all-inclusive display price for a regular (non-vehicle, non-fixed-price) product.
 * Formula: basePriceUsd + markup + shipping
 * All values come from admin settings — nothing hardcoded.
 */
export function allInclusivePrice(
  basePriceUsd: number,
  fees: FeeConfig,
  quantity: number = 1,
): number {
  const baseTotal = basePriceUsd * quantity;
  const markupRate = fees.markupPercent > 1 ? fees.markupPercent / 100 : fees.markupPercent;
  const markup = Math.round(baseTotal * markupRate * 100) / 100;
  const shipping = calculateShippingUsd(baseTotal, fees.shippingBaseFeeUsd, fees.shippingPercent);
  return Math.round((baseTotal + markup + shipping) * 100) / 100;
}
