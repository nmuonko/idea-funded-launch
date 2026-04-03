/**
 * Vehicle Sliding-Percentage Pricing Model (USA → Dar es Salaam)
 * 
 * Replaces the manual "Request a Quote" flow with auto-calculated tiered pricing.
 * All tier values and surcharges are admin-configurable via settings.vehicle_pricing_tiers.
 * 
 * Formula:
 *   final_price_usd = base_vehicle_price_usd × (1 + total_percentage / 100)
 *   total_percentage = tier_percentage + condition_surcharge + shipping_method_surcharge
 * 
 * This covers the USA → Dar es Salaam leg ONLY.
 * A future DRC customs/inland layer can apply on top of the result.
 */

// ─── Types ────────────────────────────────────────────────

export interface VehiclePricingTiers {
  tier_1_under_5000_percent: number;
  tier_2_5000_to_7999_percent: number;
  tier_3_8000_to_11999_percent: number;
  tier_4_12000_to_17999_percent: number;
  tier_5_18000_to_24999_percent: number;
  tier_6_25000_plus_percent: number;
  non_running_extra_percent: number;
  container_extra_percent: number;
  default_shipping_method: 'roro' | 'container';
  default_vehicle_condition: 'running' | 'non_running';
}

export type VehicleCondition = 'running' | 'non_running';
export type ShippingMethod = 'roro' | 'container';

export interface VehiclePricingBreakdown {
  basePriceUsd: number;
  tierPercent: number;
  conditionSurcharge: number;
  shippingSurcharge: number;
  totalPercent: number;
  finalPriceUsd: number;
  /** Difference: finalPriceUsd - basePriceUsd (stored as markup_fee_usd) */
  totalFeeUsd: number;
}

// ─── Defaults ─────────────────────────────────────────────

export const DEFAULT_VEHICLE_PRICING_TIERS: VehiclePricingTiers = {
  tier_1_under_5000_percent: 70,
  tier_2_5000_to_7999_percent: 58,
  tier_3_8000_to_11999_percent: 48,
  tier_4_12000_to_17999_percent: 40,
  tier_5_18000_to_24999_percent: 34,
  tier_6_25000_plus_percent: 28,
  non_running_extra_percent: 7,
  container_extra_percent: 8,
  default_shipping_method: 'roro',
  default_vehicle_condition: 'running',
};

// ─── Helpers ──────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse tiers from DB JSONB. Returns defaults for any missing keys.
 */
export function parseTiers(raw: unknown): VehiclePricingTiers {
  const d = DEFAULT_VEHICLE_PRICING_TIERS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const obj = raw as Record<string, unknown>;
  return {
    tier_1_under_5000_percent: Number(obj.tier_1_under_5000_percent ?? d.tier_1_under_5000_percent),
    tier_2_5000_to_7999_percent: Number(obj.tier_2_5000_to_7999_percent ?? d.tier_2_5000_to_7999_percent),
    tier_3_8000_to_11999_percent: Number(obj.tier_3_8000_to_11999_percent ?? d.tier_3_8000_to_11999_percent),
    tier_4_12000_to_17999_percent: Number(obj.tier_4_12000_to_17999_percent ?? d.tier_4_12000_to_17999_percent),
    tier_5_18000_to_24999_percent: Number(obj.tier_5_18000_to_24999_percent ?? d.tier_5_18000_to_24999_percent),
    tier_6_25000_plus_percent: Number(obj.tier_6_25000_plus_percent ?? d.tier_6_25000_plus_percent),
    non_running_extra_percent: Number(obj.non_running_extra_percent ?? d.non_running_extra_percent),
    container_extra_percent: Number(obj.container_extra_percent ?? d.container_extra_percent),
    default_shipping_method: (obj.default_shipping_method === 'container' ? 'container' : 'roro'),
    default_vehicle_condition: (obj.default_vehicle_condition === 'non_running' ? 'non_running' : 'running'),
  };
}

/**
 * Get the tier percentage for a given base vehicle price.
 */
export function getVehicleTierPercent(basePriceUsd: number, tiers: VehiclePricingTiers): number {
  if (basePriceUsd < 5000) return tiers.tier_1_under_5000_percent;
  if (basePriceUsd < 8000) return tiers.tier_2_5000_to_7999_percent;
  if (basePriceUsd < 12000) return tiers.tier_3_8000_to_11999_percent;
  if (basePriceUsd < 18000) return tiers.tier_4_12000_to_17999_percent;
  if (basePriceUsd < 25000) return tiers.tier_5_18000_to_24999_percent;
  return tiers.tier_6_25000_plus_percent;
}

/**
 * Calculate the full vehicle pricing breakdown.
 * 
 * @param basePriceUsd  - The raw vehicle price from the listing
 * @param condition     - 'running' (default) or 'non_running'
 * @param shippingMethod - 'roro' (default) or 'container'
 * @param tiers         - Admin-configured tier percentages
 * @returns Full breakdown including finalPriceUsd
 */
export function calculateVehicleFinalPrice(
  basePriceUsd: number,
  condition: VehicleCondition = 'running',
  shippingMethod: ShippingMethod = 'roro',
  tiers: VehiclePricingTiers = DEFAULT_VEHICLE_PRICING_TIERS,
): VehiclePricingBreakdown {
  const tierPercent = getVehicleTierPercent(basePriceUsd, tiers);
  const conditionSurcharge = condition === 'non_running' ? tiers.non_running_extra_percent : 0;
  const shippingSurcharge = shippingMethod === 'container' ? tiers.container_extra_percent : 0;
  const totalPercent = tierPercent + conditionSurcharge + shippingSurcharge;
  const finalPriceUsd = round2(basePriceUsd * (1 + totalPercent / 100));
  const totalFeeUsd = round2(finalPriceUsd - basePriceUsd);

  return {
    basePriceUsd,
    tierPercent,
    conditionSurcharge,
    shippingSurcharge,
    totalPercent,
    finalPriceUsd,
    totalFeeUsd,
  };
}
