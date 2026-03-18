

# Backend Cost Audit: ~$480 in ~1.5 Months

## Where the Money Goes

Your $480 breaks down into **three cost buckets**:

```text
┌─────────────────────────────────────────────────────┐
│           ESTIMATED COST BREAKDOWN (~$480)           │
├──────────────────────────┬──────────────────────────┤
│ 1. Lovable AI Gateway    │  ~$180–220  (38–46%)     │
│ 2. Edge Function Invoc.  │  ~$150–180  (31–38%)     │
│ 3. Database (storage/IO) │  ~$80–100   (17–21%)     │
└──────────────────────────┴──────────────────────────┘
```

---

## Bucket 1: Lovable AI Gateway (~$180–220)

**8 separate AI callers** hit the gateway. Per search, up to **3 AI calls fire simultaneously**:

| Caller | Trigger | Model | Frequency |
|--------|---------|-------|-----------|
| `aiQueryRewrite` | Every non-English/ambiguous search | gemini-2.5-flash-lite | HIGH — every French query |
| `searchAiExpand` (refineQueryWithAi) | Every search (unless direct query) | gemini-2.5-flash-lite | HIGH |
| `aiQueryInterpreter` | Fallback gate fires (weak results) | gemini-2.5-flash-lite + GPT-4o-mini **dual race** | MEDIUM |
| `search-expand-query` | Called by searchAiExpand on cache miss | gemini-2.5-flash-lite | HIGH |
| `smart-cart-recovery` | Abandoned carts (every 2h batch) | AI for personalized emails | LOW |
| `smart-recommendations` | Homepage/cart context | AI for product recs | LOW |
| `smart-ticket-analysis` | Support tickets | AI for sentiment/response | LOW |
| `chat` | Customer chat | Streaming chat | LOW |
| `admin-service` (AI reply) | Admin generates reply | gemini-2.5-flash | LOW |

**The big problem:** A single user search can trigger `aiQueryRewrite` + `refineQueryWithAi` + `search-expand-query` = **3 AI calls**. If results are weak, `aiQueryInterpreter` fires a **dual-provider race** (Lovable + OpenAI) = **2 more calls**. That's up to **5 AI calls per search**.

---

## Bucket 2: Edge Function Invocations (~$150–180)

You have **120+ edge functions deployed**. Active cron jobs hammering them:

| Cron Job | Schedule | What it does |
|----------|----------|-------------|
| `catalog-builder-campaign` | **Every 10 min** | Rotates eBay queries, indexes items |
| `catalog-prewarm-home` | Every 12h | Pre-warms home page sections |
| `order-recovery-30m` | Every 30 min | Recovers stuck payments |
| `reconcile-payments-hourly` | Every hour | Checks payment status |
| `cleanup-all-expired-data-6h` | Every 6h | Cleans expired caches |
| `cleanup-expired-carts-daily` | Daily | Removes old carts |
| `saved-cart-reminders-daily` | Daily | Sends reminders |
| `send-abandoned-cart-recovery` | Daily | Recovery emails |
| `aggregate-popularity-daily` | Daily | Aggregates search popularity |
| `promote-popular-searches-6h` | Every 6h | Promotes trending queries |

**The catalog-builder running every 10 min = 144 invocations/day = 4,320/month**, each calling eBay API + doing DB writes.

Additionally, every user page load triggers `catalog-product` calls (visible in logs: 10+ concurrent detail fetches per page).

---

## Bucket 3: Database IO (~$80–100)

- `catalog_items` table is large (10k+ items with never-delete policy)
- Every search does multiple DB queries: cache check, rewrite cache, expansion cache, DB-first search, media cache lookups
- `catalog_cache` with 7-day TTL accumulates data
- `search_query_log` grows unbounded
- ANALYZE runs daily on 7 tables

---

## Plan to Cut 50–80%

### Phase 1: Collapse AI Calls (Save ~$100–140)

**Problem:** 3–5 AI calls per search.
**Fix:** Merge `aiQueryRewrite`, `searchAiExpand`, and `search-expand-query` into **one single AI call** per search. The rewrite already returns `expansions` — there's no need for a separate expand step.

Changes:
- In `catalog-search/index.ts`: Remove `refineQueryWithAi` call entirely. The `aiQueryRewrite` result already contains `expansions` which serve the same purpose.
- Delete or deprecate `search-expand-query` edge function.
- Remove the dual-race pattern in `aiQueryInterpreter` — use only Lovable AI (drop OpenAI parallel call). One provider is sufficient with caching.
- **Gate AI more aggressively**: Skip AI entirely for English queries that match known patterns (brand + model). Currently only `preNormSkipAI` and `isDirectQuery` gate it — add a gate for clean English queries with >50 DB results.

**Result:** 1 AI call per search (cache miss), 0 on cache hit. Saves ~60–70% of AI spend.

### Phase 2: Reduce Catalog Builder Frequency (Save ~$30–40)

**Problem:** `catalog-builder-campaign` runs every 10 minutes = 4,320 calls/month.
**Fix:** Change to every 30 minutes. You already have 10k+ items indexed. Discovery of new items can be slower.

Change cron schedule from `*/10 * * * *` to `*/30 * * * *`.

**Result:** 2,880 fewer edge function invocations/month.

### Phase 3: Trim Unused Edge Functions (Save ~$20–30)

**Problem:** 120+ deployed edge functions. Many are redundant or unused (e.g., `catalog/`, `backfill-cart-images`, `backfill-product-images`, `market-item-details-proxy`, `market-search-proxy`, `extract-price`, `analyze-submission`, multiple duplicate send-email functions).

**Fix:** Audit and delete unused functions. Each deployed function consumes cold-start resources. Consolidate the 15+ email-sending functions into `email-service`.

### Phase 4: Extend Cache TTLs (Save ~$20–30)

**Problem:** `search_rewrite_cache` = 14 days, `search_query_expansions` = short TTL, `catalog_cache` = 7 days.
**Fix:**
- Extend `search_rewrite_cache` to 30 days (queries don't change meaning)
- Extend `catalog_cache` to 14 days
- This directly reduces AI cache misses and DB-first fallbacks

### Phase 5: Add AI Call Counter / Kill Switch (Save $0 but prevents overruns)

- Add a daily AI call counter using `provider_budget` (you already have the infrastructure)
- Set a hard cap of e.g., 500 AI calls/day
- After cap: fall back to deterministic rewriting only (which already works)

---

## Summary

| Phase | Action | Estimated Monthly Savings |
|-------|--------|--------------------------|
| 1 | Collapse 3-5 AI calls → 1 per search | $100–140 |
| 2 | Catalog builder 10min → 30min | $30–40 |
| 3 | Delete/consolidate unused functions | $20–30 |
| 4 | Extend cache TTLs | $20–30 |
| 5 | AI daily budget cap | Prevents overruns |
| **Total** | | **$170–240 (35–50% of $480)** |

With aggressive AI gating (Phase 1 fully implemented + Phase 5 cap), savings can reach **$240–350 (50–73%)**.

