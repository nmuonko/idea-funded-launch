

# Fix Product Gallery: Enrich eBay Items With Full Gallery on Detail View

## Root Cause (Verified with Database Data)

The backend function is working correctly -- it boots, processes requests, and returns data. The problem is a **data gap**:

- **18,753 out of 23,300 eBay items** have an empty `images` array (`[]`) in the database
- They only have a single `image_url` field (one thumbnail)
- The current logic returns the DB record immediately when found, which means the live eBay API call (which would fetch 6-12 gallery images) is **never reached** for these items

This is why every product shows just one picture -- the data simply isn't there yet.

## Solution: Gallery Enrichment on First Detail View

When a user views an eBay product that has 0-1 images, the function should:
1. Fetch the full gallery from the eBay Browse API (already implemented in `getEbayItem`)
2. Merge those images into the response
3. Persist the enriched gallery back to `catalog_items` so subsequent views are instant

This follows the existing "enrich on first view" pattern described in the project memory.

## Technical Changes

### File: `supabase/functions/catalog-product/index.ts`

**Modify the DB-first return block (around lines 576-636):**

Currently, when a DB item is found, it returns immediately. The change adds a conditional enrichment step for eBay items with sparse galleries:

```text
IF dbItem found AND provider is "ebay" AND images.length <= 1:
  1. Call getEbayItem() to fetch live gallery from eBay API
  2. If successful and returns more images:
     - Merge live images into the response
     - Upsert enriched images back to catalog_items (fire-and-forget)
  3. If live fetch fails (expired listing, API error):
     - Return the DB item as-is (graceful degradation)
ELSE:
  Return DB item immediately (no change to current behavior)
```

Key design decisions:
- Only enriches items with 0-1 images (items already enriched are untouched)
- Only for eBay (Amazon requires Rainforest API which is currently expired)
- The live fetch adds ~200-500ms to the first view only; subsequent views are instant from DB
- Failure is silent -- if the eBay listing expired, the user still sees the single image

### No Frontend Changes Needed

The frontend (`ProductDetails.tsx`) already handles multi-image galleries correctly via the `safeImages` array. Once the backend returns more images, they will display automatically with thumbnails and swipe navigation.

## Summary

| File | Change |
|------|--------|
| `supabase/functions/catalog-product/index.ts` | Add eBay gallery enrichment when DB item has 0-1 images (~30 lines in the DB-first block) |

## Expected Outcome
- First view of an eBay product: fetches full gallery (6-12 images), shows immediately, caches for future
- Subsequent views: instant from DB with full gallery
- Amazon products: unchanged (still 1 image until Rainforest API is renewed)
- Already-enriched items: unchanged (no unnecessary API calls)

