

## Problem Analysis

Three interconnected issues with SHEIN:

### 1. SHEIN Scraper Produces Almost No Products (71 active, 33 with swatch images)
- **Root cause**: The `catalog-shein-scraper` Edge Function is **timing out** (context canceled). The function has a 240s hard cap but Firecrawl search with `waitFor: 5000` is too slow, and the function likely exceeds Edge Function limits.
- 33 of 71 products (46%) have `/v4/p/ccc/` color swatch URLs instead of real product images -- these are useless.
- The cron runs every 2 hours but produces near-zero items per run.

### 2. Paste-Link SHEIN Extraction Fails for Images
- The screenshot shows a SHEIN product extracted with a swatch image (`/v4/p/ccc/...`) instead of the actual product photo.
- The `extractProductInfo` function correctly has SHEIN CDN fallback patterns but they look for `/images*/items|product|pi/` paths -- swatch URLs use `/p/ccc/` which passes through.
- Need to explicitly block `/v4/p/ccc/` URLs in image extraction and prioritize `/images3/` gallery URLs.

### 3. SHEIN Needs to Be the Largest Firecrawl Store
- Currently: eBay 667K, CarGurus 1.2K, Carvana 391, SHEIN 71, Amazon 1.
- Target: SHEIN should have the most products among Firecrawl-sourced stores (excluding eBay which uses Browse API).

## Plan

### Task 1: Fix SHEIN Image Quality (Scraper + Extract-Price)

**In `catalog-shein-scraper/index.ts`:**
- Add `/v4/p/ccc/` to the image blocklist in `firecrawlSearch()` (line ~330). Any image matching this pattern should be rejected.
- Remove `waitFor: 5000` from the search scrapeOptions (line 261) -- Firecrawl Search API doesn't need it (it's not scraping individual pages, just searching).
- This should fix the timeout issue and massively increase throughput.

**In `extract-price/index.ts`:**
- In the SHEIN CDN fallback (line ~468-479), explicitly reject `/v4/p/ccc/` URLs as color swatches.
- In the image normalization section (line ~557), add a swatch rejection filter.
- Prefer `og:image` and `images3/` patterns over generic CDN matches for SHEIN.

**Database cleanup:**
- Run a migration to deactivate all SHEIN items with `/v4/p/ccc/` swatch images.

### Task 2: Scale SHEIN Scraper Volume

**In `catalog-shein-scraper/index.ts`:**
- Increase `DEFAULT_QUERIES_PER_RUN` from 8 to 15.
- Increase `DAILY_CREDIT_CAP` from 3,000 to 5,000.
- Remove `scrapeOptions: { formats: ["markdown"], waitFor: 5000 }` from the search API call -- this is the main cause of timeouts and credit waste. Firecrawl Search returns title, URL, description natively without scraping.
- Change cron from every 2 hours to every 1 hour.
- Add more women's fashion-focused seed queries (currently ~60% of queries are women's clothing, increase to ~75%).

**Update cron schedule:**
- SQL migration to change `shein-scraper-15m` from `0 */2 * * *` to `0 * * * *` (every hour).

### Task 3: Clean Up Existing Bad SHEIN Data

- SQL migration to set `is_active = false` for SHEIN items with swatch images (`image_url LIKE '%/v4/p/ccc/%'`).
- SQL migration to set `is_active = false` for SHEIN items with duplicate swatch images (same image across multiple products).

### Technical Details

**Swatch URL pattern to block:**
```
/v4/p/ccc/   → color swatch thumbnails (not product photos)
```

**Valid SHEIN product image patterns:**
```
/images3/items/   → product gallery photos ✓
/images3/product/ → product photos ✓  
/images3/pi/      → product images ✓
```

**Firecrawl Search API optimization:**
The Search endpoint returns structured results (title, url, description) without needing to scrape each page. Removing `scrapeOptions` eliminates the 5s render wait per result, reducing credit consumption by ~50% and fixing the timeout.

**Expected outcome after changes:**
- Each hourly run: 15 queries × ~10 valid products = ~150 new products/hour
- Daily: ~3,600 new products/day (vs current ~0)
- Within 1 week: SHEIN should have 5,000+ products, surpassing CarGurus (1,243)

