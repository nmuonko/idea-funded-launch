

## Plan: Remove Ad/Banner Images from Catalog — Current and Future

### Problem Summary
Products across the catalog (especially Audio & Music, Carvana vehicles, SHEIN) sometimes display promotional banners, seller logos, or non-product images instead of actual product photos. This happens because:

1. **At ingestion time**: Scrapers and ingest workers store `image_url` directly from source data without validating if it's a real product photo (e.g., Carvana's `promoBanners/priceDrop/mobile.png`, SHEIN's `banner3/..._thumbnail_126x.webp`)
2. **In DB queries**: Backend functions that serve items (`catalog-home`, `catalog-search`, `sectionProfiles`, `mobileSectionsCache`) check `image_url IS NOT NULL` but never validate the URL's content type
3. **Client-side filtering is incomplete**: The frontend `isRenderableImageUrl` correctly blocks many bad patterns, but it only filters at display time — bad images still occupy slots that could go to valid products

### Current State (from DB analysis)
- **401K active items**, 21K with NULL `image_url`
- Only **21 items** match obvious banner URL patterns (12 Carvana `promoBanners`, 6 CarGurus, 2 Rainforest, 1 SHEIN)  
- **13 items** have suspiciously tiny/extreme-ratio dimensions in their URLs
- The real issue is that many more subtle banner images pass URL-based heuristics (eBay seller template photos, promotional composite images) and need runtime image-dimension checking or better URL pattern matching

### Implementation Plan

#### Step 1: Create shared `isValidProductImageUrl` utility for edge functions
Create `supabase/functions/_shared/imageValidator.ts` with the same logic as the frontend `isRenderableImageUrl`, plus additional server-side patterns. This mirrors what's already in `catalog-product/index.ts` as `isLikelyRealImage` but is more comprehensive.

Blocked patterns:
- Carvana `merchui/images`, `promoBanners`, `heliosconditionaltiles`
- SHEIN `_thumbnail_126x`, `banner`
- eBay non-standard paths (not `/d/`, `/g/`, or `/s-l`)
- SVG, GIF files
- URLs with extreme aspect ratios (`>2.2` or `<0.45`)
- Seller branding keywords (`shoplogo`, `storelogo`, `brandlogo`, `watermark`, `promo_banner`, etc.)

#### Step 2: Apply image validation at all ingestion points
Add `isValidProductImageUrl` check before storing `image_url` in these files:
- `supabase/functions/_shared/searchAutoCache.ts` — `autoCacheLiveResults()` (line 100: `image_url: mainImage`)
- `supabase/functions/_shared/ebayFetcher.ts` — eBay upsert (line 216)
- `supabase/functions/catalog-amazon-ingest-worker/index.ts` — Amazon upsert (lines 387, 423, 582)
- `supabase/functions/catalog-car-scraper/index.ts` — Car scraper upsert (line 358)
- `supabase/functions/catalog-prewarm-worker/index.ts` — Prewarm upsert (line 566)
- `supabase/functions/catalog-collection/index.ts` — Collection upsert (line 592)
- `supabase/functions/catalog-data-sync/index.ts` — Data sync import (line 98)

For each: if `isValidProductImageUrl(image_url)` returns false, set `image_url` to `null`. Products with null images will still be stored (for later image enrichment) but will be filtered out of query results by the existing `image_url IS NOT NULL` checks.

#### Step 3: Apply image validation at query/serving time
Add filtering in the functions that serve items to clients:
- `supabase/functions/_shared/homeRecipeBuilder.ts` — `fetchItemsFromDB()` (line 302: add `isValidProductImageUrl` check)
- `supabase/functions/_shared/sectionProfiles.ts` — `backfillForProfile()` mapped items
- `supabase/functions/_shared/mobileSectionsCache.ts` — `backfillForProfile()` mapped items
- `supabase/functions/_shared/searchDbFirst.ts` — `mapDbItem()` (line 73)

#### Step 4: Purge existing bad images from database
Run a SQL UPDATE to null out `image_url` on the ~21+ known bad items, and also set `image_url = NULL` on any items matching the broader pattern list. This ensures they won't show up until a valid image is fetched by the enrichment pipeline.

```sql
UPDATE catalog_items
SET image_url = NULL, updated_at = now()
WHERE is_active = true
  AND image_url IS NOT NULL
  AND (
    lower(image_url) LIKE '%_thumbnail_126x%'
    OR lower(image_url) LIKE '%/banner%'
    OR lower(image_url) LIKE '%promobanner%'
    OR lower(image_url) LIKE '%promo_banner%'
    OR lower(image_url) LIKE '%watermark%'
    OR lower(image_url) LIKE '%shoplogo%'
    OR lower(image_url) LIKE '%storelogo%'
    OR lower(image_url) LIKE '%brandlogo%'
    OR lower(image_url) LIKE '%icon_only%'
    OR lower(image_url) LIKE '%assets.fastly.carvana.io/merchui/images%'
    OR lower(image_url) LIKE '%pt.ispot.tv%'
    OR lower(image_url) LIKE '%.svg%'
    OR lower(image_url) LIKE '%.gif%'
    OR lower(image_url) LIKE '%seller_banner%'
    OR lower(image_url) LIKE '%sellerbanner%'
    OR lower(image_url) LIKE '%hero_banner%'
    OR lower(image_url) LIKE '%ad_banner%'
    OR lower(image_url) LIKE '%vitalhealthy%'
    OR lower(image_url) LIKE '%vital_health%'
  );
```

#### Step 5: Ensure frontend shows placeholder for null images
The existing `isValidProduct` check (`p.imageUrl`) already excludes null-image products from grid display. For the user's preference of showing a placeholder instead, update the `ProductCard` component (or wherever the grid renders) to show a "No image available" placeholder when `imageUrl` is empty/null rather than hiding the product entirely. However, since the `isValidProduct` filter runs before rendering, the cleaner approach is to keep filtering them out of the 4-product category grids (where space is premium) but show placeholders in full grid/search views.

### Files to Create
- `supabase/functions/_shared/imageValidator.ts`

### Files to Modify
- `supabase/functions/_shared/searchAutoCache.ts`
- `supabase/functions/_shared/ebayFetcher.ts`
- `supabase/functions/catalog-amazon-ingest-worker/index.ts`
- `supabase/functions/catalog-car-scraper/index.ts`
- `supabase/functions/catalog-prewarm-worker/index.ts`
- `supabase/functions/catalog-collection/index.ts`
- `supabase/functions/catalog-data-sync/index.ts`
- `supabase/functions/_shared/homeRecipeBuilder.ts`
- `supabase/functions/_shared/sectionProfiles.ts`
- `supabase/functions/_shared/mobileSectionsCache.ts`
- `supabase/functions/_shared/searchDbFirst.ts`

### Database Change
- One UPDATE statement to purge existing bad `image_url` values

