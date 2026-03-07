

## Audit: Cron Jobs Are NOT Pointing to Lovable Cloud

The cron jobs in the Lovable Cloud database are **mostly still calling the old project** (`ecqpqtirhpumfgbdtvhh`). Here is the full breakdown:

### Jobs pointing to OLD project (need fixing) — 12 jobs:

| Job Name | Old URL Target |
|---|---|
| `amazon-ingest-worker-30m` | `ecqpqtirhpumfgbdtvhh` |
| `car-scraper-cargurus-15m` | `ecqpqtirhpumfgbdtvhh` |
| `car-scraper-carvana-15m` | `ecqpqtirhpumfgbdtvhh` |
| `catalog-prewarm-home-12h` | `ecqpqtirhpumfgbdtvhh` |
| `cleanup-all-expired-data-6h` | `ecqpqtirhpumfgbdtvhh` |
| `cleanup-expired-carts-daily` | `ecqpqtirhpumfgbdtvhh` |
| `link-check-every-6h` | `ecqpqtirhpumfgbdtvhh` |
| `reconcile-payments-hourly` | `ecqpqtirhpumfgbdtvhh` |
| `saved-cart-reminders-daily` | `ecqpqtirhpumfgbdtvhh` |
| `send-abandoned-cart-recovery-daily` | `ecqpqtirhpumfgbdtvhh` |
| `shein-scraper-15m` | `ecqpqtirhpumfgbdtvhh` |

### Jobs pointing to Lovable Cloud (already correct) — 3 jobs:
- `bulk-sync-resync` → `igmkhxffnyzoogcqvdab`
- `bulk-sync-runner-1m` → `igmkhxffnyzoogcqvdab`
- `incremental-sync-30m` → `igmkhxffnyzoogcqvdab`

### Jobs using `_cron_call_refresh_worker` function (indirect) — 4 jobs:
- `catalog-builder-campaign`, `catalog-pool-fill-daily`, `catalog-refresh-stale-6h`, `catalog-refresh-worker-queue`
- These call the `_cron_call_refresh_worker` function which reads `edge_function_base_url` from `admin_settings`
- **That setting is ALSO still pointing to the old project**: `https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1`

### Jobs that are pure SQL (no URL, already fine) — 3 jobs:
- `aggregate-popularity-daily`, `analyze-critical-tables-daily`, `promote-popular-searches-6h`

---

### Plan: Fix All Cron Jobs for Lovable Cloud

**Step 1** — Update `admin_settings.edge_function_base_url` to `https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1`. This fixes the 4 jobs that use `_cron_call_refresh_worker`.

**Step 2** — Unschedule and re-schedule the 11 hardcoded cron jobs to use `https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/...` with proper `x-cron-secret` headers (using vault lookup where possible).

**Step 3** — Update the `_cron_call_refresh_worker` function's fallback URL from the old project to Lovable Cloud.

**Step 4** — Update `scripts/migration-fix-new-project.sql` to use the correct Lovable Cloud URL so future re-runs are correct.

All changes will be executed via SQL (database migration or direct insert for cron-specific data).

