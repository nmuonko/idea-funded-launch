

## Fix: Load All Category Products in Batches + Block Ad Banner Images

### Problems

1. **Only 200 products shown**: `CategoryResultsPage` has `POOL_TARGET = 300` and `VISIBLE_STEP = 48`, capping the initial pool at ~300 items and showing only 48 at a time. The "Load More" button only reveals pre-fetched items; it doesn't fetch all available products from the database. Same issue on `ShopHome` category browsing — capped at 200 per page with no aggressive prefetch.

2. **Ad banners showing as product images**: Many catalog items have eBay seller banners, Amazon "Renewed" badges, promotional template images stored as `image_url`. The current `isRenderableImageUrl` filter catches some but misses common patterns like eBay description images (`/i.ebayimg.com/images/g/` with banner content), Amazon "certified renewed" badges, and generic promotional overlays with text like "free shipping", "best seller", etc.

### Plan

#### 1. `CategoryResultsPage.tsx` — Unlimited batch loading
- Remove `POOL_TARGET` cap (or set to `Infinity`)
- Increase `VISIBLE_STEP` from 48 to 200 (show 200 products at a time)
- On initial load: fetch first 200, show immediately
- Background: continue fetching 200-item batches until exhausted (no cap on requests)
- "Load More" button: reveals next 200 from pre-fetched pool AND triggers more fetches if nearing the end
- Show count like "Showing 200 of 1,432 products"

#### 2. `ShopHome.tsx` category browsing — Same pattern
- When category filter is active, auto-fetch subsequent pages in background after first page loads
- "Load More" continues to work for revealing + fetching more

#### 3. `imageValidation.ts` — Block more ad/banner patterns
Add blocked patterns for:
- eBay description-area banners: URLs containing `descriptionimage`, `seller_pic`, `/00/s/` with very wide ratios
- Amazon "Certified Renewed" / "Amazon Renewed" badge images
- Generic promo text images: URLs with `free-shipping`, `best-seller`, `satisfaction`, `warranty-badge`
- SHEIN promotional banners: `sheinsz.ltwebstatic.com` promo paths
- Images with `logo`, `badge`, `stamp` in the filename (not in the domain)

### Files to modify
1. **`src/pages/shop/CategoryResultsPage.tsx`** — Remove pool cap, increase visible step to 200, keep fetching until DB exhausted
2. **`src/pages/shop/ShopHome.tsx`** — Auto-fetch more category pages in background after initial load
3. **`src/lib/imageValidation.ts`** — Add ~15 more blocked tokens for ad banners and promotional images

