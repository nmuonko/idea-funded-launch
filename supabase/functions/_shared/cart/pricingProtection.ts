/**
 * Pricing Protection Engine
 * 
 * Wraps AFTER existing pricing (base + markup + shipping) to add safety buffers,
 * margin floors, and loss-prevention guardrails.
 * 
 * The frontend never sees these fields — it only receives the final protected price
 * via the existing basePriceUsd / lineTotalUsd / totalUsd fields.
 */

import { round2 } from "./pricing.ts";

// ─── Types ──────────────────────────────────────────────

export interface ProtectionSettings {
  minProfitUsd: number;
  minProfitPercent: number;
  operationalBufferPercent: number;
  exchangeRateBufferPercent: number;
  riskBufferPercent: number;
  paymentFeePercent: number;
  paymentFeeFixedUsd: number;
  priceRoundingMode: string;
  emergencyProtectionPercent: number;
  lowMarginBlockThresholdUsd: number;
  stalePriceMaxHours: number;
  categoryProtectionOverrides: Record<string, CategoryOverride>;
}

export interface CategoryOverride {
  minProfitUsd?: number;
  minProfitPercent?: number;
  riskBufferPercent?: number;
  operationalBufferPercent?: number;
  requiresManualQuote?: boolean;
}

export type PricingStatus =
  | "protected"
  | "low_margin_blocked"
  | "manual_quote_required"
  | "stale_price_refresh_required"
  | "high_risk_protected";

export interface ProtectedPrice {
  // Input costs
  sourceCostUsd: number;
  shippingUsedUsd: number;
  markupAppliedUsd: number;

  // Protection buffers
  paymentFeeEstimateUsd: number;
  operationalBufferUsd: number;
  exchangeBufferUsd: number;
  riskBufferUsd: number;
  emergencyBufferUsd: number;

  // Floors
  minProfitFloorApplied: boolean;
  targetProfitUsd: number;

  // Totals
  rawTotalUsd: number;          // base + markup + shipping (before protection)
  totalProtectionUsd: number;   // sum of all buffers
  safeFinalPriceUsd: number;    // final protected price
  safeFinalPriceCdf: number;

  // Margin analysis
  profitUsd: number;
  marginPercent: number;

  // Status
  pricingStatus: PricingStatus;
  pricingConfidence: "high" | "medium" | "low";
  requiresManualReview: boolean;
  reasonCodes: string[];

  // Category
  categoryKey: string | null;
}

// ─── Default Protection Settings ────────────────────────

export const DEFAULT_PROTECTION: ProtectionSettings = {
  minProfitUsd: 3.0,
  minProfitPercent: 8,
  operationalBufferPercent: 3,
  exchangeRateBufferPercent: 5,
  riskBufferPercent: 2,
  paymentFeePercent: 4,
  paymentFeeFixedUsd: 0.50,
  priceRoundingMode: "up_nearest_dollar",
  emergencyProtectionPercent: 0,
  lowMarginBlockThresholdUsd: 1.0,
  stalePriceMaxHours: 48,
  categoryProtectionOverrides: {},
};

// ─── Core Protection Function ───────────────────────────

export function applyPricingProtection(
  sourceCostUsd: number,
  markupUsd: number,
  shippingUsd: number,
  exchangeRate: number,
  settings: ProtectionSettings,
  options: {
    categoryKey?: string | null;
    priceAgeHours?: number;
    isVehicle?: boolean;
    requiresManualQuote?: boolean;
    quantity?: number;
  } = {},
): ProtectedPrice {
  const {
    categoryKey = null,
    priceAgeHours = 0,
    isVehicle = false,
    requiresManualQuote = false,
    quantity = 1,
  } = options;

  const reasonCodes: string[] = [];

  // Get category-specific overrides
  const catOverride = categoryKey
    ? settings.categoryProtectionOverrides[categoryKey] ?? {}
    : {};

  const effectiveRiskPercent = catOverride.riskBufferPercent ?? settings.riskBufferPercent;
  const effectiveOpPercent = catOverride.operationalBufferPercent ?? settings.operationalBufferPercent;
  const effectiveMinProfitUsd = catOverride.minProfitUsd ?? settings.minProfitUsd;
  const effectiveMinProfitPercent = catOverride.minProfitPercent ?? settings.minProfitPercent;

  // Step 1: Raw total (existing pipeline output)
  const rawTotalUsd = round2(sourceCostUsd + markupUsd + shippingUsd);

  // Step 2: Calculate protection buffers on top of raw total
  const paymentFeeEstimateUsd = round2(
    (rawTotalUsd * (settings.paymentFeePercent / 100)) + (settings.paymentFeeFixedUsd * quantity)
  );
  const operationalBufferUsd = round2(rawTotalUsd * (effectiveOpPercent / 100));
  const exchangeBufferUsd = round2(rawTotalUsd * (settings.exchangeRateBufferPercent / 100));
  const riskBufferUsd = round2(rawTotalUsd * (effectiveRiskPercent / 100));
  const emergencyBufferUsd = round2(rawTotalUsd * (settings.emergencyProtectionPercent / 100));

  const totalProtectionUsd = round2(
    paymentFeeEstimateUsd + operationalBufferUsd + exchangeBufferUsd + riskBufferUsd + emergencyBufferUsd
  );

  let safeFinalPriceUsd = round2(rawTotalUsd + totalProtectionUsd);

  // Step 3: Enforce minimum profit floor
  let profitUsd = round2(safeFinalPriceUsd - sourceCostUsd - shippingUsd);
  const minProfitFromPercent = round2(sourceCostUsd * (effectiveMinProfitPercent / 100));
  const targetMinProfit = Math.max(effectiveMinProfitUsd, minProfitFromPercent);
  let minProfitFloorApplied = false;

  if (profitUsd < targetMinProfit) {
    // Bump price to meet minimum profit
    const deficit = round2(targetMinProfit - profitUsd);
    safeFinalPriceUsd = round2(safeFinalPriceUsd + deficit);
    profitUsd = round2(safeFinalPriceUsd - sourceCostUsd - shippingUsd);
    minProfitFloorApplied = true;
    reasonCodes.push("min_profit_floor_applied");
  }

  // Step 4: Apply rounding (always rounds UP to protect margin)
  safeFinalPriceUsd = applyRounding(safeFinalPriceUsd, settings.priceRoundingMode);

  // Recalculate profit after rounding
  profitUsd = round2(safeFinalPriceUsd - sourceCostUsd - shippingUsd);
  const marginPercent = sourceCostUsd > 0 ? round2((profitUsd / sourceCostUsd) * 100) : 100;

  // Step 5: Determine status
  let pricingStatus: PricingStatus = "protected";
  let pricingConfidence: "high" | "medium" | "low" = "high";
  let requiresManualReview = false;

  // Check stale price
  if (priceAgeHours > settings.stalePriceMaxHours) {
    pricingStatus = "stale_price_refresh_required";
    pricingConfidence = "low";
    reasonCodes.push("stale_price");
  }

  // Check manual quote
  if (requiresManualQuote || catOverride.requiresManualQuote) {
    pricingStatus = "manual_quote_required";
    requiresManualReview = true;
    reasonCodes.push("manual_quote_category");
  }

  // Check low margin block
  if (profitUsd < settings.lowMarginBlockThresholdUsd && !requiresManualQuote) {
    pricingStatus = "low_margin_blocked";
    requiresManualReview = true;
    reasonCodes.push("below_block_threshold");
  }

  // High-risk category detection
  if (isVehicle || effectiveRiskPercent > settings.riskBufferPercent) {
    if (pricingStatus === "protected") {
      pricingStatus = "high_risk_protected";
    }
    reasonCodes.push("high_risk_category");
  }

  // Emergency protection active
  if (settings.emergencyProtectionPercent > 0) {
    reasonCodes.push("emergency_protection_active");
  }

  // Medium confidence for older prices
  if (priceAgeHours > 24 && pricingConfidence === "high") {
    pricingConfidence = "medium";
    reasonCodes.push("price_age_24h_plus");
  }

  const safeFinalPriceCdf = round2(safeFinalPriceUsd * exchangeRate);

  return {
    sourceCostUsd,
    shippingUsedUsd: shippingUsd,
    markupAppliedUsd: markupUsd,
    paymentFeeEstimateUsd,
    operationalBufferUsd,
    exchangeBufferUsd,
    riskBufferUsd,
    emergencyBufferUsd,
    minProfitFloorApplied,
    targetProfitUsd: targetMinProfit,
    rawTotalUsd,
    totalProtectionUsd,
    safeFinalPriceUsd,
    safeFinalPriceCdf,
    profitUsd,
    marginPercent,
    pricingStatus,
    pricingConfidence,
    requiresManualReview,
    reasonCodes,
    categoryKey,
  };
}

// ─── Rounding Logic ─────────────────────────────────────

function applyRounding(price: number, mode: string): number {
  switch (mode) {
    case "up_99":
      // Round up to nearest .99
      return Math.ceil(price) - 0.01;

    case "up_nearest_dollar":
      return Math.ceil(price);

    case "up_nearest_5":
      return Math.ceil(price / 5) * 5;

    case "none":
    default:
      return round2(price);
  }
}

// ─── Checkout Revalidation ──────────────────────────────

export interface RevalidationResult {
  safe: boolean;
  originalTotal: number;
  revalidatedTotal: number;
  priceDrift: number;
  priceDriftPercent: number;
  status: PricingStatus;
  reasonCodes: string[];
}

/**
 * Re-validate a previously calculated protected price against current settings.
 * Called at checkout time to ensure margin hasn't eroded.
 */
export function revalidateProtectedPrice(
  originalProtectedTotal: number,
  currentProtection: ProtectedPrice,
  tolerancePercent: number = 2, // Allow up to 2% drift without blocking
): RevalidationResult {
  const drift = round2(currentProtection.safeFinalPriceUsd - originalProtectedTotal);
  const driftPercent = originalProtectedTotal > 0
    ? round2((drift / originalProtectedTotal) * 100)
    : 0;

  const reasonCodes = [...currentProtection.reasonCodes];

  // If current protected price is higher than what was quoted, price went up
  // If lower, we might be undercharging — but within tolerance is OK
  const safe = drift <= 0 || Math.abs(driftPercent) <= tolerancePercent;

  if (!safe) {
    reasonCodes.push("price_drift_exceeded");
  }

  return {
    safe,
    originalTotal: originalProtectedTotal,
    revalidatedTotal: currentProtection.safeFinalPriceUsd,
    priceDrift: drift,
    priceDriftPercent: driftPercent,
    status: safe ? currentProtection.pricingStatus : "low_margin_blocked",
    reasonCodes,
  };
}

// ─── Audit Log Builder ──────────────────────────────────

export function buildAuditLogEntry(
  protection: ProtectedPrice,
  orderId?: string | null,
  orderItemId?: string | null,
  productUrl?: string | null,
  settingsSnapshot?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    order_id: orderId ?? null,
    order_item_id: orderItemId ?? null,
    product_url: productUrl ?? null,
    source_cost_usd: protection.sourceCostUsd,
    shipping_used_usd: protection.shippingUsedUsd,
    markup_applied_usd: protection.markupAppliedUsd,
    payment_fee_usd: protection.paymentFeeEstimateUsd,
    operational_buffer_usd: protection.operationalBufferUsd,
    exchange_buffer_usd: protection.exchangeBufferUsd,
    risk_buffer_usd: protection.riskBufferUsd,
    emergency_buffer_usd: protection.emergencyBufferUsd,
    min_profit_floor_applied: protection.minProfitFloorApplied,
    raw_total_usd: protection.rawTotalUsd,
    protected_total_usd: protection.safeFinalPriceUsd,
    profit_usd: protection.profitUsd,
    margin_percent: protection.marginPercent,
    protection_status: protection.pricingStatus,
    pricing_confidence: protection.pricingConfidence,
    reason_codes: protection.reasonCodes,
    settings_snapshot: settingsSnapshot ?? {},
    category_key: protection.categoryKey,
  };
}
