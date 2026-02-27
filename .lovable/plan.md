

# Fix Missing Images for SHEIN, Carvana, and CarGurus Products

## Problem Summary
- **SHEIN**: All 6 items have bad image URLs (banner thumbnails, category page HTML URLs, or generic site images). None show actual product photos.
- **CarGurus**: 23 of 55 items have no image or placeholder SVGs that get filtered out.
- **Carvana**: 2 of 54 items have no image, and the fallback pattern doesn't work because product IDs are `hash-XXXXX` format (not numeric).

## Root Causes
1. SHEIN items are mostly **category pages** (e.g., "Women Skirts - SHEIN Canada"), not individual products. The scraper saved page URLs as `image_url`.
2. The fabricated SHEIN CDN fallback URL pattern (`images3_pi/2024/01/01/00/...`) doesn't resolve to real images.
3. CarGurus/Carvana items scraped via Firecrawl sometimes lack embedded images in the markdown.
4. The Carvana `standardizedHero.jpg` fallback requires numeric IDs but stored IDs are hashes.

---

## Plan

### 1. Clean up bad SHEIN data from database
Delete the 6 existing SHEIN items that are category pages (not actual products). They have titles like "Women Skirts | SHEIN" and "Plus Size Dresses | SHEIN" with no real product data.

### 2. Fix SHEIN scraper to reject category pages and extract better images
**File**: `supabase/functions/catalog-shein-scraper/index.ts`

- Add URL validation: reject URLs matching category patterns (`-cat-\d+\.html`, pages with no specific product content).
- Validate titles: reject items whose title is just a category name (e.g., matches `^(Women|Men|Plus Size)\s+(Skirts|Dresses|Tops)\s*[|-]`).
- For image extraction: after all current fallbacks fail, try fetching the product page via Firecrawl scrape to get the actual og:image or product hero.

### 3. Fix CarGurus/Carvana missing images -- hide items without images
**File**: `src/pages/shop/ShopHome.tsx`

- Update the product mapping to **skip items without a renderable image** instead of showing `/placeholder.svg`. This ensures only products with actual photos appear in the grid.
- Add SVG placeholder URLs to the `isRenderableImageUrl` blocklist (e.g., `no-image-placeholder` pattern from CarGurus).

### 4. Improve `isRenderableImageUrl` filter
**File**: `src/pages/shop/ShopHome.tsx`

- Block generic SHEIN site images (`/v4/p/ccc/` paths which are site chrome, not product images).
- Block CarGurus `no-image-placeholder` SVG URLs.
- Remove the broken SHEIN CDN fallback from `deriveProviderImageFallback` (it generates URLs that don't resolve).

### 5. Deploy updated scraper and trigger a fresh run
- Deploy the fixed SHEIN scraper.
- The next cron cycle (every 15 min) will start ingesting real SHEIN product items with valid images.

---

## Technical Details

### Database cleanup SQL
```sql
DELETE FROM catalog_items 
WHERE provider = 'shein' 
  AND (
    title ~ '^(Women|Men|Plus Size)\s+\w+\s*[\|–-]\s*SHEIN'
    OR product_url LIKE '%-cat-%'
  );
```

### Updated `isRenderableImageUrl` additions
- `lower.includes('no-image-placeholder')` -- CarGurus placeholder
- `lower.includes('/v4/p/ccc/')` -- SHEIN site chrome images

### Product filtering change
Instead of `preferred || '/placeholder.svg'`, filter out items where `preferred` is null/empty so only products with real images display.

### Files to edit
1. `src/pages/shop/ShopHome.tsx` -- Image filter improvements + hide imageless products
2. `supabase/functions/catalog-shein-scraper/index.ts` -- Reject category pages, improve validation

