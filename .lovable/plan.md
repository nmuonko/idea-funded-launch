

# Plan: Optimize Payment Flow Response

## Problem Summary

The mobile checkout flow has a minor inefficiency: after `mobile-checkout` returns, the frontend may need to call `payment-decision` or `getAvailablePaymentMethods` to get structured payment method information with enabled/disabled reasons.

### Current Performance Analysis

Based on edge function logs, `mobile-checkout` is already well-optimized:

| Step | Time (ms) | Notes |
|------|-----------|-------|
| Auth + body parse | 163-192ms | JWT verification |
| Parallel fetch | 315-337ms | Profile, order, settings, payment_settings |
| Items fetch | 452-465ms | Order items query |
| Totals computed | 466ms | Server-side total calculation |

**Total checkout time: ~500ms** - This is good performance.

The issue is the **response doesn't include structured `available_methods`**, forcing a second API call.

## Solution

Add the `buildAvailableMethods` function (already in `payment-decision`) to `mobile-checkout` and include `available_methods` in the response.

## Changes Required

### File: `supabase/functions/mobile-checkout/index.ts`

**1. Add type definition (near line 26)**

Add the `AvailableMethod` type that matches `payment-decision`:

```typescript
interface AvailableMethod {
  method: 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER';
  enabled: boolean;
  disabledReason: string | null;
}
```

**2. Add `buildAvailableMethods` helper function (near line 100)**

Port the function from `payment-decision/index.ts`:

```typescript
function buildAvailableMethods(
  paymentSettings: PaymentSettings,
  totalUsdDollars: number,
  isVehicle: boolean
): AvailableMethod[] {
  const methods: AvailableMethod[] = [];
  const isOverLimit = totalUsdDollars > paymentSettings.mobile_money_max_usd;
  const isLargeOrder = isOverLimit || isVehicle;

  // MOBILE_MONEY (pawaPay)
  if (paymentSettings.pawapay_enabled) {
    if (isVehicle) {
      methods.push({
        method: 'MOBILE_MONEY',
        enabled: false,
        disabledReason: 'Not available for vehicle purchases',
      });
    } else if (isOverLimit) {
      methods.push({
        method: 'MOBILE_MONEY',
        enabled: false,
        disabledReason: `Maximum $${paymentSettings.mobile_money_max_usd.toLocaleString()} per transaction`,
      });
    } else {
      methods.push({
        method: 'MOBILE_MONEY',
        enabled: true,
        disabledReason: null,
      });
    }
  }

  // CARD (Stripe) - always available if enabled
  if (paymentSettings.stripe_enabled) {
    methods.push({
      method: 'CARD',
      enabled: true,
      disabledReason: null,
    });
  }

  // BANK_TRANSFER - only show for large orders
  if (paymentSettings.bank_transfer_enabled && isLargeOrder) {
    methods.push({
      method: 'BANK_TRANSFER',
      enabled: true,
      disabledReason: null,
    });
  }

  return methods;
}
```

**3. Build and include `available_methods` in the response**

Before the final `jsonResponse` (around line 2090), compute the structured methods:

```typescript
// Build structured available methods for frontend
const available_methods = buildAvailableMethods(
  paymentSettings,
  totalsBreakdown.grand_total,
  containsVehicle
);
```

**4. Add to response object (lines 2119-2165)**

Add `available_methods` to the response alongside `available_providers`:

```typescript
return jsonResponse({
  success: true,
  order_id: checkoutOrder.id,
  // ... existing fields ...
  available_providers: availableProviders,
  available_methods,  // NEW: Structured payment methods with enabled/disabled reasons
  // ... rest of response ...
});
```

Also add to the CHOICE_REQUIRED response (around line 1350-1400) for large orders.

## Impact

| Metric | Before | After |
|--------|--------|-------|
| API calls for checkout | 2 (checkout + payment methods) | 1 (checkout only) |
| Time saved | ~200-300ms | Eliminated second call |
| Code complexity | Minimal | Adds ~50 lines |

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/mobile-checkout/index.ts` | Add `AvailableMethod` type, `buildAvailableMethods` function, include in response |

## Technical Notes

1. The function is copied (not shared via import) because edge functions work best with self-contained code
2. No database schema changes required
3. Backward compatible - `available_providers` array is still returned
4. Mobile app can use `available_methods` if present, fallback to separate call if not

## Testing

1. Call `mobile-checkout` endpoint
2. Verify response includes both `available_providers` (strings) and `available_methods` (structured objects)
3. Test with vehicle orders (MOBILE_MONEY should show `enabled: false`)
4. Test with large orders exceeding limit (MOBILE_MONEY disabled with reason)
5. Confirm frontend no longer makes secondary payment method call

