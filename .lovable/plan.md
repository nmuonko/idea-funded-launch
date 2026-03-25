

# What's Driving Your Backend Costs

## The Big Picture

Your database is **3.2 GB** total. Here's where it's going:

```text
┌─────────────────────────────┬───────────┬────────────┐
│ Table                       │ Size      │ Rows       │
├─────────────────────────────┼───────────┼────────────┤
│ catalog_items               │ 2,967 MB  │ 1,433,666  │
│  └─ indexes on catalog_items│ ~1,689 MB │            │
│ catalog_cache               │ 114 MB    │ 2,193      │
│ catalog_item_media          │ 20 MB     │ 14,797     │
│ search_query_log            │ 3.8 MB    │ 15,929     │
│ Everything else combined    │ ~100 MB   │            │
└─────────────────────────────┴───────────┴────────────┘
Total DB: 3,225 MB
Index overhead: ~1,689 MB (52% of total!)
```

## Top 3 Cost Drivers

### 1. `catalog_items` — 2.97 GB (92% of storage)
- 1.43 million rows, most of which are scraped product listings
- Indexes alone consume ~1.7 GB
- This single table is your dominant cost driver

### 2. `catalog_cache` — 114 MB (2,193 rows)
- Each row stores full JSON search responses
- Large JSONB blobs inflate storage disproportionately

### 3. Active Cron Jobs — 11 running
These fire edge function invocations constantly, which cost compute time:
- `catalog-builder-campaign` — every 30 min (ingests new items, growing catalog_items)
- `order-recovery-30m` — every 30 min
- `reconcile-payments-hourly` — every hour
- `catalog-prewarm-home-12h` — every 12 hours
- `cleanup-all-expired-data-6h` — every 6 hours
- `promote-popular-searches-6h` — every 6 hours
- Plus 5 daily jobs

## Recommended Actions to Reduce Spend

### A. Prune `catalog_items` (biggest win)
- Delete inactive/stale listings older than 90 days that haven't been viewed or ordered
- This could reclaim 1-2 GB immediately
- Reindex afterward with `REINDEX TABLE catalog_items` to reclaim index bloat

### B. Pause `catalog-builder-campaign`
- This cron runs every 30 minutes and is the primary source of catalog_items growth
- Pausing it stops the table from growing further until you need new inventory

### C. Vacuum `catalog_cache`
- Run `VACUUM FULL catalog_cache` to reclaim dead-tuple bloat from expired cache entries
- Tighten the cleanup cron to purge expired cache rows more aggressively

### D. Drop unused indexes
- 1.7 GB of indexes on catalog_items alone — many may be redundant
- Audit which indexes are actually used and drop the rest

### E. Review if all 11 active crons are needed
- Each invocation costs edge function compute
- `saved-cart-reminders-daily` and `send-abandoned-cart-recovery-daily` fire even if there are no carts to process

## Summary
| Driver | Impact | Fix |
|--------|--------|-----|
| catalog_items (1.4M rows) | 92% of DB | Prune old items, pause builder |
| Index bloat (1.7 GB) | 52% of total | Drop redundant indexes |
| catalog_cache JSONB | 114 MB | VACUUM FULL + shorter TTL |
| 11 active cron jobs | Compute cost | Pause non-essential ones |

Want me to implement any of these optimizations?

