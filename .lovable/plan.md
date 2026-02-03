
# Build "Market Search Proxy" Backend System

## Overview

Create a production-ready search proxy edge function that wraps eBay and Amazon APIs into a single, frontend-agnostic endpoint with platform gating, caching, rate limiting, and structured logging.

## Architecture

```text
┌─────────────────┐     ┌──────────────────────────────────┐
│  Mobile/Web     │────►│  market-search-proxy             │
│  Frontend       │     │  (Edge Function)                 │
└─────────────────┘     └──────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│ Feature Flags │          │ Rate Limiter  │          │ Search Proxy  │
│ (platform     │          │ (IP + User)   │          │ Cache         │
│  gating)      │          │               │          │ (15min TTL)   │
└───────────────┘          └───────────────┘          └───────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼                               ▼
            ┌───────────────┐               ┌───────────────┐
            │ eBay Browse   │               │ Rainforest/   │
            │ API (reuse    │               │ Amazon        │
            │ ebayAdapter)  │               │ (reuse        │
            └───────────────┘               │ rainforest)   │
                                            └───────────────┘
```

## What Gets Built

| Component | Description |
|-----------|-------------|
| `market-search-proxy/index.ts` | New unified edge function |
| `_shared/proxyProviders.ts` | Provider adapters with exact response normalization |
| `_shared/proxyCache.ts` | Cache helper with SHA-256 key generation |
| `feature_flags` table | Platform-specific toggles (ios/android/web/all) |
| `search_proxy_cache` table | Per-source cache with 15min TTL |
| RLS policies | Block all direct client access to control tables |

---

## Response Schema (Exact Match Required)

```json
{
  "query": "infiniti qx80",
  "sourceRequested": "both",
  "sourceServed": ["ebay"],
  "page": 1,
  "limit": 24,
  "hasMore": true,
  "items": [
    {
      "source": "ebay",
      "externalId": "v1|123...",
      "title": "2024 Infiniti QX80 Luxe 4WD",
      "price": 72500.00,
      "currency": "USD",
      "imageUrl": "https://...",
      "itemUrl": "https://...",
      "condition": "new",
      "shippingPrice": 0,
      "sellerName": "AutoDealer123",
      "location": "Los Angeles, CA",
      "raw": {}
    }
  ],
  "timingsMs": { "ebay": 210, "amazon": 0, "total": 280 },
  "cache": { "hit": false, "ttlSeconds": 900 },
  "errors": []
}
```

---

## Database Changes

### 1. Feature Flags Table

```sql
CREATE TABLE public.feature_flags (
  key text NOT NULL,
  platform text NOT NULL DEFAULT 'all',
  enabled boolean NOT NULL DEFAULT true,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, platform)
);

-- Index for fast lookups
CREATE INDEX idx_feature_flags_key ON public.feature_flags(key);

-- Seed initial flags
INSERT INTO public.feature_flags (key, platform, enabled, description) VALUES
  ('enable_amazon', 'all', true, 'Enable Amazon search globally'),
  ('enable_amazon', 'ios', false, 'Disable Amazon for iOS App Review'),
  ('enable_ebay', 'all', true, 'Enable eBay search globally');

-- RLS: Block all direct client access
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_client_access" ON public.feature_flags
  FOR ALL USING (false) WITH CHECK (false);
```

### 2. Search Proxy Cache Table

```sql
CREATE TABLE public.search_proxy_cache (
  cache_key text PRIMARY KEY,
  source text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Index for expiration cleanup
CREATE INDEX idx_search_proxy_cache_expires ON public.search_proxy_cache(expires_at);

-- RLS: Block all direct client access
ALTER TABLE public.search_proxy_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_client_access" ON public.search_proxy_cache
  FOR ALL USING (false) WITH CHECK (false);
```

---

## Edge Function Implementation

### File: `supabase/functions/market-search-proxy/index.ts`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search keywords |
| `source` | enum | No | "both" | "ebay" \| "amazon" \| "both" |
| `minPrice` | number | No | - | Minimum price (USD) |
| `maxPrice` | number | No | - | Maximum price (USD) |
| `condition` | enum | No | "any" | "new" \| "used" \| "refurbished" \| "any" |
| `sort` | enum | No | "best" | "best" \| "price_asc" \| "price_desc" \| "newly_listed" |
| `limit` | number | No | 24 | Results per page (max 50) |
| `page` | number | No | 1 | Page number |
| `currency` | string | No | "USD" | Currency code |
| `country` | string | No | "US" | Country code |
| `category` | string | No | - | Internal category key |
| `clientPlatform` | enum | No | - | "ios" \| "android" \| "web" |

**Core Logic Flow:**

1. **CORS Handling** - Handle OPTIONS preflight
2. **Parse & Validate** - Strict input validation (reject bad input with 400)
3. **Rate Limit Check** - Uses existing `check_rate_limit` RPC
   - Key format: `ip:{ip}:market-search` and `user:{userId}:market-search`
   - Limits: 60/5min per IP, 120/5min per user (if authenticated)
4. **Feature Flag Check** - Query `feature_flags` table
   - Platform-specific row overrides 'all'
   - If amazon disabled for platform, exclude from sources
5. **Cache Lookup** - Per-source cache with SHA-256 key
   - Key includes all params for cache isolation
   - TTL = 900 seconds (15 minutes)
6. **Provider Calls** - Parallel fetch from enabled, non-cached sources
7. **Normalize Results** - Map to `NormalizedItem` interface
8. **Store Cache** - Upsert with expires_at = now() + 900s
9. **Return Response** - Exact schema with timings, cache status, errors

---

## Provider Adapters

### File: `supabase/functions/_shared/proxyProviders.ts`

**Reuses existing adapters:**
- `searchEbay()` from `ebayAdapter.ts`
- `searchRainforest()` from `rainforestAdapter.ts`

**NormalizedItem Interface:**

```typescript
interface NormalizedItem {
  source: "ebay" | "amazon";
  externalId: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  itemUrl: string;
  condition: "new" | "used" | "refurbished" | "unknown";
  shippingPrice: number;
  sellerName: string | null;
  location: string | null;
  raw: Record<string, unknown>;
}
```

**eBay Sort Mapping:**

| Input | eBay API Value |
|-------|----------------|
| best | BEST_MATCH (null = default) |
| price_asc | price |
| price_desc | -price |
| newly_listed | newlyListed |

**eBay Condition Mapping:**

| Input | eBay Condition IDs |
|-------|-------------------|
| new | 1000 |
| used | 3000 |
| refurbished | 2000\|2500 |
| any | 1000\|1500\|2000\|2500\|3000 |

**Graceful Degradation:**
- If `source=both` and one provider fails: return other provider's results, add error to `errors[]`
- If single source fails: return 502 with safe error message

---

## Cache Helper

### File: `supabase/functions/_shared/proxyCache.ts`

**Cache Key Generation:**
- SHA-256 hash of: `source|q|minPrice|maxPrice|condition|sort|limit|page|currency|country|category|clientPlatform`
- Prefix with source: `ebay:abc123...` or `amazon:def456...`

**Functions:**
- `generateCacheKey(source, params)` - Returns SHA-256 hash
- `getCachedResult(supabase, cacheKey)` - Returns cached payload or null
- `setCachedResult(supabase, cacheKey, source, payload, ttlSeconds)` - Upserts cache entry
- `isExpired(expiresAt)` - Checks if cache entry is expired

---

## Rate Limiting

Uses existing `check_rate_limit` RPC and `rate_limits` table.

| Context | Key Format | Limit | Window |
|---------|-----------|-------|--------|
| Anonymous (per IP) | `ip:{ip}:market-search` | 60 requests | 5 minutes |
| Authenticated (per user) | `user:{userId}:market-search` | 120 requests | 5 minutes |

**Behavior:**
- Both checks run in parallel
- If either fails, return 429 with `Retry-After` header
- On RPC error, fail open (allow request)

---

## Feature Flag Logic

**Query pattern:**
```sql
SELECT key, platform, enabled 
FROM feature_flags 
WHERE key IN ('enable_amazon', 'enable_ebay')
  AND platform IN ('all', :clientPlatform)
```

**Resolution:**
1. Get all rows for key
2. If platform-specific row exists, use it
3. Otherwise, use 'all' row
4. If no row exists, default to enabled=true

**Example:**
- Request: `clientPlatform=ios`
- Flags: `enable_amazon` has `ios=false`, `all=true`
- Result: Amazon disabled, eBay enabled

---

## Structured Logging

All logs use JSON format with `[SEARCH_PROXY]` prefix:

```
[SEARCH_PROXY] request {"q":"iphone","source":"both","page":1,"limit":24,"platform":"ios"}
[SEARCH_PROXY] rate_limit {"allowed":true,"remaining":55,"key":"ip:1.2.3.4:market-search"}
[SEARCH_PROXY] feature_check {"amazon":false,"ebay":true,"platform":"ios"}
[SEARCH_PROXY] cache_hit {"source":"ebay","cache_key":"ebay:a1b2c3..."}
[SEARCH_PROXY] cache_miss {"source":"amazon","cache_key":"amazon:d4e5f6..."}
[SEARCH_PROXY] ebay_ok {"items":24,"durationMs":210}
[SEARCH_PROXY] amazon_err {"error":"Rate limited","durationMs":50}
[SEARCH_PROXY] response {"items":24,"hasMore":true,"totalMs":280,"sourceServed":["ebay"]}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Auto-provided |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Auto-provided |
| `EBAY_CLIENT_ID` | Yes | Already configured |
| `EBAY_CLIENT_SECRET` | Yes | Already configured |
| `EBAY_MARKETPLACE_ID` | No | Default: EBAY_US |
| `RAINFOREST_API_KEY` | Yes | Already configured |
| `AMAZON_PROVIDER` | No | "rainforest" (default) or "paapi" |

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/market-search-proxy/index.ts` | Create | Main edge function |
| `supabase/functions/_shared/proxyProviders.ts` | Create | Provider wrapper with normalization |
| `supabase/functions/_shared/proxyCache.ts` | Create | Cache helper functions |
| SQL Migration | Create | Tables + RLS policies |

---

## Testing Examples (in code comments)

```bash
# eBay only
GET /market-search-proxy?q=iphone&maxPrice=200&source=ebay&limit=24&page=1

# Both providers
GET /market-search-proxy?q=iphone&maxPrice=200&source=both

# iOS gating (amazon disabled)
GET /market-search-proxy?q=iphone&source=both&clientPlatform=ios
# Response: sourceServed: ["ebay"] only

# Pagination
GET /market-search-proxy?q=laptop&page=1&limit=24
GET /market-search-proxy?q=laptop&page=2&limit=24
# Different items, hasMore changes appropriately
```

---

## Security Considerations

1. **Secrets never exposed** - No API keys in logs or responses
2. **RLS blocks client access** - `feature_flags` and `search_proxy_cache` inaccessible via client SDK
3. **Input validation** - Strict type/range checks on all params
4. **Rate limiting** - Dual IP + user limits prevent abuse
5. **Error sanitization** - No raw provider errors leaked to clients
6. **Service role only** - Edge function uses service role to access protected tables

---

## Implementation Notes

1. **Reuses existing infrastructure:**
   - `ebayAdapter.ts` for eBay OAuth and search
   - `rainforestAdapter.ts` for Amazon search
   - `rateLimiter.ts` for rate limiting helpers
   - `check_rate_limit` RPC function already exists

2. **New tables are isolated:**
   - `feature_flags` for platform gating
   - `search_proxy_cache` for proxy-specific caching (separate from existing `catalog_cache`)

3. **No frontend changes required:**
   - This is a new endpoint, not replacing existing `/catalog-search`
   - Frontend can migrate to this endpoint when ready

4. **PA-API support stubbed:**
   - Code checks `AMAZON_PROVIDER` env var
   - If "paapi", would use SigV4 signing (implementation deferred)
   - Default is "rainforest" using existing adapter
