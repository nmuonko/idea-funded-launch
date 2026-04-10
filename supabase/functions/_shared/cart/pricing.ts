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
  shippingRatePerKg: number;
}

export interface ShippingCategoryInfo {
  est_weight_kg: number;
  flat_shipping_usd: number | null;
  shipping_buffer_percent: number;
  requires_manual_quote: boolean;
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
 * NEW: Weight-based shipping fee calculation
 */
export function calculateWeightBasedShippingFee(
  category: ShippingCategoryInfo,
  shippingRatePerKg: number,
  quantity: number,
): number {
  if (category.requires_manual_quote) return 0;

  let baseShipping: number;
  if (category.flat_shipping_usd != null && category.flat_shipping_usd > 0) {
    baseShipping = category.flat_shipping_usd * quantity;
  } else {
    baseShipping = category.est_weight_kg * shippingRatePerKg * quantity;
  }

  const bufferMultiplier = 1 + (category.shipping_buffer_percent / 100);
  return round2(baseShipping * bufferMultiplier);
}

/**
 * LEGACY: Calculate shipping fee for an item (flat + percent)
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
  merged: boolean = false,
  effectiveMarkupPercent?: number
): Record<string, unknown> {
  const { totalUsd, totalCdf } = calculateTotalWithShipping(
    pricing.itemSubtotalUsd,
    shippingFeeUsd,
    exchangeRate
  );

  // For the frozen app: always show the all-inclusive total as the "base" price
  // so no matter which field the app reads, it displays the correct all-inclusive price.
  const allInclusiveUnitPrice = round2(totalUsd / (pricing.quantity || 1));

  return {
    id: itemId,
    productUrl,
    productTitle,
    productImageUrl,
    image_url: productImageUrl,
    store,
    basePriceUsd: allInclusiveUnitPrice,
    quantity: pricing.quantity,
    itemBaseTotalUsd: totalUsd,
    itemMarginUsd: pricing.itemMarginUsd,
    markupFeeUsd: pricing.itemMarginUsd,
    markup_fee_usd: pricing.itemMarginUsd,
    itemSubtotalUsd: pricing.itemSubtotalUsd,
    subtotalUsd: pricing.itemSubtotalUsd,
    subtotal_usd: pricing.itemSubtotalUsd,
    itemSubtotalCdf: pricing.itemSubtotalCdf,
    shippingFeeUsd,
    shipping_fee_usd: shippingFeeUsd,
    lineTotalUsd: totalUsd,
    lineTotalCdf: totalCdf,
    totalPriceUsd: totalUsd,
    total_price_usd: totalUsd,
    priceUsd: totalUsd,
    merged,
    effectiveMarkupPercent: effectiveMarkupPercent ?? null,
    markupPercent: effectiveMarkupPercent ?? null,
    // Additive metadata for cross-platform all-inclusive pricing
    display_price_usd: totalUsd,
    fees_included: true,
    is_all_inclusive_display: true,
    pricing_mode: 'all_inclusive',
  };
}
