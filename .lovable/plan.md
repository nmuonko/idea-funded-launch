

# Fix: Duplicate Import Crashing mobile-get-cart

## Problem

The `mobile-get-cart` edge function is **completely broken** -- it crashes on boot with:

```
Uncaught SyntaxError: Identifier 'normalizeCategorySlug' has already been declared
```

This means every cart request returns a 500 error, causing the mobile app to show $0 for all item prices.

## Root Cause

Line 8 and line 9 in `supabase/functions/mobile-get-cart/index.ts` are **identical duplicate imports**:

```typescript
import { normalizeCategorySlug, getCategoryLabel } from "../_shared/shippingCategory.ts";
import { normalizeCategorySlug, getCategoryLabel } from "../_shared/shippingCategory.ts";  // DUPLICATE
```

This is a simple copy-paste error that was introduced at some point during recent edits.

## Fix

**File: `supabase/functions/mobile-get-cart/index.ts`**

Delete line 9 (the duplicate import). That's the entire fix -- one line removal.

After:
```typescript
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
import { normalizeCategorySlug, getCategoryLabel } from "../_shared/shippingCategory.ts";
import { isBlockedImageUrl } from "../_shared/imageValidation.ts";
```

## Impact

- The function will boot successfully again
- All cart item prices will display correctly on mobile
- No logic changes -- just removing a duplicate line

## Files Modified

- `supabase/functions/mobile-get-cart/index.ts` -- remove duplicate import on line 9

