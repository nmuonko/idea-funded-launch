
# Admin-controlled TTL Caching + Instant Search Response

## Overview

Add stale-while-revalidate caching to `market-search-proxy` and `market-item-details-proxy` for near-instant responses, with TTL values controllable from the admin portal.

## What Changes

| Component | Change |
|-----------|--------|
| `admin_settings` table | Add 3 new keys for proxy cache TTLs |
| `proxyCache.ts` | Add stale-while-revalidate logic |
| `market-search-proxy` | Read TTLs from admin_settings, implement cache-first pattern |
| `market-item-details-proxy` | Same cache-first pattern with item TTL |
| Response schema | Add optional `stale` and `ageSeconds` to cache object |

## Why Use Existing admin_settings

The project already has a well-established pattern using the `admin_settings` table for cache TTLs (search, home, offers, etc.) accessed via `getCatalogSettings()`. Creating a new `app_settings` table would duplicate infrastructure. Instead, we'll add three new keys to the existing table:

- `proxy_search_cache_ttl_seconds` (default: 900 = 15 min)
- `proxy_item_cache_ttl_seconds` (default: 300 = 5 min)  
- `proxy_stale_max_seconds` (default: 21600 = 6 hours)

---

## Database Changes

### Migration: Add proxy cache settings to admin_settings

```sql
-- Add proxy cache TTL settings
INSERT INTO public.admin_settings (key, value) VALUES
  ('proxy_search_cache_ttl_seconds', '900'),
  ('proxy_item_cache_ttl_seconds', '300'),
  ('proxy_stale_max_seconds', '21600')
ON CONFLICT (key) DO NOTHING;
```

This uses the existing `admin_settings` table structure rather than creating a new table.

---

## Cache-First Logic (Stale-While-Revalidate)

```text
Request arrives
    │
    ▼
┌─────────────────┐
│ Load TTL from   │
│ admin_settings  │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Check cache     │
└─────────────────┘
    │
    ├── Cache exists AND not expired ──► Return immediately (hit=true, stale=false)
    │
    ├── Cache exists AND expired      
    │   BUT age < staleMax ──────────► Return immediately (hit=true, stale=true)
    │                                   + Start background refresh (don't wait)
    │
    └── No cache OR too old ─────────► Fetch live, store, return (hit=false)
```

---

## Response Schema Updates

Keep backward compatibility, add optional fields:

```typescript
cache: {
  hit: boolean;
  ttlSeconds: number;
  stale?: boolean;      // NEW: true if returned stale data
  ageSeconds?: number;  // NEW: how old the cached data is
}
```

---

## Files to Modify

### 1. SQL Migration

Add new settings to existing `admin_settings` table.

### 2. `_shared/proxyCache.ts`

Add new functions:

- `getCacheWithAge()` - Returns cache entry with age info
- `CachedResult` type with `created_at` timestamp
- `triggerBackgroundRefresh()` - Non-blocking refresh

Update `CachedPayload` to include creation timestamp.

### 3. `market-search-proxy/index.ts`

Changes:
- Load TTL settings at start of request
- Replace cache lookup with stale-aware version
- Return stale data immediately when within staleMax window
- Fire background refresh for stale entries
- Add new logging for settings and stale returns

### 4. `market-item-details-proxy/index.ts`

Same pattern:
- Load `proxy_item_cache_ttl_seconds` from settings
- Cache-first with stale-while-revalidate
- Background refresh for expired-but-usable entries

---

## New Logging

```
[SEARCH_PROXY] settings {"ttlFresh":900,"ttlStaleMax":21600}
[SEARCH_PROXY] cache_returned {"hit":true,"stale":false,"ageSeconds":120}
[SEARCH_PROXY] cache_returned {"hit":true,"stale":true,"ageSeconds":1800}
[SEARCH_PROXY] refresh_started {"source":"ebay","cacheKey":"ebay:abc..."}
[SEARCH_PROXY] refresh_done {"source":"ebay","items":24,"durationMs":340}
```

---

## Settings Helper Update

Add to `_shared/proxyCache.ts`:

```typescript
interface ProxyCacheSettings {
  searchTtlSeconds: number;
  itemTtlSeconds: number;
  staleMaxSeconds: number;
}

async function getProxyCacheSettings(supabase): Promise<ProxyCacheSettings> {
  // Fetch from admin_settings with defaults
}
```

---

## Background Refresh Pattern

For stale-while-revalidate, we need to trigger a refresh without blocking:

```typescript
// Don't await - fire and forget
triggerBackgroundRefresh(supabase, source, params, cacheKey, ttlFresh);

// Immediately return stale data
return response;
```

The refresh function will:
1. Fetch from provider
2. Update cache with new `expires_at`
3. Log completion

Edge Functions can handle this because they don't terminate immediately after returning a response - Deno keeps the process alive for pending promises.

---

## Edge Cases

1. **Settings missing**: Use hardcoded defaults (900s search, 300s item, 21600s stale)
2. **Cache read error**: Fall back to live fetch
3. **Background refresh fails**: Silent failure, cache remains stale until next request
4. **Very old cache (age > staleMax)**: Treat as cache miss, fetch live

---

## Admin Portal Integration

The settings will be editable via the existing `CatalogSourcesSettings.tsx` page or can be added to a dedicated "Proxy Settings" section. The `admin_settings` table already supports any key-value pair, so no schema changes are needed beyond seeding defaults.
