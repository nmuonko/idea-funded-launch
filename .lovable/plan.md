

# Fix: Homepage Showing Only Laptops — Per-Seed Balancing in Web Recipe Builder

## Root Cause

The `homepage` recipe has 12 seed queries (iPhone 15 Pro Max, Samsung Galaxy S24, MacBook Pro, PlayStation 5, gaming laptop, etc.). The `fetchItemsFromDB` function in `homeRecipeBuilder.ts` combines ALL seed queries into a single SQL query with OR clauses, ordered by `updated_at DESC`, limited to 300.

The problem: whichever product type was most recently refreshed in `catalog_items` dominates the results. Right now, MacBook Pro items were recently crawled/updated, so the first 100 items returned are all MacBook Pros. Phones, TVs, sneakers, etc. are pushed out entirely.

**Current cached homepage data**: All 100 items tagged `_recipeKey=homepage` are MacBook Pro listings.

## Fix

Change `fetchItemsFromDB` to use a **per-seed quota** strategy instead of a single combined query. Each seed gets an equal share of the target count.

### File: `supabase/functions/_shared/homeRecipeBuilder.ts`

**Replace `fetchItemsFromDB`** (lines 132-174):

Instead of one big OR query, fetch items **per seed** with a per-seed limit, then merge and shuffle.

```text
Current (broken):
  OR all 12 seed queries together
  ORDER BY updated_at DESC
  LIMIT 300
  -> MacBook dominates because it has newest updates

Fixed:
  FOR EACH seed (12 seeds, target=100):
    perSeedLimit = ceil(targetCount / seeds.length) * 2  // e.g. ceil(100/12)*2 = 18
    Query: title ILIKE '%seed_query%' ORDER BY updated_at DESC LIMIT perSeedLimit
  MERGE all results, dedup by ID
  SHUFFLE to mix categories
  Return first targetCount items
```

This ensures each seed contributes roughly equal items (8-9 per seed for 100 total with 12 seeds), giving phones, laptops, TVs, and other categories fair representation.

### After code change: Force cache rebuild

The existing cached data in `home_cache_web_feed` will remain stale until the TTL expires (up to 10 hours). To see changes immediately, either:
- Trigger a manual rebuild via the admin portal
- Or call the `home-auto-refresh` edge function

## Technical Details

### Modified function signature (no change)

```typescript
async function fetchItemsFromDB(
  seeds: SeedRow[],
  targetCount: number,
  minPrice?: number | null,
  maxPrice?: number | null
): Promise<RecipeItem[]>
```

### New implementation approach

1. Calculate `perSeedLimit = Math.ceil((targetCount * 2) / seeds.length)` (over-fetch slightly per seed to account for filtering)
2. Fire parallel fetch requests per seed (up to 12 seeds, capped at 12 parallel requests)
3. Collect results, deduplicate by item ID
4. Shuffle the merged array (Fisher-Yates) to prevent any single seed from clustering at the top
5. Return the first `targetCount` items

### Shuffle function

A simple Fisher-Yates shuffle will ensure the homepage has a visually diverse mix of phones, laptops, TVs, sneakers, etc. on every rebuild.

### Impact

- Web homepage "Accueil" tab will show a balanced mix of all 12 seeded product categories
- Mobile homepage is NOT affected (uses separate section-based architecture with its own seeds)
- Other web tabs (phones, vehicles, gaming, etc.) are NOT affected (each has its own recipe with category-specific seeds)
- Cache will need a rebuild after deployment to reflect the new distribution

### Files modified
- `supabase/functions/_shared/homeRecipeBuilder.ts` -- replace `fetchItemsFromDB` with per-seed balanced fetching

