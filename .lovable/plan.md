
# Fix: Payment Buttons Not Working (Mobile & Web)

## Problem Summary

Both mobile app and web checkout fail when pressing the "Pay" button for PawaPay or Stripe:
- **Mobile**: "Erreur de paiement - Temporary issue, please retry"
- **Web**: "Checkout Failed - Edge Function returned a non-2xx status code"

## Root Cause

The `mobile-checkout` edge function crashes immediately with this error:
```
supabase.from(...).update(...).eq(...).in(...).lt is not a function
```

**Location**: `supabase/functions/mobile-checkout/index.ts` lines 475-484

The code attempts to chain `.lt()` after `.in()` on an update query:
```typescript
supabase
  .from('checkout_sessions')
  .update({ status: 'expired' })
  .eq('user_id', user.id)
  .in('status', ['pending', 'processing'])
  .lt('created_at', ...)  // ← CRASHES HERE
```

The custom REST client in `_shared/auth.ts` has a `createUpdateBuilder` function that only implements `.eq()`, `.neq()`, `.in()`, and `.is()` methods. The `.lt()` method exists in `createQueryBuilder` (for SELECT) but was never added to `createUpdateBuilder` (for UPDATE).

---

## Solution

Add the missing filter methods to the `createUpdateBuilder` function in `_shared/auth.ts`:

### File: `supabase/functions/_shared/auth.ts`

Add these methods to `createUpdateBuilder` (after line 209):

```typescript
lt(col: string, val: unknown) { this._filters.push(`${col}=lt.${encodeURIComponent(String(val))}`); return this; },
gt(col: string, val: unknown) { this._filters.push(`${col}=gt.${encodeURIComponent(String(val))}`); return this; },
lte(col: string, val: unknown) { this._filters.push(`${col}=lte.${encodeURIComponent(String(val))}`); return this; },
gte(col: string, val: unknown) { this._filters.push(`${col}=gte.${encodeURIComponent(String(val))}`); return this; },
```

---

## Technical Details

The update builder needs parity with the query builder for filter methods. Currently:

| Method | Query Builder | Update Builder | Delete Builder |
|--------|--------------|----------------|----------------|
| `eq()` | ✅ | ✅ | ✅ |
| `neq()` | ✅ | ✅ | ✅ |
| `in()` | ✅ | ✅ | ✅ |
| `is()` | ✅ | ✅ | ❌ |
| `lt()` | ✅ | ❌ **MISSING** | ❌ |
| `gt()` | ✅ | ❌ **MISSING** | ❌ |
| `lte()` | ✅ | ❌ **MISSING** | ❌ |
| `gte()` | ✅ | ❌ **MISSING** | ❌ |

The fix adds the missing comparison operators to enable the stale session cleanup query to work.

---

## Files to Modify

1. **`supabase/functions/_shared/auth.ts`** - Add `lt()`, `gt()`, `lte()`, `gte()` methods to `createUpdateBuilder` function (around line 209)

---

## Expected Results

After this fix:
- Mobile app payment button works for both PawaPay and Stripe
- Web checkout "Place Order" button works for Mobile Money and Credit Card
- Stale checkout session cleanup runs without errors
- No regressions to other edge functions using the REST client
