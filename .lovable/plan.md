
Goal: Fix CarGurus/Carvana fetch so it returns real results (not zero) and responds faster for on-demand runs, while also fixing scheduled runs.

What I verified from the current implementation and logs:
1) On-demand car fetch is hardcoded to `max_price: 15000` in the admin UI.
   - This is very restrictive for queries like “tesla model 3”, so valid listings are often filtered out.
2) The backend function call is synchronous and currently took ~61s in recent runs.
   - Logs show `firecrawl` timing out with 408, then fallback free scrape gets blocked (403), which causes long wait + zero results.
3) Scheduled car jobs exist, but they also use `max_price: 15000`.
   - So cron has the same restrictive filter and can repeatedly produce zero useful items.
4) There is already evidence the route works sometimes (CarGurus inserted 7 items), so this is not a full pipeline break; it’s a reliability + filtering + timeout behavior issue.

Implementation approach:
I’ll fix this in 3 layers: request shaping (UI/admin), scraper reliability (backend function), and scheduler defaults (cron commands).  
No new tables are required, so no RLS policy changes are needed for this fix.

1) UI + action payload updates (faster user feedback + realistic filtering)
Files:
- `src/pages/admin/CatalogCache.tsx`
- `supabase/functions/admin-catalog-items/index.ts`

Changes:
- Add a “Max Price (USD)” field for car providers in On-Demand Fetch UI.
  - Default to a practical car value (e.g., 50,000) instead of fixed 15,000.
- Pass `max_price` and `target_items` from UI to `run-car-scraper` action.
- Keep quantity-driven page cap, but let scraper stop early when target reached.
- Improve result messaging in UI to show why zero happened (timeout/blocked/filtered).

Why:
- Prevents false-zero results from unrealistic cap.
- Gives admin clearer cause when provider blocks or times out.

2) Car scraper reliability + response-time improvements
File:
- `supabase/functions/catalog-car-scraper/index.ts`

Changes:
- Add explicit timeout control around Firecrawl request (AbortController) so it doesn’t hang near 60s.
  - Example behavior: fail fast around ~18–20s per page.
- Switch extraction payload to Firecrawl v1 JSON-extraction style (while keeping compatibility fallback parsing for current structure).
- Add drop-reason counters:
  - missing_price
  - missing_url
  - above_max_price
  - invalid_title
- Add structured debug summary in response:
  - firecrawl_status
  - fallback_used
  - elapsed_ms
  - filtered_reasons
- Add early-stop logic when enough listings are collected (`target_items`) to reduce total latency.
- Keep free scrape fallback, but avoid costly extra retries when a hard block pattern is already known.

Why:
- Reduces “takes too long” complaint directly.
- Makes zero-result cases diagnosable instead of opaque.
- Improves chance of returning data quickly.

3) Scheduled job defaults for car providers
Database migration (via migration tool):
- Update existing cron job commands for:
  - `car-scraper-cargurus-daily`
  - `car-scraper-carvana-daily`
- Raise `max_price` in request body from 15000 to a realistic vehicle cap (same default as UI).
- Optionally increase frequency (if desired) from daily to multiple times/day for fresher stock.

Why:
- Cron currently inherits the same restrictive filter that causes zeros.
- Aligning schedule payload with on-demand behavior keeps both consistent.

4) Verification plan (end-to-end)
After implementation, run these checks:

A. On-demand checks (must pass)
- CarGurus, query `tesla model 3`, quantity 10, max price 50000:
  - returns non-zero listings or explicit provider-block/timeout reason in UI
  - completes materially faster than current long wait baseline
- Carvana same scenario:
  - same expectations

B. Data checks (must pass)
- Confirm new rows inserted for provider(s) in `catalog_items`.
- Confirm “View Fetched Products” shows rows for provider + query/date filter.

C. Scheduled checks (must pass)
- Trigger/observe next scheduled run logs and verify it uses updated max_price.
- Confirm scheduled run no longer systematically returns zero due to low cap.

D. Regression checks (must pass)
- Existing eBay/Amazon on-demand fetch remains unchanged.
- Category filtered counts in Cached Products still show correct totals.

Expected outcome:
- On-demand car fetch no longer consistently returns 0 for realistic car queries.
- Response time is reduced via timeout caps + early stop.
- Scheduled car ingestion uses realistic defaults and stops silently failing from over-restrictive pricing.
- Admin gets actionable reason details when providers block/timeout.

Technical notes:
- This plan does not require creating new tables.
- No authentication model changes are required.
- Existing role-protected admin actions remain intact.
