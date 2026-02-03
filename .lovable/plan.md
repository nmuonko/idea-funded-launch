

# Make Search Instant with Global Result Caching

## Problem Analysis

Currently, every search request performs the full provider flow:

```text
User Search: "iphone 15"
            ↓
1. Parse params, vehicle detection (~5ms)
2. Query rewrite + DB lookup (~20-50ms)
3. Load catalog settings (~20-50ms)
4. Amazon API or cache lookup (~100-500ms)
5. eBay LIVE API call (~300-800ms)  ← ALWAYS LIVE!
6. Mix results + filter (~10ms)
7. Media enrichment (~50-100ms)
            ↓
Total: 500ms - 1500ms per request
```

**Key finding**: The `buildCacheKey`, `getCache`, and `setCache` functions are imported but **never used** for the final mixed response. This means even if 100 users search for "iphone 15", each one triggers fresh eBay API calls.

---

## Solution: Add Global Search Cache Layer

Add an early cache check that returns instantly when a recent search exists:

```text
User Search: "iphone 15"
            ↓
1. Normalize + canonicalize query (~1ms)
2. Build cache key
3. Check catalog_cache → CACHE HIT!
            ↓
Return cached response (~10ms total)
```

### Performance Improvement

| Scenario | Before | After |
|----------|--------|-------|
| First search for "iphone 15" | ~800ms | ~800ms (same - cache miss) |
| Second user searches "iphone 15" | ~800ms | **~10-20ms** (cache hit) |
| "iphon 15" (typo) | ~800ms | **~10-20ms** (canonicalized + cache hit) |
| Popular search (100 users) | 100 API calls | 1 API call + 99 cache hits |

---

## Technical Implementation

### 1. Add Early Cache Check (before any provider calls)

**File:** `supabase/functions/catalog-search/index.ts`

After query rewriting completes (line ~435), add:

```typescript
// ─── GLOBAL CACHE CHECK ────────────────────────────────────────────────────
// Check for cached search results BEFORE calling providers
const globalCacheKey = buildCacheKey("search", {
  env: envName,
  query: qNorm,
  provider: providerParam || "all",
  category: categoryKey,
  page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
  pageSize: limit,
});

const cacheResult = await getCache(supabase, globalCacheKey);

if (cacheResult.hit && !cacheResult.stale) {
  // INSTANT RETURN: Fresh cache hit
  console.log(`[SEARCH] requestId=${requestId} GLOBAL CACHE HIT (${cacheResult.cacheAgeSec}s old)`);
  
  const cachedResponse = cacheResult.data;
  return new Response(JSON.stringify({
    ...cachedResponse,
    durationMs: Date.now() - startTime,
    _cacheHit: true,
    _cacheAgeSec: cacheResult.cacheAgeSec,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// If stale, continue but background-refresh after responding
const shouldBackgroundRefresh = cacheResult.hit && cacheResult.stale;
```

### 2. Cache the Final Response

At the end of the handler (before returning), cache the mixed results:

```typescript
// ─── CACHE FINAL RESPONSE ──────────────────────────────────────────────────
// Store for instant retrieval by subsequent users
setCache(supabase, "search", globalCacheKey, response, {
  provider: "mixed",
  query: qNorm,
  category: categoryKey || undefined,
  page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
  pageSize: limit,
  amazonDomain: "amazon.com",
});
```

### 3. Implement Stale-While-Revalidate (Optional Enhancement)

For even better UX, return stale data immediately while refreshing in the background:

```typescript
if (cacheResult.hit && cacheResult.stale) {
  // Return stale data IMMEDIATELY
  console.log(`[SEARCH] requestId=${requestId} STALE CACHE (${cacheResult.cacheAgeSec}s old) - returning + background refresh`);
  
  // Trigger background refresh (don't await)
  EdgeRuntime.waitUntil(refreshSearchInBackground(supabase, qNorm, globalCacheKey, ...));
  
  // Return stale immediately
  return new Response(JSON.stringify({
    ...cacheResult.data,
    durationMs: Date.now() - startTime,
    _staleCache: true,
  }), { ... });
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Add early cache check + cache final response |
| `supabase/functions/_shared/catalogCache.ts` | (Optional) Add search-specific TTL config if needed |

---

## Cache TTL Configuration

Using existing settings from `catalogCache.ts`:

| Metric | Value |
|--------|-------|
| **Stale After** | 10 minutes |
| **Expires After** | 30 minutes |
| **Typo Tolerance** | Already implemented via canonicalization |

This means:
- 0-10 minutes: Instant cache hit
- 10-30 minutes: Stale-while-revalidate (instant return + background refresh)
- 30+ minutes: Cache miss, full provider flow

---

## Expected Results

### Speed Improvement
- **Cache hits**: ~10-20ms (vs 500-1500ms before) = **50-100x faster**
- **Cache hit rate**: Estimated 70-85% for popular searches

### Cost Reduction
- **Fewer eBay API calls**: Only 1 call per unique query per 30 minutes
- **Fewer Amazon API calls**: Already somewhat cached, but this adds another layer

### User Experience
- **Instant results** for popular searches (iphone, samsung, playstation, etc.)
- **Consistent results** across users searching the same thing
- **Typo-tolerant**: "iphon" and "iphone" share the same cache

---

## Implementation Order

1. **Add early cache check** with instant return for fresh cache hits
2. **Add cache write** for final response after provider calls complete
3. **Add stale-while-revalidate** for smoother transitions
4. **Deploy and monitor** cache hit rate via logs

---

## Monitoring

Add logging to track cache performance:

```typescript
console.log(`[SEARCH_CACHE] requestId=${requestId} hit=${cacheResult.hit} stale=${cacheResult.stale} age=${cacheResult.cacheAgeSec}s key=${globalCacheKey.substring(0, 60)}...`);
```

This will help optimize TTL values based on real traffic patterns.

