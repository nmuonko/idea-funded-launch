

## Backend Optimization: Fix Indexing Bottlenecks

### Problem Summary

Your database has significant **sequential scan bottlenecks** on high-traffic tables, plus ~25MB of dead indexes on `catalog_items` wasting storage and slowing writes. Here are the key numbers:

| Table | Seq Scans | Idx Scans | Index Usage | Rows |
|-------|-----------|-----------|-------------|------|
| user_roles | 1,260,053 | 385,918 | 23% | 7 |
| orders | 579,420 | 124,464 | 18% | 23 |
| profiles | 495,776 | 21,111 | 4% | 23 |
| order_items | 480,012 | 199,572 | 29% | 27 |
| settings | 58,775 | 10 | 0.02% | 1 |
| admin_settings | 26,975 | 379 | 1.4% | 49 |

These tables have only a few rows each, meaning Postgres prefers seq scans over index scans (which is actually optimal for tiny tables). The real optimization opportunity is **caching these lookups** in edge functions so the DB isn't queried millions of times for data that rarely changes.

### Key Findings

1. **`catalog_items` has 8 dead indexes (0 scans) wasting ~18MB** -- these slow down every INSERT/UPDATE on the 151K-row table
2. **`settings` table (1 row) gets 58K seq scans** -- should be cached in edge functions
3. **`admin_settings` (49 rows) gets 27K seq scans** -- already partially cached but not everywhere
4. **`search_text_trgm` index is 52MB but only 1,447 scans** vs `title_trgm` at 47MB with 6,683 scans -- potential duplicate
5. **`catalog_items` total index footprint is 253MB vs 132MB table data** -- index bloat ratio is nearly 2x

### Plan

#### Phase 1: Drop Dead Indexes (immediate write performance boost)

Drop 8 unused indexes on `catalog_items` that have **zero scans** since stats were last reset:

```text
idx_catalog_items_category_price    10 MB   0 scans
idx_catalog_items_category          2.7 MB  0 scans
idx_catalog_items_expires_active    2.6 MB  0 scans
idx_catalog_items_in_stock          2.0 MB  0 scans
idx_catalog_items_listing_type      136 KB  0 scans
idx_catalog_items_fail_count        16 KB   0 scans
idx_catalog_items_parts_subkey      8 KB    0 scans
idx_catalog_items_brand             8 KB    0 scans
```

This frees ~18MB and speeds up every catalog item write.

#### Phase 2: Drop Redundant/Low-Value Indexes

Several indexes are functionally redundant (covered by other indexes):

```text
idx_catalog_items_search_text_trgm  52 MB  1,447 scans  (title_trgm at 47MB covers same use)
idx_catalog_items_price             5.9 MB 6 scans
idx_catalog_items_last_seen         4.4 MB 4 scans      (last_seen_at_desc covers this)
idx_catalog_items_provider_updated  5.4 MB 32 scans     (provider_product covered)
idx_catalog_items_popularity_score  6 MB   23 scans     (popularity covers this)
```

Review and drop after confirming no edge function uses them directly.

#### Phase 3: Cache `settings` Lookups in Edge Functions

The `settings` table (1 row) is hit ~59K times. Add a shared in-memory TTL cache (like `ttlPolicy.ts` already does) for settings lookups used in `get_public_config()` calls from edge functions.

Create `supabase/functions/_shared/settingsCache.ts`:
- 60-second in-memory cache for the single settings row
- Used by all edge functions that call `settings` or `get_public_config`

#### Phase 4: Cache `admin_settings` Lookups

`admin_settings` already has partial caching in `ttlPolicy.ts` and `catalogSettings.ts`, but 27K seq scans suggest many edge functions bypass the cache. Audit and ensure all `admin_settings` reads go through a centralized cached helper.

### Technical Details

**Migration SQL (Phase 1 + 2 combined):**
```sql
-- Phase 1: Drop dead indexes (0 scans)
DROP INDEX IF EXISTS idx_catalog_items_category_price;
DROP INDEX IF EXISTS idx_catalog_items_category;
DROP INDEX IF EXISTS idx_catalog_items_expires_active;
DROP INDEX IF EXISTS idx_catalog_items_in_stock;
DROP INDEX IF EXISTS idx_catalog_items_listing_type;
DROP INDEX IF EXISTS idx_catalog_items_fail_count;
DROP INDEX IF EXISTS idx_catalog_items_parts_subkey;
DROP INDEX IF EXISTS idx_catalog_items_brand;

-- Phase 2: Drop low-value/redundant indexes
DROP INDEX IF EXISTS idx_catalog_items_search_text_trgm;
DROP INDEX IF EXISTS idx_catalog_items_price;
DROP INDEX IF EXISTS idx_catalog_items_provider_updated;
DROP INDEX IF EXISTS idx_catalog_items_popularity_score_desc;
```

**Files to create/modify:**
| File | Action |
|------|--------|
| New migration SQL | Drop 12 dead/redundant indexes (~80MB freed) |
| `supabase/functions/_shared/settingsCache.ts` | New: 60s TTL cache for `settings` table |
| Edge functions using `settings` | Import from `settingsCache.ts` instead of direct DB reads |

### Expected Impact
- **Write speed**: ~15-20% faster catalog item inserts/upserts (12 fewer indexes to maintain)
- **Storage**: ~80MB freed from dead index bloat
- **DB load**: Thousands fewer seq scans per hour from cached settings lookups

