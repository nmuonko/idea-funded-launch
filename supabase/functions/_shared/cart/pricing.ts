/**
 * Cart Pricing Module
 * Centralized price calculations for cart operations
 */

/**
 * Round to 2 decimal places
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ItemPricing {
  basePriceUsd: number;
  quantity: number;
  itemBaseTotalUsd: number;
  itemMarginUsd: number;
  itemSubtotalUsd: number;
  itemSubtotalCdf: number;
}

export interface CartSettings {
  markupPercent: number;
  exchangeRate: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
}

/**
 * Calculate item pricing based on base price and settings
 */
export function calculateItemPricing(
  basePriceUsd: number,
  quantity: number,
  markupPercent: number,
  exchangeRate: number
): ItemPricing {
  const itemBaseTotalUsd = round2(basePriceUsd * quantity);
  const itemMarginUsd = round2(itemBaseTotalUsd * (markupPercent / 100));
  const itemSubtotalUsd = round2(itemBaseTotalUsd + itemMarginUsd);
  const itemSubtotalCdf = round2(itemSubtotalUsd * exchangeRate);

  return {
    basePriceUsd: round2(basePriceUsd),
    quantity,
    itemBaseTotalUsd,
    itemMarginUsd,
    itemSubtotalUsd,
    itemSubtotalCdf,
  };
}

/**
 * Calculate shipping fee for an item
 */
export function calculateShippingFee(
  itemBaseTotalUsd: number,
  shippingBaseFeeUsd: number,
  shippingPercent: number,
  requiresManualQuote: boolean
): number {
  if (requiresManualQuote) {
    return 0;
  }
  return round2(shippingBaseFeeUsd + (itemBaseTotalUsd * shippingPercent));
}

/**
 * Calculate total with shipping
 */
export function calculateTotalWithShipping(
  itemSubtotalUsd: number,
  shippingFeeUsd: number,
  exchangeRate: number
): { totalUsd: number; totalCdf: number } {
  const totalUsd = round2(itemSubtotalUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);
  return { totalUsd, totalCdf };
}

/**
 * Build item response object for API response
 */
export function buildItemResponse(
  itemId: string | null,
  productUrl: string,
  productTitle: string | null,
  productImageUrl: string | null,
  store: string,
  pricing: ItemPricing,
  shippingFeeUsd: number,
  exchangeRate: number,
  merged: boolean = false
): Record<string, unknown> {
  const { totalUsd, totalCdf } = calculateTotalWithShipping(
    pricing.itemSubtotalUsd,
    shippingFeeUsd,
    exchangeRate
  );

  return {
    id: itemId,
    productUrl,
    productTitle,
    productImageUrl,
    image_url: productImageUrl,
    store,
    basePriceUsd: pricing.basePriceUsd,
    quantity: pricing.quantity,
    itemBaseTotalUsd: pricing.itemBaseTotalUsd,
    itemMarginUsd: pricing.itemMarginUsd,
    itemSubtotalUsd: pricing.itemSubtotalUsd,
    itemSubtotalCdf: pricing.itemSubtotalCdf,
    shippingFeeUsd,
    lineTotalUsd: totalUsd,
    lineTotalCdf: totalCdf,
    merged,
  };
}
