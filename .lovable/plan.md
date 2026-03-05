

## Re-enable Scrapers with Controlled Firecrawl Budget

### Credit Economics

Firecrawl Search API costs **1 credit per search result returned**. With `limit: 50`, each search query costs up to **50 credits**.

Current scraper settings:
- **SHEIN**: 25 queries/run × 50 results = **1,250 credits/run**
- **CarGurus**: 20 queries/run × 50 results = **1,000 credits/run** (runs for both cargurus + carvana = 2,000)
- **Total per cron cycle**: ~3,250 credits

If running every 15 minutes (96 times/day): **312,000 credits/day** — clearly unsustainable.

### Smart Budget Plan

Reduce queries per run and increase cron interval to stay within a daily budget:

| Scraper | Queries/Run | Limit/Query | Credits/Run | Interval | Runs/Day | Credits/Day | Expected Products/Day |
|---------|------------|-------------|-------------|----------|----------|-------------|----------------------|
| SHEIN | 5 | 20 | ~100 | 2 hours | 12 | ~1,200 | 200-400 |
| CarGurus | 3 | 20 | ~60 | 3 hours | 8 | ~480 | 80-150 |
| Carvana | 3 | 20 | ~60 | 3 hours | 8 | ~480 | 80-150 |
| **Total** | | | | | | **~2,160** | **360-700** |

Reserve **~800 credits/day** for paste-link usage (max 1 Firecrawl call per paste = ~50 credits each = 16 paste-link requests/day).

**Total daily budget: ~3,000 credits/day** — sustainable on a standard Firecrawl plan.

### Is This Smart?

Yes, this is the right approach:
1. **Background scrapers** build the catalog passively — users see products instantly from cache
2. **Paste-link** is the fallback for items not in the catalog — reserved credits ensure it always works
3. **Diminishing returns**: After the first week, most queries will hit existing products (deduplication via `provider,provider_product_id` unique constraint), so net new items slow down naturally
4. **Images**: The scrapers already extract images from markdown. Items without images are dropped (`no_image` drop reason). No extra Firecrawl calls needed for image enrichment.

### Plan

#### 1. Re-enable SHEIN scraper with throttled settings
- Remove the early-return disabled block
- Reduce `DEFAULT_QUERIES_PER_RUN` from 25 to **5**
- Reduce `FIRECRAWL_SEARCH_LIMIT` from 50 to **20**
- Add provider budget check (`check_provider_budget`) with daily cap of **1,500 credits**

#### 2. Re-enable car scraper with throttled settings
- Remove the early-return disabled block
- Reduce `DEFAULT_QUERIES_PER_RUN` from 20 to **3**
- Reduce `FIRECRAWL_SEARCH_LIMIT` from 50 to **20**
- Add provider budget check with daily cap of **1,000 credits** per provider

#### 3. Update cron schedules
- Change SHEIN scraper cron from every 15 minutes to **every 2 hours**
- Change car scraper cron from every 15 minutes to **every 3 hours** (alternating cargurus/carvana)

#### 4. Keep paste-link Firecrawl budget separate
- Already capped at 1 Firecrawl call per request (from previous fix)
- No changes needed

### Files to modify
1. `supabase/functions/catalog-shein-scraper/index.ts` — Re-enable with throttled constants + budget check
2. `supabase/functions/catalog-car-scraper/index.ts` — Re-enable with throttled constants + budget check
3. Update pg_cron schedules via SQL (change intervals)

### Expected Output
- **Week 1**: ~350-700 new unique products/day across all 3 providers
- **After Week 1**: Slows to ~100-300/day as duplicates increase
- **Paste-link**: ~16 requests/day guaranteed from reserved credits

