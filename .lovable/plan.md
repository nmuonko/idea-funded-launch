

# Fix: Ensure Full Product Gallery for All Products

## Problem
Some products on both web and mobile show only 1 image because:
1. Search ingestion stores only `image_url` (single thumbnail) -- the `images` jsonb column stays `[]`
2. The on-demand gallery enrichment in `catalog-product` tries to scrape Amazon/eBay/SHEIN pages but often fails due to bot detection (captcha, 403s)
3. No `catalog_item_media` cached gallery exists for these items

Products that DO have galleries work fine (backend returns 10+ images). The gap is items ingested without gallery data where live scraping fails.

## Solution: Two-Part Fix

### Part 1: Improve Gallery Scraping Success in `catalog-product/index.ts`

**A. Add Firecrawl fallback for eBay gallery** (currently only Amazon has Firecrawl fallback):
- When eBay direct scrape fails or returns 0 images, try Firecrawl as a fallback (same pattern as Amazon)

**B. Add Firecrawl fallback for SHEIN/CarGurus/Carvana galleries**:
- Currently `scrapeProviderGalleryFromPage` does direct fetch which gets bot-blocked
- Add Firecrawl as a fallback when direct scrape returns 0 images

**C. Widen the enrichment trigger from `<= 1` to `<= 2` images**:
- Some items have 2 images (main + a duplicate/variant) but deserve a full gallery
- Change threshold from `(item.images?.length || 0) <= 1` to `<= 2` for all providers

### Part 2: Pre-populate galleries during ingestion (scraper improvement)

**D. Update the search ingestion in `catalog-search/index.ts`**:
- When ingesting Amazon results from Rainforest API, extract ALL images from the `images` array in the API response (not just the first one)
- Store them in the `images` jsonb column during upsert
- This ensures new products enter the DB with full galleries from day one

### Files to edit
- `supabase/functions/catalog-product/index.ts` -- Add Firecrawl fallbacks for eBay/SHEIN, widen enrichment threshold
- `supabase/functions/catalog-search/index.ts` -- Extract and store full image arrays during ingestion

### What stays the same
- Web frontend gallery rendering (already works when images are available)
- Mobile app behavior (reads `images` array from API response)
- Existing gallery enrichment for Amazon (already has Firecrawl fallback)
- Image upgrade/optimization logic
