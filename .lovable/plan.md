## SHEIN Price Backfill System (Complete)

### Problem
Admin portal showed 2,428 SHEIN items but frontend only displayed 957. Root cause: 1,408 items had `NULL` prices and 11 had no images, filtered out by frontend's `price_usd > 0 AND image_url IS NOT NULL` requirement.

### Changes Made

1. **`catalog-shein-scraper/index.ts`** — Three fixes:
   - **COALESCE upsert**: `upsertProducts` now checks existing items before upsert. Never overwrites a valid `price_usd` or `image_url` with null/0.
   - **Auto-backfill pass**: After each regular scrape run, if time allows (>30s left), backfills up to 10 priceless items via `extract-price` edge function.
   - **`backfill-prices` action**: New action handler processes up to 100 priceless items per call via `extract-price`.

2. **`admin-catalog-items/index.ts`** — New `backfill-shein-prices` admin action routes to the scraper's backfill action for manual batch processing.

### Usage
- **Automatic**: Every 15-minute cron run now auto-backfills ~10 priceless items
- **Manual**: Admin can trigger `POST ?action=backfill-shein-prices` with `{ batch_size: 50 }` to process larger batches

### Previous Work
- Unified Search Pipeline (web + mobile parity)
- Edge Function Consolidation (42 functions deleted)
- Payment flow RLS fixes
