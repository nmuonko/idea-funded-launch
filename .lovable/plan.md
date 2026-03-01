

# Maximize Rainforest API Credits for Amazon Catalog Growth

## Current State
- **Budget**: 10,000 Rainforest credits/month, 14/hour
- **Seed list**: Only 31 Congo/DRC queries (mostly phones + electronics)
- **Cron run**: Processes 10 queue items + 10 seeds per run = ~20 API calls/run
- **Paste Link**: Uses Firecrawl (primary) with Rainforest as fallback (8s timeout) -- this is already correct
- **Problem**: With only 31 seed queries and conservative hourly limits, you're barely using your 10k credits

## What Changes

### 1. Expand seed queries to 300+ high-demand products across all categories
Currently only phones, power banks, and laptops are seeded. We'll add seeds for:
- **Fashion**: Nike, Adidas, sneakers, dresses, African print, jewelry
- **Beauty**: Hair extensions, wigs, skincare, perfumes
- **Home**: Cookware, bedding, curtains, home decor
- **Kids/Baby**: Diapers, baby clothes, toys, school supplies
- **Health**: Supplements, vitamins, first aid
- **Auto**: Car accessories, LED lights, phone mounts
- **Gaming**: PS5, Xbox, Nintendo Switch, gaming headsets
- **Appliances**: Blenders, rice cookers, irons, fans

This ensures every category in your catalog gets fresh Amazon products.

### 2. Increase hourly rate limit from 14 to 50
With 10k credits and ~30 days, that's ~333 calls/day or ~14/hour if spread evenly. But the cron runs periodically -- bumping to 50/hour lets each run process more items while the monthly cap of 9,000 (reserving 1k for queue/paste-link misses) prevents overspend.

### 3. Process more items per cron run: 10 queue + 30 seeds
Currently processes 10+10=20 per run. We'll increase seeds per run to 30, so each cron execution indexes up to ~600 new products (30 searches x 20 results each).

### 4. Keep Firecrawl-only for Paste Link (remove Rainforest fallback)
Since you want Firecrawl for all link lookups, we'll remove the Rainforest fallback from `extract-price` for Amazon paste-link. This saves ~1k credits/month for catalog building instead.

### 5. Reserve 1,000 credits for queue items (paste-link cache misses)
When someone pastes an Amazon link that's not in the catalog, the ASIN gets enqueued. These queue items get priority processing. The remaining 9,000 credits go to seed queries.

## Files to Edit

### `supabase/functions/catalog-amazon-ingest-worker/index.ts`
- Expand `AMAZON_CONGO_SEEDS` from 31 to 300+ queries across all categories
- Increase seeds processed per run from 10 to 30
- Add smarter rotation: track last seed index in `admin_settings` so we don't repeat

### `supabase/functions/_shared/catalogSettings.ts`
- Change `amazonMaxCallsPerHour` default from 14 to 50
- Keep `amazonMaxCallsPerMonth` at 10,000

### `supabase/functions/extract-price/index.ts`
- Remove the Rainforest fallback block for Amazon paste-link (lines ~1399-1445)
- Keep Firecrawl as the sole extraction method for paste-link
- Keep the "enqueue to amazon_ingest_queue" logic so cache misses still get indexed in the background

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Seed queries | 31 (phones only) | 300+ (all categories) |
| Products indexed per run | ~200 | ~600 |
| Monthly API usage | ~2,000-3,000 | ~9,000 |
| Categories covered | 3 | 12+ |
| Paste-link provider | Firecrawl + Rainforest | Firecrawl only |
| Credits reserved for queue | ~shared | 1,000 dedicated |

## What Stays the Same
- Firecrawl remains primary for all paste-link extractions
- Queue items (paste-link cache misses) still get priority processing
- Monthly hard cap of 10,000 is never exceeded
- All ingested products go through the same category mapper and disallowed-item filter

