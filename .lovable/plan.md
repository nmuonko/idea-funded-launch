

# Fix: Shipping Price Display Bug

## Problem Diagnosis

After analyzing the codebase, I've identified the root cause:

| Component | Status |
|-----------|--------|
| Admin Settings (DB) | Correct: 10% stored as `10`, base fee $40 |
| `mobile-public-config` | Now correct: returns `percentValue: 0.1` (decimal) |
| `mobile-get-cart` backend calc | Correct: calculates shipping properly |
| Mobile App (Replit) | Bug: not using server-calculated `shippingFeeUsd` |

**The backend `mobile-get-cart` already returns a correctly calculated `shippingFeeUsd` in the summary.** The mobile app should display this value directly, not recalculate it.

---

## Current Backend Behavior (Verified Working)

```
mobile-get-cart returns:
{
  summary: {
    itemsTotalUsd: 9.95,        // Base prices only
    markupFeeUsd: 2.99,         // Margin (30%)
    shippingFeeUsd: 41.00,      // $40 + ($9.95 × 10%) = $40.995 → $41.00
    totalUsd: 53.94,            // $9.95 + $2.99 + $41.00
    shipping_debug: {
      raw_shippingPercent: 10,
      normalized_shippingPercent: 0.1,
      shippingBaseFeeUsd: 40,
      regularItemsBaseTotal: 9.95,
      regularShippingTotal: 41.00
    }
  }
}
```

**The formula in `mobile-get-cart` is:**
```
shipping = baseFee + (baseItemsTotal × normalizedPercent)
```
Where `baseItemsTotal` = sum of `base_price_usd` × `quantity` (before margin).

---

## Solution: Two-Part Fix

### Part 1: Verify Backend Calculation (Already Correct)

The backend uses `regularItemsBaseTotal` (base prices BEFORE margin) for shipping calculation. This is correct.

**No backend changes needed for core calculation.**

### Part 2: Add Frontend Utility for Consistency

Create a shared shipping calculation utility that the web frontend (this codebase) uses. The mobile app (Replit) should either:
- Use the pre-calculated `summary.shippingFeeUsd` from `mobile-get-cart`
- Or use the same formula with `mobile-public-config` values

**File to create: `src/lib/shippingCalculation.ts`**

```typescript
/**
 * Calculate shipping fee for an order
 * FORMULA: baseFee + (baseItemsTotal × shippingPercent)
 * 
 * @param baseItemsTotalUsd - Sum of item BASE prices (before markup)
 * @param baseFeeUsd - Flat base shipping fee (e.g., $40)
 * @param shippingPercent - Shipping percentage (decimal: 0.1 for 10%)
 */
export function calculateShippingUsd(
  baseItemsTotalUsd: number,
  baseFeeUsd: number,
  shippingPercent: number
): number {
  // Guard: normalize if passed as whole number (10) instead of decimal (0.1)
  const normalizedPercent = shippingPercent > 1 
    ? shippingPercent / 100 
    : shippingPercent;
  
  const shipping = baseFeeUsd + (baseItemsTotalUsd * normalizedPercent);
  
  // Round to 2 decimal places
  return Math.round(shipping * 100) / 100;
}

// Example: calculateShippingUsd(12.36, 40, 0.1) → 41.24
```

---

## Critical Issue: Mobile App Must Use Correct Subtotal

The screenshot shows "Prix Total des Articles: $12.36" but this appears to be **base + margin**, not base only.

**The mobile app (Replit) needs to:**
1. **Option A (Recommended)**: Just display `summary.shippingFeeUsd` from the API response - no recalculation needed
2. **Option B**: If calculating locally, use `summary.itemsTotalUsd` (base only), NOT the displayed "Prix Total" which includes margin

---

## Files to Update

### 1. Create canonical shipping calculation (for web frontend)
**New file:** `src/lib/shippingCalculation.ts`

### 2. Add enhanced logging to backend (temporary debug)
**File:** `supabase/functions/mobile-get-cart/index.ts`

Add additional debug fields to help mobile team verify:
```typescript
summary.shipping_debug = {
  ...existing,
  formula_explanation: `$${shippingBaseFeeUsd} + ($${regularItemsBaseTotal.toFixed(2)} × ${(normalizedShippingPercent * 100).toFixed(0)}%) = $${regularShippingTotal.toFixed(2)}`,
  important_note: 'Use itemsTotalUsd (base prices) for shipping calc, NOT the subtotal shown in UI'
};
```

### 3. Document the API contract
**File:** `MOBILE_APP_INTEGRATION.md`

Update to clarify:
- `itemsTotalUsd` = sum of base prices (use this for shipping calculation)
- `markupFeeUsd` = margin/service fee
- `shippingFeeUsd` = pre-calculated shipping (recommended: use this directly)
- UI "Prix Total des Articles" should display `itemsTotalUsd + markupFeeUsd`

---

## Verification After Fix

1. Check `mobile-get-cart` response includes correct `shippingFeeUsd`
2. Verify mobile app displays `summary.shippingFeeUsd` directly
3. Confirm shipping = $40 + ($base_items_total × 10%) matches expectation

---

## Summary

The backend calculation is already correct. The fix requires:

1. **Create** `src/lib/shippingCalculation.ts` - canonical calculation utility for web frontend
2. **Update** `mobile-get-cart/index.ts` - add clearer debug output explaining the formula
3. **Update** documentation to clarify which subtotal to use
4. **Redeploy** `mobile-get-cart` edge function
5. **Communicate** to mobile team (Replit): use `summary.shippingFeeUsd` directly from API response

The mobile app bug is using the displayed subtotal (base + margin) instead of the base-only subtotal for shipping calculation, or it's not using the pre-calculated value from the API at all.

