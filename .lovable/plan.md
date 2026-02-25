
Issue restated:
CarGurus and Carvana on-demand fetch still returns 0 items and takes too long. I reproduced it directly from the backend and confirmed this is not a UI-only issue.

What I verified just now (live):
1) Direct call to `catalog-car-scraper` for CarGurus (`tesla model 3`) returns:
- `ok: true`
- `listings_found: 0`
- `mode_used: "free"`
- `elapsed_ms: ~20071`
2) Function logs show:
- `firecrawl ... TIMEOUT after 20000ms`
- then fallback free scrape
- fallback page status `418` or `403` (blocked)
3) Same pattern for Carvana:
- `firecrawl timeout (20s)`
- fallback blocked `403`
- 0 listings

Root cause:
- The current Firecrawl step is timing out consistently before extraction succeeds.
- After timeout, fallback uses direct site fetch which is being bot-blocked (`403/418`), and current free parsers can’t recover from blocked pages.
- So the request spends ~20s and still returns 0.

Do I know what the issue is?
Yes. The functional bottleneck is: `firecrawl timeout -> blocked fallback -> no parseable data`.

Implementation approach (next fix):
1) Refactor `catalog-car-scraper` to a faster two-stage extraction path (no DB changes)
- File: `supabase/functions/catalog-car-scraper/index.ts`
- Stage A (fast path):
  - Use Firecrawl scrape with lightweight output (`markdown` + `links`) and shorter wait/render settings.
  - Parse listings deterministically from returned markdown/links (title, price, listing URL) instead of relying only on heavy JSON extraction.
- Stage B (heavy path only if needed):
  - If Stage A yields too few results, run one structured extraction attempt with a controlled timeout.
- Add early stop when `target_items` reached.

2) Fix timeout strategy to avoid guaranteed 20s failures
- Current config effectively spends most of timeout budget in render wait.
- Rebalance:
  - shorter render wait for fast pass
  - bounded extraction timeout for heavy pass
  - hard cap total function time per request
- Ensure timeout errors return structured diagnostics (not silent zero).

3) Make fallback behavior smarter when blocked
- Treat `403`, `418`, `429`, `503` as blocked statuses.
- When blocked, skip expensive parser work that cannot succeed.
- Return explicit blocked reason in response payload so UI can report the real cause.

4) Improve response diagnostics consumed by admin panel
- Files:
  - `supabase/functions/catalog-car-scraper/index.ts`
  - `supabase/functions/admin-catalog-items/index.ts`
  - `src/pages/admin/CatalogCache.tsx`
- Add fields like:
  - `firecrawl_status`
  - `fallback_used`
  - `blocked_statuses`
  - `elapsed_ms`
  - `drop_reasons`
- In UI, if zero items:
  - show “provider blocked” or “extraction timed out” instead of generic success.

5) Keep the max price behavior as-is (already fixed to 50,000) and preserve existing auth routing
- No new migrations required for this fix.
- Scheduled jobs can keep current payloads; they will benefit from scraper reliability changes automatically.

Verification plan (must pass):
A) Direct backend tests
- Trigger scraper for:
  - CarGurus + `tesla model 3` + quantity 10
  - Carvana + `tesla model 3` + quantity 10
- Expected:
  - non-zero listings OR explicit blocked diagnostic
  - materially reduced latency vs current ~20s timeout path

B) Admin UI end-to-end
- Run from `/admin/catalog-cache` On-Demand Fetch.
- Confirm message shows precise outcome (fetched vs blocked vs timeout reason).

C) Data validation
- Confirm new rows in `catalog_items` for `provider in ('cargurus','carvana')`.
- Confirm “View Fetched Products” shows those rows with provider/query filters.

Technical notes:
- This is primarily a scraper reliability refactor, not an auth or schema issue.
- If provider anti-bot pressure remains high, we can add an async queued job mode as phase 2, but the immediate fix above addresses the current reproducible timeout/block chain first.
