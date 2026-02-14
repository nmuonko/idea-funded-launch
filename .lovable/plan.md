

# Fix: Variants Not Showing + Diagnostic Header Corrections

## Root Cause Analysis

Three bugs prevent variants from appearing:

### Bug 1: Legacy `catalog_products` path short-circuits variants (Amazon)

When a DB hit on `catalog_items` has no cached variants, the code falls through to line 484. But before reaching the live Rainforest fetch (line 644), it hits the **legacy `catalog_products` fallback** (lines 486-548). This legacy path:
- Returns a response WITHOUT checking variants cache
- Returns WITHOUT fetching variants live  
- Sets `X-Variants-Cache: SKIP`

So any Amazon product that exists in `catalog_products` (most do) gets returned **without variants**, permanently blocking the live fetch path.

### Bug 2: Wrong diagnostic header on variants cache HIT

Line 476 reports `variantsCache: "SKIP"` when it should be `"HIT"`. This makes debugging misleading.

### Bug 3: eBay adapter returns no variants

The `ebayAdapter.ts` does not extract variation data from eBay API responses. The eBay live fetch path (lines 551-636) constructs the item without a `variants` field, then tries to cache `item.variants` which is always `undefined`.

## Solution

### File 1: `supabase/functions/catalog-product/index.ts`

**Change A**: Fix variants cache HIT header (line 476)
- Change `variantsCache: "SKIP"` to `variantsCache: "HIT"`

**Change B**: Make legacy `catalog_products` path check variants cache + fall through if none
- After building the legacy item (line 514-529), check `getCachedVariants()`
- If variants found, attach them and return with `X-Variants-Cache: HIT`
- If variants NOT found, **do not return** -- fall through to live Rainforest fetch, which will get variants

This is the critical fix. Currently the legacy path always returns, preventing the live fetch from ever running for products that exist in `catalog_products`.

**Change C**: Add structured log line per request
- At each return point, log a single JSON line with: `provider, id, dbHit, variantsCacheHit, liveFetch, variantsCount, totalMs`

### File 2: eBay Variants (deferred -- separate concern)

eBay variations require a different API call (Browse API `getItem` with `fieldgroups=PRODUCT`). This is a larger change that should be handled separately. For now, eBay products will continue without variant selectors, which matches current behavior.

### No Frontend Changes

The frontend (`ProductDetails.tsx`) already:
- Reads `item.variants` from response (line 256)
- Groups by dimension name (lines 121-141)  
- Renders `VariantSelector` when variants exist
- Handles variant selection by navigating to child ASIN

### Image Proxy (deferred)

The image proxy cache (section D) is a substantial new edge function + storage bucket. It should be implemented separately to keep this change focused on the variants bug.

## Technical Details

### Change B Detail (legacy path fix)

Current code (simplified):
```text
// Line 486-548
if (internalProvider === "rainforest") {
  const legacyItem = await db.from("catalog_products")...;
  if (legacyItem) {
    // Builds item WITHOUT variants
    return new Response(...);  // <-- BUG: always returns, blocks live fetch
  }
}
```

Fixed flow:
```text
if (internalProvider === "rainforest") {
  const legacyItem = await db.from("catalog_products")...;
  if (legacyItem) {
    const cachedVariants = await getCachedVariants();
    if (cachedVariants) {
      item.variants = cachedVariants;
      return new Response(...);  // Return with variants from cache
    }
    // NO return -- fall through to live Rainforest fetch for variants
    console.log("[DETAIL_DB] legacy hit but no variants, falling through to live fetch");
  }
}
```

This ensures:
- First click: legacy data available but no variants -> live Rainforest fetch runs -> variants extracted + cached
- Second click: DB hit -> variants cache HIT -> instant return with variants

## Expected Results

| Scenario | Before | After |
|----------|--------|-------|
| Amazon product, first click | Legacy path returns without variants | Live fetch runs, variants appear, cached for next time |
| Amazon product, second click | Same -- no variants | Variants cache HIT, instant with variants |
| X-Variants-Cache header on cache hit | "SKIP" (wrong) | "HIT" (correct) |
| eBay product | No variants | No variants (unchanged, deferred) |

## Files Modified

- `supabase/functions/catalog-product/index.ts` -- 3 changes (header fix, legacy path fix, structured logging)

