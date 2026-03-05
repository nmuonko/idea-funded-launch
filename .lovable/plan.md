

## Diagnosis: Firecrawl Credit Drain & Missing Catalog Persistence

### Problem 1: Firecrawl Credit Hemorrhage (5,381 credits from ~5 requests)

The credit explosion is NOT from paste-link alone. There are **three major Firecrawl consumers** running simultaneously:

1. **`catalog-shein-scraper`** (cron) — runs 25 Firecrawl Search queries per cycle (each with `limit: 50`), triggered every 15 minutes. Each search call costs credits. 25 queries × multiple cron runs = thousands of credits/day.

2. **`catalog-car-scraper`** (cron) — runs 20 Firecrawl Search queries per cycle for CarGurus/Carvana, also on a frequent schedule.

3. **`catalog-product` gallery enrichment** — every time a user views a product with ≤2 images, it triggers Firecrawl scrape fallbacks for eBay, Amazon, SHEIN, etc. This fires on *every product detail view* for items with sparse galleries.

4. **`extract-price`** — for a single paste-link request, the worst case fires **up to 3 Firecrawl calls**: `extractViaFirecrawlFull` (bot-blocked path), `extractWithOcr` (OCR path uses Firecrawl), and then the image-only fallback at line 2048-2054 if price was found but no image.

5. **`get-product-info`** — called separately from `extract-price` by the frontend via `PasteLink.tsx`. For a bot-blocked store, it also calls `scrapeViaFirecrawl` (line 1423). So a single paste-link action triggers BOTH `extract-price` AND `get-product-info`, each independently calling Firecrawl.

**Root cause**: The frontend calls `extract-price` only (line 71 of PasteLink.tsx). But `extract-price` itself can make up to 3 Firecrawl calls per request. Combined with background scrapers running on cron, credits drain fast.

### Problem 2: Paste-Link Extractions Not Saved to Catalog

`extract-price` DOES call `saveToCatalogItems` (line 2086) — but only when `price > 0`. For SHEIN/dynamic stores where `price = 0` is returned for manual entry, the save is skipped (line 967: `if (!price || price <= 0) return`). So SHEIN products entered via paste-link with manual price are never persisted.

### Problem 3: Images Not Extracting

SHEIN and many SPA stores return bot-blocked HTML on direct fetch. Firecrawl is the fallback, but with `waitFor: 5000` and SHEIN's heavy JS, images may still not load. The `extractProductInfo` function in `extract-price` already has multi-layer extraction, but the `get-product-info` Firecrawl call uses `formats: ['markdown', 'html']` which may not render JS-loaded images.

---

### Plan

#### 1. Stop the credit hemorrhage — Disable/throttle background scrapers
- **Pause** `catalog-shein-scraper` and `catalog-car-scraper` cron jobs (they're the biggest consumers)
- **Disable** gallery enrichment Firecrawl fallbacks in `catalog-product` — only use direct fetch, skip Firecrawl for gallery enrichment entirely
- **Cap** Firecrawl calls in `extract-price` to **maximum 1 per request**: remove the separate "image-only" Firecrawl fallback (lines 2048-2054) and the OCR Firecrawl call

#### 2. Fix catalog persistence for manual-price items
- In `saveToCatalogItems`, remove the `price <= 0` early return
- Allow saving items with `price = 0` to catalog (the user will enter price manually, and the item still has title/image/URL worth persisting)
- After user applies manual price in `PasteLink.tsx`, update the catalog item with the real price

#### 3. Consolidate Firecrawl calls — single call per paste-link
- In `extract-price`, when Firecrawl is invoked for bot-blocked/HTTP-error stores, extract price + image + title from a single call (already done)
- Remove the redundant image-only Firecrawl fallback at the end of the function (lines 2048-2058)
- Ensure `extractWithOcr` does NOT call Firecrawl (it calls `api.firecrawl.dev/v1/scrape` at line 695) — disable this path or replace with regex-only extraction

#### 4. Improve image extraction without extra Firecrawl calls
- In `extractViaFirecrawlFull`, request `formats: ['html']` (already done) and ensure SHEIN CDN patterns are checked
- The existing multi-layer extraction logic is sufficient — the issue is that images are fetched but the response isn't making it back to the frontend properly

### Files to modify:
1. `supabase/functions/extract-price/index.ts` — remove redundant Firecrawl calls, fix catalog save
2. `supabase/functions/catalog-product/index.ts` — disable Firecrawl gallery enrichment fallbacks
3. `src/pages/shop/PasteLink.tsx` — persist manual price to catalog after user applies it

