

## Fix: Product Details Showing Only 1 Image for SHEIN, Carvana, CarGurus

### Root Cause

**Two-layer problem:**

1. **Scrapers only store `image_url` (single image)** — neither `catalog-shein-scraper` nor `catalog-car-scraper` populate the `images` JSONB array column. They only set `image_url` (one image). The upsert rows don't include an `images` field at all.

2. **Gallery enrichment fails silently** — when `catalog-product` detects <= 2 images, it tries `scrapeProviderGalleryFromPage()` which does a direct HTTP fetch to SHEIN/Carvana/CarGurus. These sites block direct scraping (bot protection), returning 403 or empty HTML. The Firecrawl fallback is deliberately disabled to conserve credits. Result: enrichment always fails, user sees 1 image.

### Plan

#### 1. Extract ALL images during scraping (not just one)

**`catalog-shein-scraper/index.ts`**: Extract all product images from the Firecrawl markdown using `matchAll` instead of `match`. Store them in the `images` JSONB array column during upsert.

```
// Extract ALL product images from markdown (not just first)
const allImgMatches = [...markdown.matchAll(
  /(https?:\/\/img\.ltwebstatic\.com\/images\d*\/(?:items|product|pi)\/[^\s)"]+)/gi
)];
const allImages = allImgMatches
  .map(m => m[1])
  .filter(url => !/_thumbnail_/i.test(url) && !/banner/i.test(url));
// Deduplicate
const uniqueImages = [...new Set(allImages)].slice(0, 10);
```

Add `images: uniqueImages.length > 0 ? uniqueImages : [imageUrl]` to the upsert row.

**`catalog-car-scraper/index.ts`**: Same pattern — extract all image URLs from markdown, store in `images` array. For Carvana, also generate multiple angle URLs from the vehicle ID (Carvana has predictable image URL patterns for different angles).

#### 2. Re-enable Firecrawl gallery enrichment for DB-only providers (budget-controlled)

In `catalog-product/index.ts`, re-enable `scrapeProviderGalleryFirecrawl()` as fallback when direct scrape fails, but only if:
- The item has <= 1 image (not <= 2, to reduce calls)
- Provider budget check passes (use existing `check_provider_budget` with a small daily cap like 100 credits for gallery enrichment)

This ensures first-time product views get full galleries while staying within credit budget.

#### 3. Persist enriched galleries back to `images` column

Already implemented in current code (lines 1155-1171) — no changes needed here. Once enrichment succeeds, it writes back to `catalog_items.images` and `catalog_item_media`.

### Files to modify

1. **`supabase/functions/catalog-shein-scraper/index.ts`** — Extract all images from markdown, add `images` array to upsert
2. **`supabase/functions/catalog-car-scraper/index.ts`** — Extract all images from markdown, add `images` array to upsert; add Carvana multi-angle URL generation
3. **`supabase/functions/catalog-product/index.ts`** — Re-enable Firecrawl gallery fallback for shein/cargurus/carvana with budget cap (100/day)

### Expected Result
- New scraped items will have 3-10 images stored at ingestion time
- Existing 1-image items will get enriched on first detail view (up to 100/day via Firecrawl)
- Product detail pages will show full image galleries

