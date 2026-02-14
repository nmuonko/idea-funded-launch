

# Optimize Product Detail: Add Diagnostic Headers + Confirm Architecture

## Current State Analysis

### Frontend (already correct -- no changes needed)
The `ProductDetails.tsx` already implements the "instant render" pattern:
- **Line 144-168**: On route change, immediately sets product from navigation state (title, image, price from the listing card)
- **Line 166**: `setLoading(!nav)` -- if nav data exists, loading is `false` immediately, so the page renders instantly
- **Line 233-258**: When the live fetch completes, it merges new data (variants, description, more images) into the existing product state
- **Line 531-563**: Variant selectors appear as soon as `product.variants` is populated

Users never see a blank screen -- they see listing data immediately and variants "drop in" when ready.

### Backend (needs headers + minor cleanup)
The `catalog-product/index.ts` flow is already lean for cache hits:
1. DB lookup (~50ms)
2. Variants cache lookup (~50ms)
3. Return -- total ~100ms

For cache misses (live fetch), it's:
1. DB lookup (miss) ~50ms
2. Variants cache lookup (miss) ~50ms
3. Legacy catalog_products check ~50ms (Amazon only)
4. Live Rainforest/eBay fetch ~3-6s
5. Cache write + return

**What's missing**: No diagnostic headers to verify timing, no `X-Variants-Cache` header to confirm cache behavior.

## Changes

### File: `supabase/functions/catalog-product/index.ts`

**1. Add diagnostic response headers to ALL response paths**

Add these headers to every `new Response(...)` call:

```
X-Variants-Cache: HIT | MISS | SKIP
X-Provider: amazon | ebay
X-Upstream-Ms: <number>  (0 if no live fetch)
X-Total-Ms: <number>
X-Source: db | db+variants_cache | db-legacy | live-rainforest | live-ebay
```

Update `corsHeaders` to expose them:
```typescript
"Access-Control-Expose-Headers": "content-type, X-Variants-Cache, X-Provider, X-Upstream-Ms, X-Total-Ms, X-Source"
```

**2. Track timing for each stage**

Add timing variables at the start:
```typescript
let tDbLookup = 0;
let tVariantsCache = 0;
let tUpstream = 0;
```

Wrap each stage with `Date.now()` measurements. Build a `responseHeaders` object that includes both `corsHeaders` and the timing headers, used by all response paths.

**3. Remove legacy catalog_products fallback for speed (optional but recommended)**

Lines 488-549 query `catalog_products` table as a fallback before live fetch. This adds ~50ms latency on every cache miss for a table that may have stale/incomplete data. Consider removing or making it non-blocking.

**4. Confirm no blocking enrichment in the path**

Verified: There is NO call to `enrichItemsWithMediaCounts` or any per-item HTTP enrichment in the product detail endpoint. The path is already clean: DB check, variants cache check, optional live fetch, respond.

### No frontend changes

Per project constraints, the frontend is not modified. It already handles the "instant render + lazy variant load" pattern correctly.

### No prefetch changes

Prefetching top search results' variants would require frontend changes (firing background fetches after search renders). This is deferred per project constraints.

## Summary of Edits

| File | Change |
|------|--------|
| `supabase/functions/catalog-product/index.ts` | Add X-Variants-Cache, X-Provider, X-Upstream-Ms, X-Total-Ms, X-Source headers to all response paths. Track stage timings. Update CORS expose headers. |

## Verification

After deployment, check in DevTools Network tab on any product click:
- **Cache hit**: `X-Variants-Cache: HIT`, `X-Total-Ms: ~100`, `X-Upstream-Ms: 0`
- **Cache miss**: `X-Variants-Cache: MISS`, `X-Total-Ms: ~4000`, `X-Upstream-Ms: ~3500`
- **Second click same product**: `X-Variants-Cache: HIT`, near-instant

