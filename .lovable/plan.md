
# Backend Enhancement Plan for 10k+ Users

## Current System Analysis

After thorough analysis of the codebase and database statistics, I've identified both strengths and critical gaps that need addressing:

### Existing Strengths
- Circuit breaker pattern implemented for 5 services (pawaPay, Stripe, Resend, MaishaPay, OpenAI)
- Load shedding with priority-based request management
- In-memory settings cache (60s TTL)
- Response cache with request coalescing and stale-while-revalidate
- 4 cron jobs already scheduled (cart cleanup, abandoned recovery, saved cart reminders, payment reconciliation)
- `cleanup_all_expired_data` RPC function covers 10 tables
- 47 indexes applied across the database

### Critical Issues Found

| Table | Sequential Scans | Index Usage | Risk Level |
|-------|-----------------|-------------|------------|
| user_roles | 858,993 | 31% | CRITICAL |
| orders | 570,503 | 15.1% | CRITICAL |
| profiles | 492,005 | 1.7% | CRITICAL |
| order_items | 478,834 | 28.7% | HIGH |
| shipping_item_types | 295,092 | 41.5% | MEDIUM |
| settings | 48,212 | 0% | HIGH |
| admin_settings | 3,840 | 3.6% | MEDIUM |

**Root Cause**: The Postgres query planner is still choosing sequential scans despite indexes existing. This indicates stale statistics requiring `ANALYZE` and potentially missing composite indexes for specific query patterns.

---

## Implementation Plan (4 Phases)

### Phase 1: Critical Database Fixes (Day 1)

**1.1 Force Statistics Update**

Run `ANALYZE` on all critical tables to update the query planner's statistics:

```sql
ANALYZE user_roles;
ANALYZE orders;
ANALYZE profiles;
ANALYZE order_items;
ANALYZE shipping_item_types;
ANALYZE settings;
ANALYZE admin_settings;
ANALYZE maisha_payments;
ANALYZE quote_requests;
ANALYZE payment_providers;
```

**1.2 Add Missing Composite Indexes**

The high sequential scan counts suggest queries are not matching existing indexes. Add:

```sql
-- user_roles: Optimize RLS checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_user_lookup 
ON user_roles (user_id) INCLUDE (role, admin_role);

-- settings: Singleton optimization
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_settings_singleton_id 
ON settings (id) WHERE id IS NOT NULL;

-- profiles: User lookup optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_user_id_unique 
ON profiles (user_id) INCLUDE (email, full_name, country);

-- orders: Status-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_created 
ON orders (status, created_at DESC);

-- admin_settings: Key lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_settings_key_btree 
ON admin_settings USING btree (key);
```

**1.3 RLS Function Optimization**

Update `is_admin()` and `is_admin_cached()` to use `EXISTS` with `LIMIT 1`:

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
    LIMIT 1
  )
$$;
```

---

### Phase 2: Automated Maintenance via pg_cron (Day 2)

**2.1 Add Comprehensive Cleanup Cron Job**

Currently missing: a scheduled job for `cleanup-expired-data`. Add this cron job:

```sql
SELECT cron.schedule(
  'cleanup-all-expired-data-hourly',
  '0 */6 * * *',  -- Every 6 hours
  $$
  SELECT net.http_post(
    url := 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/cleanup-expired-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

**2.2 Add Catalog Refresh Cron (Home Rotation)**

Automate the home page product rotation every 12 hours:

```sql
SELECT cron.schedule(
  'catalog-prewarm-home-12h',
  '0 */12 * * *',  -- Every 12 hours
  $$
  SELECT net.http_post(
    url := 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/catalog-prewarm-home',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

**2.3 Add ANALYZE Cron Job**

Ensure statistics stay fresh:

```sql
SELECT cron.schedule(
  'analyze-critical-tables-daily',
  '0 3 * * *',  -- Every day at 3 AM
  $$
  ANALYZE user_roles;
  ANALYZE orders;
  ANALYZE order_items;
  ANALYZE profiles;
  ANALYZE catalog_items;
  ANALYZE catalog_cache;
  $$
);
```

---

### Phase 3: Admin Observability Dashboard (Day 3-4)

**3.1 Enhanced System Health Page**

Update `src/pages/admin/Health.tsx` to include:

- **Circuit Breaker Status Widget**
  - Real-time status for all 5 services (pawaPay, Stripe, Resend, MaishaPay, OpenAI)
  - Visual indicators: CLOSED (green), HALF_OPEN (yellow), OPEN (red)
  - "Reset Circuit" button for admins

- **Load Level Indicator**
  - Current load percentage (0-100%)
  - Mode display: normal/high/critical
  - Active feature toggles display

- **Cache Hit Rate Dashboard**
  - In-memory cache size and utilization
  - In-flight request coalescing count
  - Database cache table sizes

- **Provider Health Cards**
  - eBay API status (token validity)
  - Amazon/Rainforest API budget remaining
  - Payment provider connectivity

**3.2 New Backend Health Endpoint**

Create `supabase/functions/admin-system-health/index.ts`:

```typescript
// Returns comprehensive system diagnostics
{
  circuits: {
    pawapay: { state: 'CLOSED', failures: 0, isAvailable: true },
    stripe: { state: 'CLOSED', failures: 0, isAvailable: true },
    // ... other services
  },
  load: {
    currentLoad: 45,
    maxLoad: 1000,
    loadLevel: 0.045,
    mode: 'normal',
    features: { aiRecommendations: true, ... }
  },
  cache: {
    size: 234,
    maxSize: 1000,
    inFlightCount: 2
  },
  database: {
    connectionPoolUsage: 15,
    slowQueriesLast5m: 0
  },
  cron: {
    lastCleanup: '2026-01-31T06:00:00Z',
    nextCatalogRefresh: '2026-01-31T12:00:00Z'
  }
}
```

---

### Phase 4: Client-Side Resilience (Day 5)

**4.1 Exponential Backoff Hook**

Create `src/hooks/useResilientFetch.ts`:

```typescript
export function useResilientFetch<T>(
  fetcher: () => Promise<T>,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  }
): {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  retry: () => void;
}
```

Features:
- Automatic retry with exponential backoff (1s, 2s, 4s, 8s)
- Jitter to prevent thundering herd
- Circuit breaker integration (stop retrying if server says "CIRCUIT_OPEN")
- Offline detection for mobile

**4.2 Service Status Banner**

Add a `NetworkBlockedBanner` enhancement that shows:
- "System under heavy load - some features temporarily disabled"
- "Payment service recovering - please wait"
- Auto-dismiss when services recover

---

## Expected Outcomes

| Metric | Current | After Enhancement |
|--------|---------|-------------------|
| user_roles seq scans | 858k | <10k (99% reduction) |
| orders seq scans | 570k | <20k (96% reduction) |
| RLS check latency | ~5-10ms | <1ms |
| Manual cleanup required | Yes | No (automated) |
| Admin visibility into circuits | None | Full dashboard |
| Mobile retry on failures | Basic | Exponential backoff |

---

## File Changes Summary

### New Files
1. `supabase/functions/admin-system-health/index.ts` - Comprehensive diagnostics endpoint
2. `src/hooks/useResilientFetch.ts` - Client-side resilience hook
3. `src/components/admin/SystemLoadWidget.tsx` - Load level visualization
4. `src/components/admin/CircuitBreakerStatus.tsx` - Circuit breaker dashboard

### Modified Files
1. `src/pages/admin/Health.tsx` - Add circuit breaker and load widgets
2. `supabase/config.toml` - Add new edge function config

### Database Changes
1. Migration for additional composite indexes
2. SQL insert for new cron job schedules
3. RLS function optimizations

---

## Rollback Plan

Each phase has independent rollback:

**Phase 1 (Indexes)**: 
```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_user_roles_user_lookup;
-- ... other indexes
```

**Phase 2 (Cron Jobs)**:
```sql
SELECT cron.unschedule('cleanup-all-expired-data-hourly');
SELECT cron.unschedule('catalog-prewarm-home-12h');
SELECT cron.unschedule('analyze-critical-tables-daily');
```

**Phase 3 & 4 (Code)**: Git revert of component files

---

## Technical Notes

- All `CREATE INDEX CONCURRENTLY` operations are non-blocking
- Cron jobs use `x-cron-secret` header (already configured as `CRON_SECRET`)
- Circuit breaker state is per-edge-function-instance (not shared)
- Load shedding is request-scoped (per-invocation fresh)
