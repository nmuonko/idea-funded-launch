
# Fix: Mobile Add-to-Cart "Requested Function Was Not Found" Error

## Problem Summary

The `mobile-add-cart-item` edge function returns HTTP 404 "Requested function was not found" because the function **failed to deploy**. This is caused by:

1. **Import at end of file** - Line 354 has `import { createAdminClient } from "../_shared/auth.ts";` which is syntactically incorrect (imports must be at top of file)

2. **Wrong function signature** - Line 315 calls `sharedUpdateOrderTotals(adminClient, draft.id)` with only 2 arguments, but the function requires 5 arguments: `(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate)`

The bundler fails during deployment due to these errors, resulting in the function not being available.

---

## Solution

### 1. Move Import to Top of File

Move the `createAdminClient` import from line 354 to the top with other imports (around line 19).

```typescript
// Line 19 - existing imports from auth.ts
import { 
  handleCors, 
  corsHeaders, 
  errorResponse, 
  jsonResponse,
  extractBearerToken,
  getDbClient,
  createAdminPostgrestClient,
  createAdminClient,  // ADD THIS
} from "../_shared/auth.ts";
```

### 2. Fix the `updateOrderTotals` Call

The `sharedUpdateOrderTotals` function requires settings parameters. Update the call on lines 311-318:

**Before (broken):**
```typescript
try {
  const adminClient = createAdminClient();
  await sharedUpdateOrderTotals(adminClient, draft.id);
} catch (e) {
  console.warn(`[CART_ADD] ${correlationId} Failed to update totals:`, (e as Error).message);
}
```

**After (fixed):**
```typescript
try {
  const adminClient = createAdminClient();
  await sharedUpdateOrderTotals(
    adminClient, 
    draft.id,
    settings.shippingBaseFeeUsd,
    settings.shippingPercent,
    settings.exchangeRate
  );
} catch (e) {
  console.warn(`[CART_ADD] ${correlationId} Failed to update totals:`, (e as Error).message);
}
```

### 3. Remove Duplicate Import at End of File

Delete line 354 entirely:
```typescript
// DELETE THIS LINE
import { createAdminClient } from "../_shared/auth.ts";
```

---

## Files to Modify

1. **`supabase/functions/mobile-add-cart-item/index.ts`**
   - Add `createAdminClient` to imports at line 19
   - Fix `sharedUpdateOrderTotals` call at line 315 to include required parameters
   - Remove duplicate import at line 354

---

## Deployment

After fixing, deploy the function:
- `mobile-add-cart-item`

---

## Expected Results

After implementation:
- `mobile-add-cart-item` deploys successfully (no 404)
- Mobile app can add items to cart
- Order totals update correctly after adding items
- No bundler/syntax errors during deployment
