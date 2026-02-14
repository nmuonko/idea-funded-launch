

# Backend Optimization for 5,000-10,000 Concurrent Users

## Current State

Your backend is already well-architected with multi-layer caching, rate limiting, and lightweight SDK-free database clients. The main bottlenecks for scaling to 5K-10K users are:

1. **Frontend re-fetching**: Most queries have no `staleTime` configured, causing unnecessary repeated API calls on every component mount
2. **Database connection pressure**: Every rate limit check and cache lookup is a separate DB round-trip
3. **No in-memory caching at the edge**: Every request hits the database even for hot data like settings and exchange rates
4. **Cleanup functions run inline**: Expired cache cleanup competes with user-facing queries

## Optimization Plan

### 1. Frontend: Add Global Query Caching (Biggest Impact)

Configure TanStack Query with sensible defaults so the browser caches responses and avoids redundant API calls. This alone can reduce backend load by 50-70%.

**File: `src/App.tsx` (or wherever QueryClient is created)**
- Set default `staleTime` to 2 minutes and `gcTime` to 10 minutes
- This means repeated page navigations reuse cached data instead of hitting the backend

### 2. Edge Functions: In-Memory Settings Cache

The `mobile-get-cart`, `mobile-checkout`, and other critical functions call `getCachedSettings()` on every request. Add a simple in-memory TTL cache (60s) inside the shared settings helper so repeated invocations within the same edge function instance skip the DB entirely.

**File: `supabase/functions/_shared/settings-cache.ts`**
- Add module-level variable to store settings + timestamp
- Return cached value if < 60 seconds old
- This eliminates ~1 DB query per request for all cart/checkout/pricing operations

### 3. Edge Functions: Batch Rate Limit Check

Currently `checkDualRateLimit` makes 2 sequential DB calls (user + IP). Combine into a single DB function call.

**File: `supabase/functions/_shared/rateLimiter.ts`**
- Already uses `Promise.all` (good), but create a new `check_dual_rate_limit` DB function that checks both keys in one round-trip

**New DB function: `check_dual_rate_limit`**
- Accepts both keys, returns both results in one call
- Cuts rate-limiting latency in half

### 4. Add HTTP Cache Headers to Read-Only Endpoints

For catalog browsing (home, search, product details), add `Cache-Control` headers so browsers and CDNs can cache responses without hitting your backend at all.

**Files: `catalog-home/index.ts`, `catalog-search/index.ts`, `catalog-product/index.ts`**
- `catalog-product` already has `Cache-Control: public, max-age=300` (good)
- Add similar headers to `catalog-home` (max-age=120) and `catalog-search` (max-age=60)

### 5. Optimize Database Indexes for Hot Paths

Add composite indexes for the most frequent query patterns to reduce DB CPU under load.

**New migration:**
- Index on `catalog_cache(cache_key, expires_at)` if not already present
- Index on `order_items(order_id, is_saved_for_later)` for cart queries
- Partial index on `orders(user_id) WHERE status = 'DRAFT'` for active cart lookups

## Technical Details

### Files to Modify
1. `src/App.tsx` or `src/main.tsx` -- QueryClient default options
2. `supabase/functions/_shared/settings-cache.ts` -- In-memory TTL cache
3. `supabase/functions/_shared/rateLimiter.ts` -- Batch rate limit helper
4. `supabase/functions/catalog-home/index.ts` -- Cache-Control headers
5. `supabase/functions/catalog-search/index.ts` -- Cache-Control headers
6. New DB migration -- Composite indexes for hot paths
7. New DB function -- `check_dual_rate_limit` for single-call rate checking

### Expected Impact

```text
Optimization                    | Load Reduction | Latency Impact
--------------------------------|----------------|----------------
Frontend staleTime defaults     | -50-70% calls  | Instant nav
In-memory settings cache        | -1 query/req   | -5-15ms/req
Batch rate limit check          | -1 query/req   | -10-20ms/req
HTTP Cache-Control headers      | -20-30% calls  | 0ms (cached)
Database indexes                | CPU savings     | -5-10ms/query
```

### No Infrastructure Changes Needed

These are all code-level optimizations. The managed infrastructure auto-scales edge functions, so the goal is to reduce the load each request puts on the database -- which is the true bottleneck at scale.

