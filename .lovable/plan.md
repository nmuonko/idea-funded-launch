
Goal: make catalog ingestion from Preview/Test reliably land in Live, and eliminate the current mismatch caused by incomplete migrations and same-environment routing.

What I found
1) The “Push All to Live” flow is currently a single long-running request:
- `src/pages/admin/CatalogCache.tsx` calls `catalog-data-sync` with `mode: "push-to-live"`.
- `supabase/functions/catalog-data-sync/index.ts` loops over all pages in one invocation.
- This is prone to timeout/restarts on large datasets (your ~200k scale), so partial sync is very likely.

2) The target URL currently points to the current environment (not Live):
- `admin_settings.edge_function_base_url` is set to the current backend URL.
- `catalog-data-sync` has a self-target guard and won’t truly push cross-environment if URL points to itself.
- This directly explains “clicked bulk migrate but still mismatch.”

3) Ingestion entrypoints still default to local runtime environment:
- `catalog-refresh-worker`, `catalog-car-scraper`, `catalog-prewarm-worker`, `catalog-amazon-ingest-worker`, `_shared/ebayFetcher` all write with local runtime credentials unless explicitly routed.
- So Preview-triggered ingestion still fills Preview unless routed.

Implementation plan (what I will change)
Phase 1 — Make Live target explicit and safe
1. Add a shared ingestion-target resolver helper (new shared file in `supabase/functions/_shared/`):
- Reads `admin_settings.edge_function_base_url`.
- Falls back to local base URL if missing.
- Exposes:
  - `targetBaseUrl`
  - `isRemoteTarget` (target != current env)
  - `assertNotSelfTargetForLivePush` for sync actions
- Add structured logs so we can prove where writes are going.

2. Add admin action to read/update the ingestion target URL:
- In `admin-catalog-items`, add actions:
  - `get-ingestion-target`
  - `set-ingestion-target`
- Validate format (`https://.../functions/v1`) and prevent obviously invalid values.
- This removes guesswork and gives you a direct control point in admin UI.

Phase 2 — Route ingestion triggers to Live instead of local
3. Update admin-triggered worker calls to use target URL (not hardcoded local runtime URL):
- `supabase/functions/admin-catalog-items/index.ts`
  - `run-builder` → call `${targetBase}/catalog-refresh-worker`
  - `run-link-check` → call `${targetBase}/catalog-refresh-worker`
  - add `run-car-scraper` action so car ingestion also routes through backend and target logic.
- `supabase/functions/admin-auto-learning/index.ts`
  - `run-seed-backfill` / `continue-backfill` → call `${targetBase}/catalog-refresh-worker`

4. Update frontend calls to use the routed backend actions:
- `src/pages/admin/CatalogCache.tsx`
  - Replace direct `catalog-car-scraper` invoke with `postAction('run-car-scraper', ...)` so car ingestion follows same Live routing path.

Phase 3 — Fix bulk migration reliability (no more one-shot giant push)
5. Refactor `catalog-data-sync` to paged execution mode:
- Add `mode: "push-page"` that migrates exactly one page per request:
  - read page N (source)
  - send chunks to target import
  - return deterministic page result
- Keep `export`/`import`.
- Keep `push-to-live` only as compatibility wrapper (or deprecate in UI).

6. Refactor UI push flow into resumable loop:
- In `CatalogCache.tsx` Data Sync panel:
  - Replace one-shot `push-to-live` with iterative `push-page` loop from client.
  - Show progress: page, read, inserted, skipped, errors.
  - Stop safely on first hard error and allow restart from last successful page.
- This avoids function timeouts and gives deterministic completion.

Phase 4 — Remove ambiguity in UI so mismatch is obvious early
7. Add source/target labels in Data Sync section:
- Show “Current environment count” and “Target Live URL”.
- Warn if target URL equals current environment (“You are syncing to self”).
- Keep user-facing wording simple (no technical jargon).

Phase 5 — Cover search-side write leakage
8. Update `_shared/ebayFetcher.ts` write path:
- Route catalog upsert through target-aware path (using the same ingestion target logic) so preview searches don’t silently repopulate Preview when Live-only mode is intended.
- Keep fallback behavior explicit and logged.

Files to update
- `supabase/functions/admin-catalog-items/index.ts`
- `supabase/functions/admin-auto-learning/index.ts`
- `supabase/functions/catalog-data-sync/index.ts`
- `supabase/functions/_shared/ebayFetcher.ts`
- `src/pages/admin/CatalogCache.tsx`
- `supabase/functions/_shared/*` (new ingestion target helper)

Important safeguards
- Preserve auth checks; do not loosen admin security.
- Add strong logging at routing points (`targetBase`, `isRemote`, action name).
- Keep idempotent upserts to avoid duplicate writes.
- Do not edit auto-generated integration files (`src/integrations/supabase/types.ts`, client files, config autogen files).

Validation checklist (end-to-end)
1. Set ingestion target URL to Live in admin.
2. Trigger “Start Fetching” from Preview admin.
3. Confirm logs show requests routed to Live worker endpoint.
4. Confirm Live catalog count increases; Preview count does not drift from accidental local ingestion.
5. Run Data Sync push with large dataset and verify full completion without timeout.
6. Re-run push to confirm idempotency (mostly skipped, minimal inserted).
7. Test car provider fetch and builder fetch paths both end-to-end.

Expected outcome
- New ingestion triggered from Preview/Test goes directly to Live.
- Bulk migration becomes reliable at large scale.
- The Preview vs Live mismatch no longer keeps growing from local-side ingestion.
