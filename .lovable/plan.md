
# Fix Mobile Orders Error: Double `.order()` Chain

## Problem
The `mobile-get-orders` backend function chains two `.order()` calls (lines 75-76), which is not supported by the Supabase client version used in backend functions. This causes the error: `.order(...).order(...) is not a function`.

## Fix

### File: `supabase/functions/mobile-get-orders/index.ts`

Remove the second `.order('id', { ascending: false })` on line 76. Ordering by `created_at DESC` alone is sufficient for consistent results -- the `id` is a UUID so it does not provide meaningful tie-breaking anyway.

**Before:**
```ts
.order('created_at', { ascending: false })
.order('id', { ascending: false })
.range(offset, offset + pageSize - 1);
```

**After:**
```ts
.order('created_at', { ascending: false })
.range(offset, offset + pageSize - 1);
```

## Files Changed
- `supabase/functions/mobile-get-orders/index.ts` -- remove duplicate `.order()` call (1 line)
