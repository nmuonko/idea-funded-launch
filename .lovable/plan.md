

## Backend Optimization: Round 2

### Finding 1: Duplicate Unique Indexes (20MB wasted, slower writes)

The `catalog_items` table has THREE identical unique indexes on `(provider, provider_product_id)`:

| Index | Scans | Size |
|-------|-------|------|
| `catalog_items_provider_product_unique` | 585,636 | 10 MB |
| `idx_catalog_items_provider_product_id` | 237,907 | 10 MB |
| `idx_catalog_items_provider_product` | 147,223 | 10 MB |

Only the most-used one (`catalog_items_provider_product_unique`) needs to stay. Drop the other two to save 20MB and speed up every catalog write.

### Finding 2: catalog_cache Index Bloat (28MB indexes for 249 rows)

The `catalog_cache` table has only **249 rows** and **296KB of data** but **28MB of indexes** -- a 95:1 bloat ratio from historical churn. Also:
- `idx_catalog_cache_stale`: 0 scans, 56KB -- dead
- `idx_catalog_cache_type_updated`: 6 scans, 88KB -- nearly dead

Fix: Drop dead indexes, then REINDEX the table to reclaim bloated B-tree pages.

### Finding 3: More Low-Value Indexes on catalog_items (~18MB)

| Index | Scans | Size | Reason |
|-------|-------|------|--------|
| `idx_catalog_items_last_seen` | 4 | 4.3 MB | Redundant with `last_seen_at_desc` |
| `idx_catalog_items_price_refresh` | 5 | 4.3 MB | Redundant with `price_updated` |
| `idx_catalog_items_updated_at` | 60 | 5.2 MB | Very low usage |
| `idx_catalog_items_price_usd` | 107 | 5.9 MB | Low usage, covered by composite |

### Finding 4: Security Gaps

- `amazon_ingest_queue` has **RLS disabled** (ERROR level from linter)
- 4 tables have RLS enabled but **no policies** (blocks all non-service-role access, which may be intentional but should be explicit)

### Plan

**Migration SQL** -- single migration to:
1. Drop 2 duplicate unique indexes on `catalog_items` (save 20MB)
2. Drop 4 low-value indexes on `catalog_items` (save 18MB)
3. Drop 2 dead indexes on `catalog_cache`
4. REINDEX `catalog_cache` to reclaim 28MB of bloat
5. Enable RLS on `amazon_ingest_queue` with service-role-only policy
6. Add service-role-only policies to the 4 tables missing policies

### Expected Impact
- **Write speed**: ~10-15% faster catalog item upserts (6 fewer indexes)
- **Storage**: ~38MB freed from duplicate/dead indexes
- **catalog_cache**: Index footprint drops from 28MB to under 500KB after REINDEX
- **Security**: All public tables have RLS + at least one policy

### Files Changed

| File | Change |
|------|--------|
| New migration SQL | Drop 8 indexes, REINDEX catalog_cache, fix RLS gaps |

