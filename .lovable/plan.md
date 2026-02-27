
# Fix SHEIN, CarGurus & Carvana: Scraping Volume + Missing Images

## Problems Identified

1. **Cron jobs are silently failing (auth rejection)**: All 3 cron jobs (`shein-scraper-15m`, `car-scraper-cargurus-15m`, `car-scraper-carvana-15m`) pass the **anon key** as `Authorization: Bearer`, but the scrapers require either a `x-cron-secret` header or admin-level JWT. The anon key fails the admin check, so scrapers return 401 on every cron run. This is why SHEIN has only 6 items and car providers have limited items.

2. **SHEIN images are bad quality**: The 6 SHEIN items in the DB have image URLs that are either banner thumbnails (`_thumbnail_126x.webp`) or even HTML page URLs stored as `image_url`. The frontend's `isRenderableImageUrl` filter correctly rejects these, showing broken/placeholder images.

3. **CarGurus/Carvana missing images**: ~40% of car listings have empty `image_url` because Firecrawl's markdown response doesn't always contain embedded images. The frontend has a Carvana hero URL derivation but only for Carvana, not for CarGurus.

---

## Implementation Plan

### Step 1: Fix cron job authentication (root cause)

**What**: Update all 3 `pg_cron` jobs to include the `x-cron-secret` header instead of relying on the anon key for auth.

**How**: Drop and recreate the 3 cron jobs with the correct `x-cron-secret` header using `CRON_SECRET` or the fallback value already in the scraper code.

**SQL migration**: Recreate the 3 cron jobs with headers including `"x-cron-secret": "afrishop-internal-cron-2026"`.

### Step 2: Fix SHEIN image extraction in scraper

**File**: `supabase/functions/catalog-shein-scraper/index.ts`

**Changes**:
- Filter out non-product URLs before upsert: reject URLs that are category pages (e.g., `/Women-Skirts-p-XXXXX-cat-XXXX.html` without a valid product ID pattern).
- Improve image extraction: prioritize `img.ltwebstatic.com` URLs that contain `/items/` or `/product/` paths (actual product images), and reject banner/thumbnail URLs (`_thumbnail_`, `/banner`).
- Add a fallback image URL derivation using SHEIN's CDN pattern when no image is found from markdown.

### Step 3: Fix CarGurus/Carvana image extraction in scraper

**File**: `supabase/functions/catalog-car-scraper/index.ts`

**Changes**:
- **Carvana**: When no image is found in markdown, derive the hero image URL using the known pattern: `https://vexgateway.fastly.carvana.io/{productId}/standardizedHero.jpg?width=800`
- **CarGurus**: When no image is found in markdown, try the `static.cargurus.com` image pattern from the listing URL metadata, or attempt a secondary image extraction from the markdown using CarGurus-specific patterns.
- Both: Add `waitFor: 3000` to the Firecrawl search to allow JS-rendered content (including images) to load.

### Step 4: Fix frontend image fallback for all providers

**File**: `src/pages/shop/ShopHome.tsx`

**Changes**:
- Extend `deriveProviderImageFallback` to handle SHEIN items: derive a product image URL from the `provider_product_id` using SHEIN's CDN pattern.
- Ensure the fallback is applied consistently in all rendering paths (store grid, search results).

### Step 5: Backfill existing items with missing images

**File**: `supabase/functions/backfill-product-images/index.ts` (existing function)

**Changes**:
- Add logic to backfill Carvana items using the `standardizedHero.jpg` pattern for items currently missing `image_url`.
- Run a one-time DB update to set `image_url` for all Carvana items that have a numeric `provider_product_id` but empty `image_url`.

---

## Technical Details

### Cron job SQL (Step 1)
```sql
-- Drop old jobs
SELECT cron.unschedule('shein-scraper-15m');
SELECT cron.unschedule('car-scraper-cargurus-15m');
SELECT cron.unschedule('car-scraper-carvana-15m');

-- Recreate with x-cron-secret header
SELECT cron.schedule('shein-scraper-15m', '*/15 * * * *', $$
  SELECT net.http_post(
    url:='https://...functions/v1/catalog-shein-scraper',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  );
$$);
-- (similar for cargurus and carvana)
```

### Image backfill SQL (Step 5)
```sql
UPDATE catalog_items 
SET image_url = 'https://vexgateway.fastly.carvana.io/' || provider_product_id || '/standardizedHero.jpg?width=800'
WHERE provider = 'carvana' 
  AND (image_url IS NULL OR image_url = '')
  AND provider_product_id ~ '^\d+$';
```

### Expected Outcome
- Cron jobs will authenticate successfully and run every 15 minutes
- SHEIN will grow from 6 to hundreds of items per day (targeting 300/run)
- CarGurus/Carvana will grow similarly with each 15-minute run
- All providers will have valid product images displayed in the frontend
