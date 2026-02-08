

# Fix: Parallel Loading for Gallery Images and Similar Products

## Current Problem

The product detail page loads data **sequentially**:

1. Show 1 image from nav state (instant)
2. Wait 5-14 seconds for `catalog-product` API to return full gallery
3. **Only then** start fetching similar products (another 2-5 seconds)

Total wait: 7-19 seconds before everything is visible.

## Solution: Parallelize Everything

### Change 1: Fetch similar products in PARALLEL with product details

Currently similar products are fetched **after** `catalog-product` returns (line 151). Instead, start the similar products search **immediately** using the title from navigation state -- we already have it.

### Change 2: Pass all available images from search results

The search results from `catalog-search` sometimes include multiple images (via `images` or `imageUrls` arrays). Pass these through nav state so the gallery has more than 1 image instantly.

### File: `src/pages/shop/ProductDetails.tsx`

Split `fetchProduct` into two parallel operations:

```text
BEFORE (sequential):
  [catalog-product: 5-14s] --> [catalog-search for similar: 2-5s]
  Total: 7-19 seconds

AFTER (parallel):
  [catalog-product: 5-14s]     (enriches gallery + description)
  [catalog-search for similar: 2-5s]  (starts immediately using nav title)
  Total: max(5-14s, 2-5s) = 5-14 seconds, similar products visible in 2-5s
```

- Extract the similar products fetch into a separate `useEffect` that runs immediately using the title from nav state (or waits for product title if no nav state).
- The `catalog-product` fetch continues independently to enrich gallery/description.

### File: `src/components/shop/ProductCard.tsx`

Pass additional image data if available in the product object (for future-proofing when search results include multiple images).

## Technical Details

### ProductDetails.tsx changes

1. Create a new `useEffect` for similar products that uses `navProduct?.title` or `product?.title`
2. Remove the similar products fetch from inside the `catalog-product` callback
3. This means similar products appear in ~2-5 seconds (their own API time) instead of 7-19 seconds (product API + similar API)

### Expected Results

| What | Before | After |
|------|--------|-------|
| Main image | Instant | Instant (unchanged) |
| Full gallery | 5-14 seconds | 5-14 seconds (unchanged, requires API) |
| Similar products | 7-19 seconds | 2-5 seconds (starts immediately) |

The full gallery still depends on the `catalog-product` API for additional images -- that cannot be eliminated without backend changes. But similar products will now appear **much faster** since they no longer wait for the product API to finish first.
