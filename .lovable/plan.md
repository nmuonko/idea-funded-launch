

## Backend Optimization: Round 3 -- Dead Index Cleanup + Table Bloat

### Findings

#### 1. `idx_catalog_items_is_disallowed` -- 1.9MB, 1 scan
This boolean index is functionally dead. The `check_catalog_item_disallowed` trigger already filters at INSERT time, so nothing queries by `is_disallowed` alone. Drop it.

#### 2. Duplicate unique indexes on `catalog_seed_queries`
Two identical unique indexes on `(provider, seed_key)` with 0 scans each:
- `uq_seed_key` (56KB)
- `catalog_seed_queries_provider_seed_key_key` (56KB)

Both are redundant since the pkey (2,768 scans) handles lookups. Keep one for the unique constraint, drop the duplicate.

#### 3. Dead indexes on `admin_audit_logs` (5 indexes, 0 scans)
| Index | Scans |
|-------|-------|
| `idx_admin_audit_logs_action_type` | 0 |
| `idx_admin_audit_logs_admin_id` | 0 |
| `idx_admin_audit_logs_admin_action` | 0 |
| `idx_admin_audit_created` | 0 |
| `idx_admin_audit_logs_created` | 0 |

Only `idx_admin_audit_logs_created_at` has any usage (5 scans). Drop all 5 dead ones.

#### 4. Dead indexes on `home_seen_items`
- `home_seen_items_pkey`: 0 scans (80KB)
- `idx_home_seen_items_rotation`: 0 scans (32KB)

The pkey can't be dropped (primary key), but the rotation index is dead. Drop it.

#### 5. Dead indexes on `shipping_item_types`
- `idx_shipping_types_active`: 0 scans
- `idx_shipping_types_active_priority`: 0 scans

The pkey (209K scans) handles all lookups. Drop both.

#### 6. Cache table bloat: `catalog_cache` still 27MB for 249 rows
The REINDEX from Round 2 may not have fully resolved this. Run VACUUM FULL on small cache tables to reclaim space:
- `catalog_cache`: 27MB overhead / 296KB data
- `catalog_home_cache`: 2.4MB / 8KB data
- `home_cache_web_feed`: 1.2MB / 8KB data

### Plan

Single migration to:
1. Drop `idx_catalog_items_is_disallowed` (save 1.9MB)
2. Drop duplicate `catalog_seed_queries_provider_seed_key_key` (keep `uq_seed_key` for constraint)
3. Drop 5 dead `admin_audit_logs` indexes
4. Drop `idx_home_seen_items_rotation`
5. Drop 2 dead `shipping_item_types` indexes
6. VACUUM FULL on 3 small bloated cache tables

### Expected Impact
- **10 dead indexes removed** across 5 tables
- **~2MB index storage freed** + potential 28MB reclaimed from VACUUM FULL on cache tables
- Faster writes on all affected tables (fewer indexes to maintain)

### Technical Details

```sql
-- 1. catalog_items: dead boolean index
DROP INDEX IF EXISTS idx_catalog_items_is_disallowed;

-- 2. catalog_seed_queries: duplicate unique
DROP INDEX IF EXISTS catalog_seed_queries_provider_seed_key_key;

-- 3. admin_audit_logs: 5 dead indexes
DROP INDEX IF EXISTS idx_admin_audit_logs_action_type;
DROP INDEX IF EXISTS idx_admin_audit_logs_admin_id;
DROP INDEX IF EXISTS idx_admin_audit_logs_admin_action;
DROP INDEX IF EXISTS idx_admin_audit_created;
DROP INDEX IF EXISTS idx_admin_audit_logs_created;

-- 4. home_seen_items: dead rotation index
DROP INDEX IF EXISTS idx_home_seen_items_rotation;

-- 5. shipping_item_types: dead indexes
DROP INDEX IF EXISTS idx_shipping_types_active;
DROP INDEX IF EXISTS idx_shipping_types_active_priority;

-- 6. Reclaim bloat on small cache tables
VACUUM FULL public.catalog_cache;
VACUUM FULL public.catalog_home_cache;
VACUUM FULL public.home_cache_web_feed;
```

| File | Change |
|------|--------|
| New migration SQL | Drop 10 dead indexes, VACUUM FULL 3 cache tables |

