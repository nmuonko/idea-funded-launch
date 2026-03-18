## Backend Cost Optimization (Complete)

### Problem
~$480 in ~1.5 months on Cloud/AI. Three cost buckets: AI Gateway (~$180-220), Edge Function invocations (~$150-180), Database IO (~$80-100).

### Changes Made

#### Phase 1: Collapse AI Calls (saves ~$100-140/mo)
- **Removed `refineQueryWithAi`** from `catalog-search/index.ts` — was redundant with `aiQueryRewrite` which already provides `expansions`
- **Removed dual-provider race** from `aiQueryInterpreter.ts` — dropped OpenAI parallel call, uses only Lovable AI (single provider)
- **Deleted `search-expand-query`** edge function — no longer called
- **Result**: 1 AI call per search (cache miss) instead of 3-5

#### Phase 2: Reduce Catalog Builder Frequency (saves ~$30-40/mo)
- Changed `catalog-builder-campaign` cron from `*/10` to `*/30` minutes
- 2,880 fewer edge function invocations/month

#### Phase 3: Delete Unused Edge Functions (saves ~$20-30/mo)
- Deleted 35 redundant functions: `search-expand-query`, `backfill-cart-images`, `backfill-product-images`, `market-*-proxy`, `catalog/`, `analyze-submission`, `extract-price`, 22 `send-*` email functions (consolidated into `email-service`), `catalog-data-sync`, `catalog-prewarm-worker`, `cleanup-expired-*` (3), 6 `admin-*` standalone functions, `product-resolver`, `get-product-info`

#### Phase 4: Extend Cache TTLs (saves ~$20-30/mo)
- `search_rewrite_cache`: 14 days → 30 days
- `catalog_cache` search: 7 days → 14 days (stale: 24h → 48h)

#### Phase 5: AI Daily Budget Cap (prevents overruns)
- Added 500 calls/day hard cap on `lovable_ai` provider in `aiQueryRewrite.ts`
- Uses existing `provider_budget` infrastructure (`check_provider_budget` / `increment_provider_budget`)
- Falls back to deterministic rewriting when cap hit

### Estimated Savings: $170-240/month (35-50% reduction)

### Previous Work
- SHEIN Price Backfill System
- Unified Search Pipeline
- Edge Function Consolidation (42 functions deleted)
- Payment flow RLS fixes
