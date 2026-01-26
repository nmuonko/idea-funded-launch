
# Fix: Shipping Percentage Display Bug

## Problem Summary

The admin panel correctly sets shipping to 10%, but the mobile app shows an inflated shipping fee ($108.07 instead of ~$41.24) because of a data format mismatch between the backend API and the mobile frontend.

**Current Flow:**
1. Admin sets 10% in settings → stored as `10` in database
2. `mobile-public-config` API returns `{ shipping: { percentValue: 10 } }`
3. Mobile app (Replit) receives `10` but uses it as a direct multiplier (10× instead of 0.1×)

**Expected calculation:** $40 (base) + ($12.36 × 0.10) = **$41.24**
**Actual (buggy):** $40 + ($12.36 × some_wrong_factor) = **$108.07**

---

## Root Cause

The `mobile-public-config` endpoint returns `percentValue: 10` as a whole number, expecting the mobile app to divide by 100 before using it. However, this creates ambiguity and is inconsistent with how the backend handles it internally (where it normalizes via division).

---

## Solution

Normalize the percentage to decimal form (0.1 for 10%) in the backend response so the mobile app can use it directly without additional conversion logic.

### Files to Update

**1. `supabase/functions/mobile-public-config/index.ts`**

Change the shipping percentage output from whole number to decimal:

```typescript
// Before (line ~160):
percentValue: Number(shippingPercentValue),

// After:
percentValue: Number(shippingPercentValue) / 100,  // Return as decimal (10 → 0.1)
```

Similarly for the service fee if the mobile app uses it:
```typescript
// Before:
percent: Number(serviceFeePercentValue),

// After:
percent: Number(serviceFeePercentValue) / 100, // Return as decimal
```

**2. `supabase/functions/mobile-get-cart/index.ts`**

Update the shipping_debug output to show the decimal value for debugging:

```typescript
// Update debug info to show normalized value
summary.shipping_debug = {
  raw_shippingPercent: shippingPercent,
  normalized_shippingPercent: normalizedShippingPercent, // Already correct (0.1)
  ...
};
```

---

## Alternative Approach (If Mobile Can't Be Updated)

If the mobile app is already deployed and expects a decimal, the backend must return decimals. If it expects whole numbers but processes them correctly, no change is needed.

**Recommended:** Return decimals from API to eliminate ambiguity:
- `percentValue: 0.10` (not 10)
- `markup.value: 0.30` (not 30)

This matches how most financial APIs work and prevents client-side interpretation errors.

---

## Technical Details

| Endpoint | Current Output | Proposed Output |
|----------|----------------|-----------------|
| `shipping.percentValue` | `10` | `0.1` |
| `serviceFee.percent` | `0.12` | Keep as-is (already decimal) |
| `markup.value` | `30` | `0.3` (for consistency) |

---

## Edge Functions to Redeploy

After changes:
1. `mobile-public-config` (primary fix)
2. No changes needed to `mobile-get-cart` (backend calculation is already correct)

---

## Verification Steps

1. Call `/mobile-public-config` and verify `shipping.percentValue = 0.1`
2. Add an item to cart on mobile app
3. Verify shipping = $40 + (items × 0.1) = expected value
