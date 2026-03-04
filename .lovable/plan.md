

## Plan: Increase Mobile Search & Category Result Limits

### Problem
Three backend endpoints cap results too low for the mobile app:

1. **`catalog-category`** — `DEFAULT_LIMIT = 36`, `MAX_LIMIT = 100`. Mobile browsing a category (vehicles, electronics) gets at most 100 items per page.
2. **`catalog-collection`** — `pageSize` default 20, max 40 (`Math.min(40, ...)`). Category collection grids return only 20-40 items.
3. **`catalog-search`** — Already at `DEFAULT_LIMIT = 200`, `MAX_LIMIT = 200`. This is fine.

The mobile app config (`mobile-public-config`) already sets `categoryPageSize: 200`, but the actual endpoints enforce lower caps, so the client never gets more than 36-100 items.

### Changes

#### 1. `supabase/functions/catalog-category/index.ts`
- Change `DEFAULT_LIMIT` from `36` → `200`
- Change `MAX_LIMIT` from `100` → `200`

#### 2. `supabase/functions/catalog-collection/index.ts`  
- Change the pageSize cap from `Math.min(40, ...)` → `Math.min(200, ...)`
- Change default from `"20"` → `"200"`

These two changes align all browsing endpoints with `catalog-search`'s 200-item limit and the mobile config's `categoryPageSize: 200`.

### Files to Modify
- `supabase/functions/catalog-category/index.ts` (lines 63-64)
- `supabase/functions/catalog-collection/index.ts` (line 624)

