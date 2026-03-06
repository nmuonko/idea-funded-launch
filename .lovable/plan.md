

# Batch 7: Catalog Consolidation — Revised Approach

## Problem with Inlining

The catalog functions are fundamentally different from Batches 2-6. The core functions are massive standalone modules:

| Function | Lines | Imports |
|----------|-------|---------|
| `catalog-search` | 1,932 | 20+ shared modules |
| `catalog-home` | 1,696 | 10+ shared modules |
| `catalog-product` | 1,419 | 8+ shared modules |
| `catalog-category` | 835 | 15+ shared modules |
| `catalog-collection` | 721 | 3 shared modules |
| `catalog-filters` | 555 | 3 shared modules |
| `catalog-nav` | 301 | 1 shared module |
| `catalog-offers` | 277 | 5 shared modules |
| `catalog-prewarm-home` | 258 | 3 shared modules |
| `catalog-categories` | 246 | 3 shared modules |
| `catalog-providers` | 196 | 2 shared modules |
| `catalog-tabs` | 177 | 0 shared modules |

**Inlining all into one file would produce ~8,600+ lines** — unmaintainable and likely to hit Deno deploy bundle limits. Additionally, the frontend calls these via `cachedCatalogFetch()` which constructs direct URLs like `SUPABASE_URL/functions/v1/catalog-search`, not `supabase.functions.invoke()`. This means routing through a single endpoint would break the URL-based caching strategy.

## Recommended Approach: Thin Router for Metadata Functions Only

Consolidate the **lightweight metadata/config functions** (< 300 lines each) into a single `catalog-service` router. Keep the heavy data functions as standalone endpoints.

### What gets consolidated into `catalog-service`:

| Action | Original Function | Lines |
|--------|-------------------|-------|
| `tabs` | `catalog-tabs` | 177 |
| `categories` | `catalog-categories` | 246 |
| `nav` | `catalog-nav` | 301 |
| `providers` | `catalog-providers` | 196 |
| `prewarm` | `catalog-prewarm-home` | 258 |

These are low-traffic config/metadata endpoints that benefit from consolidation (fewer cold starts, single deployment unit).

### What stays as standalone:

| Function | Reason |
|----------|--------|
| `catalog-search` | 1,932 lines, performance-critical, URL-based caching |
| `catalog-product` | 1,419 lines, diagnostic headers, performance-critical |
| `catalog-home` | 1,696 lines, mobile/web branching, cache-first |
| `catalog-category` | 835 lines, heavy provider mixing logic |
| `catalog-collection` | 721 lines, standalone data endpoint |
| `catalog-filters` | 555 lines, standalone data endpoint |
| `catalog-offers` | 277 lines, rate-limited, diagnostic headers |

### Implementation Steps

1. **Create `supabase/functions/catalog-service/index.ts`** — Router with inlined logic for `tabs`, `categories`, `nav`, `providers`, `prewarm` (not proxy, actual logic moved in).

2. **Update frontend references:**
   - `src/components/shop/CategoryTabs.tsx` — change `catalog-tabs` → `catalog-service?action=tabs`
   - `src/pages/admin/HomeRecipes.tsx` — change `catalog-prewarm-home` → `catalog-service?action=prewarm`
   - `src/pages/admin/CatalogSourcesSettings.tsx` — change `catalog-prewarm-home` → `catalog-service?action=prewarm`

3. **Add JWT auth gate** to `catalog-service` (with `prewarm` requiring admin/cron auth, others public).

4. **Update `config.toml`** — register `catalog-service`.

5. **Update `.lovable/plan.md`** — mark Batch 7 complete with notes on what was consolidated vs kept standalone.

### About Inlining for Batches 2-6

Regarding the second part of the request — inlining business logic into the existing routers (mobile-cart, auth-service, etc.) to eliminate internal fetch overhead — this is a separate, larger effort. Each router currently proxies to 3-10 original functions. Inlining means:

- Copying all business logic from each target function into the router
- Resolving import conflicts (different functions import different shared modules)
- Testing each action path independently

**Recommendation:** Tackle inlining as a separate Batch 8, one service at a time, starting with the simplest (`support-service`, 3 actions) as a proof-of-concept.

