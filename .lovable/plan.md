

## Plan: Fix Recently Viewed Duplicates, Clean Images, and Wire All Stores to Firecrawl

### Issues Identified

1. **Recently Viewed Duplicates**: The `updateLocalStorage` in `src/lib/recentlyViewed.ts` correctly deduplicates by `product_id + provider`. However, the DB query in `getRecentlyViewed` (line 87-106) does NOT deduplicate — if the same product appears with slightly different `store_id` formats or if localStorage and DB results overlap, duplicates can show. Also, the `useRecentlyViewed.ts` hook (a separate, older implementation) writes to the same localStorage key but with a different data shape, potentially causing conflicts.

2. **Image Quality**: ProductCard already has promotional image filtering but needs tighter aspect-ratio thresholds and better fallback handling for broken/missing images.

3. **Firecrawl for All Stores**: Currently `get-product-info` only uses Firecrawl as a fallback for **Amazon** (line 1362). All other stores (Walmart, SHEIN, Target, Best Buy, etc.) fall through to a basic proxy OG-image extractor when blocked. Need to generalize the Firecrawl fallback to all non-eBay stores.

---

### Changes

#### 1. Fix Recently Viewed Deduplication (`src/lib/recentlyViewed.ts`)
- In `getRecentlyViewed()`, add a deduplication step after fetching from DB — filter by unique `store_id` to prevent duplicates.
- In `trackRecentlyViewed()`, normalize the product ID before building the `storeId` key (trim whitespace, lowercase provider) to prevent near-duplicate entries like `amazon:B09XYZ` vs `Amazon:B09XYZ`.

#### 2. Clean Product Images (`src/components/shop/ProductCard.tsx`)
- Tighten the `handleImgLoad` aspect ratio check — hide images wider than 2:1 or taller than 1:2 (banners/sidebars).
- Add a visible "No image" placeholder when image is hidden or fails to load, so cards don't appear broken.
- Expand `PROMO_IMAGE_TOKENS` with additional known bad patterns.

#### 3. Wire All Stores to Firecrawl (`supabase/functions/get-product-info/index.ts`)
- Generalize the existing `scrapeAmazonViaFirecrawl` function into a `scrapeViaFirecrawl(url, domain)` function that works for any store.
- After the retry-with-enhanced-headers block (line 1360), instead of checking `isAmazon`, check `!isEbay` — so all stores except eBay get the Firecrawl fallback when direct scraping fails.
- Extract images/titles from the Firecrawl response using existing store-specific extractors (Walmart, SHEIN, Target, etc.) plus generic OG/meta fallbacks.

### Technical Details

```text
scrapeProduct(url)
  ├─ Amazon mobile fetch → retry → Firecrawl fallback (existing)
  ├─ Other stores fetch → retry → NEW: Firecrawl fallback (all except eBay)
  └─ eBay fetch → retry → proxy OG fallback (unchanged)
```

**Files to modify:**
- `src/lib/recentlyViewed.ts` — dedup on read + normalize keys
- `src/components/shop/ProductCard.tsx` — tighter image filtering
- `supabase/functions/get-product-info/index.ts` — generalize Firecrawl fallback to all non-eBay stores

