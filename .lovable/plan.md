
# Fix: Product Variants Not Showing

## Root Cause

The `catalog_items` database table has **no `raw` column**. The current flow:

1. User clicks a product
2. Backend checks `catalog_items` DB first (line 383-418)
3. `mapDbItemToResponse()` tries to read `item.raw.variants` -- but `raw` doesn't exist in the table
4. Returns product with `variants: undefined`
5. Frontend hides variant selector (correct behavior when no data)

The **live Rainforest fetch** (line 576-656) does extract and return variants correctly, but it only runs on DB cache miss. Since most products are pre-cached from search, users almost never hit the live path.

## Solution

Change the `catalog-product` endpoint so that when a DB-cached Amazon product has no variants, it does a live Rainforest fetch to get variant data. This way the first user pays the fetch cost, but the variant data gets returned.

### Option chosen: Hybrid approach

For DB-cached Amazon products:
- Return the DB-cached data immediately for speed (price, images, title)
- But **always do a live Rainforest fetch** for the variant data
- Merge variants from the live fetch into the response
- This is already what happens conceptually -- we just need to stop short-circuiting at the DB hit

The simpler and more reliable approach: **Skip DB-first for Amazon product detail requests and always fetch live from Rainforest.** Product detail pages are infrequent (one user at a time clicking), and the Rainforest API response includes everything we need including variants. The DB cache was designed for search result lists, not detail pages.

## Technical Changes

### File: `supabase/functions/catalog-product/index.ts`

**Change the Amazon/Rainforest flow** (lines 389-418):

Instead of returning immediately when a DB hit is found for Amazon products, treat DB data as optional initial data and **always fetch live from Rainforest** for the `type=product` endpoint. This ensures variants, full descriptions, and up-to-date pricing are always returned.

Specifically:
- When `internalProvider === "rainforest"` and we find a DB hit, **skip returning early** and fall through to the live Rainforest fetch (line 576)
- The live fetch already caches back to DB (line 614), so the cache stays warm for search results
- Keep DB-first for eBay (eBay doesn't have variant data in the same way)

This is a ~5 line change: wrap the DB return block (lines 405-418) with a condition:

```typescript
if (dbItem) {
  const item = mapDbItemToResponse(dbItem);
  // ... block check ...

  // For Amazon: skip DB cache, always fetch live to get variants
  if (internalProvider !== "rainforest") {
    // Return DB-cached response (eBay, etc.)
    return new Response(JSON.stringify({ ... }));
  }
  // For Amazon/Rainforest: fall through to live fetch for variant data
  console.log(`[DETAIL_DB] correlationId=${correlationId} db_hit but fetching live for variants`);
}
```

### File: `supabase/functions/_shared/rainforestAdapter.ts`

**No changes needed.** The `normalizeProduct()` function already correctly extracts variants from Rainforest API responses (lines 978-996). The Rainforest API returns variant data by default on `type=product` requests.

### File: `src/pages/shop/ProductDetails.tsx`

**No changes needed.** The frontend already:
- Reads `item.variants` from the response (line 256)
- Groups variants by dimension name (lines 121-141)
- Renders the `VariantSelector` UI when variants exist (lines 531-564)
- Handles variant selection by navigating to `/product/amazon/{childAsin}` (line 542)

## Impact

- Amazon product detail pages will always show variant selectors (Color, Size, Storage) when available
- First load may be slightly slower (~1-2s extra for live fetch) vs DB cache hit
- eBay product detail pages unaffected (still DB-first)
- Search results unaffected
- No database migration needed
- No frontend changes needed

## What Is NOT Changed

- No payment, checkout, or cart logic changes
- No search flow changes
- No database schema changes
- No frontend component changes
- eBay product detail flow unchanged
