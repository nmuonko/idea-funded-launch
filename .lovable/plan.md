

# Fix: Variants Not Showing -- ID Format Mismatch

## Root Cause

The DB-first lookup in `catalog-product` NEVER hits cached Amazon products because of an **ID format mismatch**:

| Component | ID Format | Example |
|-----------|-----------|---------|
| Search (amazonFetcher) stores | `amazon_B0CMSYHFCF` | `amazon_` + ASIN |
| Detail lookup queries | `rainforest:B0CMSYHFCF` | `rainforest:` + ASIN |

Two mismatches:
1. **Prefix**: `amazon` vs `rainforest` -- search uses `amazon_`, detail uses `internalProvider` = `rainforest`
2. **Separator**: `_` vs `:` -- search uses underscore, detail uses colon

This means:
- The DB lookup at line 438-442 (`eq("id", "rainforest:B0CMSYHFCF")`) will never find `amazon_B0CMSYHFCF`
- The variants cache check never runs (since it's inside the `if (dbItem)` block)
- Every click falls through to a slow 7-12s live Rainforest fetch
- The detail upsert at line 682 writes a NEW row with `rainforest:B0CMSYHFCF` (orphaned, never queried by search)

I verified this by calling the endpoint twice for the same ASIN. Both times returned `X-Source: live-rainforest` and `X-Variants-Cache: MISS`, taking 7-12 seconds each, despite the variants being successfully cached after the first call.

## Solution

### File: `supabase/functions/catalog-product/index.ts`

**Change the `fullProductId` construction** for Amazon products to match the format used by search:

```
// Current (broken):
const fullProductId = `${internalProvider}:${productId}`;
// Produces: "rainforest:B0CMSYHFCF"

// Fixed:
const fullProductId = internalProvider === "rainforest" 
  ? `amazon_${productId}` 
  : `${internalProvider}:${productId}`;
// Produces: "amazon_B0CMSYHFCF" (matches search cache)
```

This is a one-line fix. It aligns the detail endpoint's DB key with how search stores items.

**Also update the live fetch upsert** (line 663) to use the same corrected `fullProductId`, so detail-fetched items are findable by subsequent lookups.

**Also update the item response** `provider` field to remain `"rainforest"` for backward compat -- only the DB key format changes.

### No other file changes needed

- `product_variants_cache` uses `(source="amazon", product_id="B0CMSYHFCF")` -- already correct, unaffected
- Frontend sends `provider=amazon` -- already correct
- `rainforestAdapter.ts` -- no changes
- `ProductDetails.tsx` -- no changes

## Expected Results After Fix

| Call | Before (broken) | After (fixed) |
|------|-----------------|---------------|
| 1st click (cold) | 7-12s live fetch, variants returned but DB key orphaned | 7-12s live fetch, variants cached, DB key matches search |
| 2nd click (warm) | 7-12s live fetch AGAIN (DB miss due to ID mismatch) | ~100ms, DB hit + variants cache HIT, instant variants |

## Technical Details

The fix is approximately 3 lines in `catalog-product/index.ts`:

1. Line 392: Change `fullProductId` construction to use `amazon_` prefix for rainforest provider
2. Lines 663-664: The `toCache.id` already uses `fullProductId`, so it automatically picks up the fix
3. Lines 691-692: The `item.id` in the response also uses `fullProductId`, so the response ID will now be `amazon_B0CMSYHFCF` (matching search format)

Everything downstream (variants cache, legacy path, eBay path) works correctly because they use `productId` directly, not `fullProductId`.

