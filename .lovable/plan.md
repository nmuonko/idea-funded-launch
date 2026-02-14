

# Fix: Stop Auto-Sending Quote on Cart Add -- Make It User-Initiated

## Problem

When a vehicle is added to the cart, the backend automatically treats it as "Quote Pending" even though no quote was actually requested. This happens because:

1. **Backend (`mobile-get-cart`)** defaults the per-item `quoteStatus` to `'PENDING'` for any vehicle without an actual quote request record (line 108)
2. **Backend summary logic** (line 509) only distinguishes `'quoted'` vs `'pending'` -- there is no `'none'` state for "vehicle in cart but user hasn't requested a quote yet"

This means the cart UI always shows "Quote Pending" instead of the "Request a Quote" button.

## Root Cause

Two places in `supabase/functions/mobile-get-cart/index.ts`:

- **Line 108**: `const quoteStatus = quoteRequest?.status || (isVehicle && !vehicleQuoteApplied ? 'PENDING' : null);`
  - When there's no `quoteRequest` record, it defaults to `'PENDING'` instead of `null` or `'NONE'`

- **Line 507-510**: Summary logic only has two outcomes for vehicles:
  ```
  vehicleQuoteStatus = allVehiclesQuoted ? 'quoted' : 'pending';
  ```
  - Missing the `'none'` state for vehicles with no quote request at all

## Changes

### 1. `supabase/functions/mobile-get-cart/index.ts`

**Line 108** -- Only report `'PENDING'` if an actual quote_request record exists:
```typescript
const quoteStatus = quoteRequest?.status || (isVehicle && !vehicleQuoteApplied ? 'NONE' : null);
```

**Lines 506-510** -- Add `'none'` state detection using a new tracker for vehicles that have no quote request at all:
- Track whether any vehicle has `quoteStatus === 'NONE'` (no request made)
- If all vehicles are quoted: `'quoted'`
- If some vehicles have pending requests: `'pending'`
- If any vehicle has no request at all: `'none'`

This ensures the cart context receives `vehicleQuoteStatus: 'none'` when the user hasn't clicked "Request a Quote" yet, which makes the prominent amber button appear.

### 2. No frontend changes needed

The cart UI (`ShopCart.tsx`) already handles all three states correctly:
- `'none'` -- shows the prominent "Request a Quote" button
- `'pending'` -- shows "Quote Pending" status bar
- `'quoted'` -- shows "Quote Received" status bar

## Technical Details

### File Modified
- `supabase/functions/mobile-get-cart/index.ts` -- Fix per-item quoteStatus default and summary-level vehicleQuoteStatus logic to distinguish "no quote requested" from "quote pending"

### Edge function redeployment
The `mobile-get-cart` function will be redeployed automatically after the change.

