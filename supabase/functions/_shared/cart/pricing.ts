/**
 * Cart Pricing Module
 * Centralized price calculations for cart operations
 */

import { 
  applyPricingProtection, 
  buildAuditLogEntry,
  ProtectedPrice,
  ProtectionSettings,
  DEFAULT_PROTECTION,
} from "./pricingProtection.ts";

/**
 * Round to 2 decimal places
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type { ProtectedPrice, ProtectionSettings };
export { applyPricingProtection, buildAuditLogEntry, DEFAULT_PROTECTION };

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
  effectiveMarkupPercent?: number,
  protectionSettings?: ProtectionSettings,
  protectionOptions?: {
    categoryKey?: string | null;
    priceAgeHours?: number;
    isVehicle?: boolean;
    requiresManualQuote?: boolean;
  },
): Record<string, unknown> {
  // Apply pricing protection if settings are available
  const protection = protectionSettings
    ? applyPricingProtection(
        pricing.itemBaseTotalUsd,  // source cost = base * qty
        pricing.itemMarginUsd,     // markup already calculated
        shippingFeeUsd,
        exchangeRate,
        protectionSettings,
        {
          ...protectionOptions,
          quantity: pricing.quantity,
        },
      )
    : null;

  // Use protected price if available, otherwise compute all-inclusive total
  // using the SAME formula as applyAllInclusivePricingToItems (catalog-home /
  // catalog-product): Math.ceil(base + markup + shipping) per unit, so the
  // price shown on home, product detail and cart all match for the same item.
  const qty = pricing.quantity || 1;
  const perUnitBase = pricing.basePriceUsd;
  const perUnitMarkup = pricing.itemMarginUsd / qty;
  const perUnitShipping = shippingFeeUsd / qty;
  const perUnitInclusive = Math.ceil(perUnitBase + perUnitMarkup + perUnitShipping);
  const finalTotalUsd = protection
    ? protection.safeFinalPriceUsd
    : round2(perUnitInclusive * qty);
  const finalTotalCdf = round2(finalTotalUsd * exchangeRate);

  // For the frozen app: always show the all-inclusive total as the "base" price
  const allInclusiveUnitPrice = protection
    ? round2(finalTotalUsd / qty)
    : perUnitInclusive;

  return {
    id: itemId,
    productUrl,
    productTitle,
    productImageUrl,
    image_url: productImageUrl,
    store,
    basePriceUsd: allInclusiveUnitPrice,
    quantity: pricing.quantity,
    itemBaseTotalUsd: finalTotalUsd,
    itemMarginUsd: pricing.itemMarginUsd,
    markupFeeUsd: pricing.itemMarginUsd,
    markup_fee_usd: pricing.itemMarginUsd,
    itemSubtotalUsd: pricing.itemSubtotalUsd,
    subtotalUsd: pricing.itemSubtotalUsd,
    subtotal_usd: pricing.itemSubtotalUsd,
    itemSubtotalCdf: pricing.itemSubtotalCdf,
    shippingFeeUsd,
    shipping_fee_usd: shippingFeeUsd,
    lineTotalUsd: finalTotalUsd,
    lineTotalCdf: finalTotalCdf,
    totalPriceUsd: finalTotalUsd,
    total_price_usd: finalTotalUsd,
    priceUsd: finalTotalUsd,
    merged,
    effectiveMarkupPercent: effectiveMarkupPercent ?? null,
    markupPercent: effectiveMarkupPercent ?? null,
    // Additive metadata for cross-platform all-inclusive pricing
    display_price_usd: finalTotalUsd,
    fees_included: true,
    is_all_inclusive_display: true,
    pricing_mode: 'all_inclusive',
    // Protection metadata (for backend/admin only — frontend ignores these)
    ...(protection ? {
      pricing_protection: {
        status: protection.pricingStatus,
        confidence: protection.pricingConfidence,
        requires_review: protection.requiresManualReview,
        profit_usd: protection.profitUsd,
        margin_percent: protection.marginPercent,
        total_protection_usd: protection.totalProtectionUsd,
        reason_codes: protection.reasonCodes,
        min_profit_floor_applied: protection.minProfitFloorApplied,
      },
    } : {}),
  };
}
