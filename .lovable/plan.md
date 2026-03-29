

# Pause All Background Cron Jobs — Keep Data + Paste Link

## Current State
17 active cron jobs are running. The catalog is 3 GB (926K items). Your daily cost is ~$20.

## Active jobs to pause (10 jobs)

| Job | Schedule | Why pause |
|-----|----------|-----------|
| `amazon-ingest-worker-30m` | Every hour | Biggest API cost driver |
| `catalog-builder-campaign` | Every 2 hours | Ingests thousands of items |
| `shein-scraper-30m` | Every 30 min | Heavy scraping + Firecrawl credits |
| `car-scraper-cargurus-daily` | Daily | Firecrawl credits |
| `car-scraper-carvana-daily` | Daily | Firecrawl credits |
| `catalog-prewarm-home-12h` | Every 12h | Pre-warms cache, not needed if no new items |
| `promote-popular-searches-6h` | Every 6h | DB writes for popularity |
| `aggregate-popularity-daily` | Daily | Analytics aggregation |
| `analyze-critical-tables-daily` | Daily | DB maintenance overhead |
| `cleanup-all-expired-data-6h` | Every 6h | Can pause since no new data flowing in |

## Jobs to KEEP active (5 jobs — essential for orders/payments)

| Job | Why keep |
|-----|----------|
| `order-recovery-30m` | Recovers stuck payments |
| `reconcile-payments-hourly` | Payment reconciliation |
| `saved-cart-reminders-daily` | Customer engagement |
| `send-abandoned-cart-recovery-daily` | Revenue recovery |
| `cleanup-expired-carts-daily` | Lightweight cleanup |

## What stays working
- **Paste a Link**: Fully functional — user pastes URL → `extract-price` edge function scrapes it → item cached in `catalog_items` → breakdown shown
- **All existing 926K items**: Untouched, still searchable and purchasable
- **Orders, payments, checkout**: All operational

## Cost impact estimate
- **Before**: ~$20/day — driven by continuous API calls (Rainforest, Firecrawl, eBay), DB writes from ingestion, and cron-triggered edge function invocations
- **After**: ~$2-4/day — only payment/order crons running (lightweight DB reads), plus occasional `extract-price` calls when users paste links
- **Savings**: ~$15-18/day (~$450-540/month)

The big cost drivers are the edge function invocations from ingestion crons (each triggers HTTP calls to external APIs) and the DB write volume from bulk upserts. Pausing them eliminates both.

## Implementation
Single SQL migration to unschedule the 10 jobs using `cron.unschedule('job-name')` for each. No data deleted. Fully reversible — jobs can be re-enabled anytime with `cron.schedule()`.

