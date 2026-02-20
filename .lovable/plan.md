

## Fix Slow Loading for Vehicles and Parts & Accessories Grids

### Root Cause

Vehicles and Parts & Accessories use a **3-stage sequential waterfall** to curate exactly 4 items:

1. `catalog-category` call (fetch + filter)
2. `catalog-home` fallback (fetch + filter)  
3. `catalog-search` live search (multiple queries, sequential)

Even though each individual network call is cached via `cachedCatalogFetch`, the **curation pipeline** still runs on every page load -- filtering, deduplicating, and validating items across all 3 stages serially. Standard categories only need 1-2 calls, which is why they load fast.

### Solution: Cache the Final Curated Result

After the pipeline produces its final 4 items for vehicles/parts_accessories, **save them to localStorage**. On the next page load, show the cached items instantly (0ms) and refresh in the background.

---

### Changes

**File: `src/pages/shop/ShopHome.tsx`**

1. Add two helper functions at the top:
   - `getCachedCategoryResult(catKey)` -- reads a cached 4-item array from localStorage (key: `afrishop_curated:<catKey>`, TTL: 1 hour)
   - `setCachedCategoryResult(catKey, items)` -- writes the curated items with a timestamp

2. At the start of each category task in `fetchAllCategoryItems`, **before** running the multi-stage pipeline:
   - Call `getCachedCategoryResult(catKey)` for vehicles and parts_accessories
   - If a valid (non-expired) cached result exists, set it immediately via `setCategoryItems` and mark loading as false
   - Still run the full pipeline in the background to refresh the cache silently

3. At the end of the pipeline (after `items` is finalized), call `setCachedCategoryResult(catKey, items)` to persist the new result

This means:
- **First load ever**: Same speed as today (pipeline runs normally)
- **Every subsequent refresh**: Instant render from curated cache, then silent background refresh
- Standard categories are unaffected (they're already fast)

### Expected Result

| Scenario | Before | After |
|---|---|---|
| Page refresh (vehicles) | 3-8 seconds (3-stage waterfall) | Instant (cached curated result) |
| Page refresh (parts) | 3-8 seconds (3-stage waterfall) | Instant (cached curated result) |
| First visit ever | Same as today | Same as today |
| Cache expired (>1 hour) | Same as today | Same as today |

### No changes to
- Backend / edge functions
- Other categories (already fast)
- The multi-stage curation logic itself (still runs for freshness)
- Cache TTL strategy

