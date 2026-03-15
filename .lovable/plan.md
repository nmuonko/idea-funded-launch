

# Fix: 1,471 SHEIN Items Missing from Frontend

## Root Cause

The admin portal counts **all** 2,428 SHEIN items regardless of data quality. The frontend filters by `price_usd > 0 AND image_url IS NOT NULL`, which excludes **1,408 items with NULL prices** and **11 with no images**.

The SHEIN scraper has two modes:
- **Full search** (`searchSheinProducts`): extracts price from markdown content — often fails because SHEIN renders prices via JavaScript
- **Light search** (`searchSheinProductsLight`): explicitly sets `price_usd: 0` and `image_url: ""` — these items are ingested but never visible

These price-less items sit in the database permanently since no background job backfills their prices.

## Plan

### 1. Add a SHEIN price backfill pass to `catalog-shein-scraper`

After the main ingestion loop, query for SHEIN items where `price_usd IS NULL` (limit ~50 per run). For each, call `extract-price` edge function with the stored `product_url` to fetch the live price. Update `catalog_items` with the retrieved price and image.

### 2. Prevent ingesting zero-price items without a backfill path

In `upsertProducts`, change the upsert behavior: when `price_usd` is 0/null on a **new** item, still insert it (for discovery), but when updating an **existing** item that already has a valid price, never overwrite it with null. Use the SQL `COALESCE` pattern via conditional upsert logic.

### 3. One-time bulk backfill via SQL + extract-price

Create a small utility in the scraper that can be triggered manually (via admin action `backfill-shein-prices`) to process the existing 1,408 priceless items in batches of 50, calling `extract-price` for each.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/catalog-shein-scraper/index.ts` | Add price backfill pass after ingestion; add `backfill-shein-prices` action handler |
| `supabase/functions/admin-catalog-items/index.ts` | Add `backfill-shein-prices` admin action route |

### Alternative: Quick-win approach

If `extract-price` is too slow or rate-limited for 1,400 items, a faster alternative:
- Run a single SQL update to set `is_active = false` on items with `price_usd IS NULL AND provider = 'shein'` so admin counts match frontend counts
- Then the ongoing scraper will re-activate them when prices are eventually found

This keeps the admin portal honest about what's actually displayable.

