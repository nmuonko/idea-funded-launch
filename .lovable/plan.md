

# Seed-Ordered, Balanced Product Display with Admin Drag-and-Drop

## Problem

1. **No display ordering**: Seeds have a `weight` field but no `sort_order`. The builder shuffles all items randomly, so there's no way for admins to control which products appear first.
2. **Unbalanced results**: A seed like "BMW X5" can return 20+ items while another seed gets 1-2, because `fetchItemsFromDB` grabs `perSeedLimit` items per seed then shuffles everything together.
3. **Unrelated items in some tabs**: The `_recipeKey` filter in `catalog-home` depends on the cache being fresh. If the cache was built before seeds were fixed, stale unrelated items persist.
4. **No drag-and-drop**: The admin seed modal has no way to reorder seeds -- they're just listed by weight.

## Solution

### Change 1: Add `sort_order` column to `home_recipe_seeds`

Add a `sort_order INTEGER NOT NULL DEFAULT 0` column. This replaces `weight` as the ordering mechanism for display purposes. Seeds ordered by `sort_order ASC` will determine the exact product display order on the frontend.

### Change 2: Round-robin item selection in `homeRecipeBuilder.ts`

Replace the current "fetch N per seed then shuffle" logic with a **round-robin** approach:

1. Fetch items per seed (in parallel, same as now)
2. Instead of shuffling, interleave items: take 1-2 from seed 1, then 1-2 from seed 2, etc.
3. This guarantees each seed contributes equally and the order matches the admin's seed arrangement

```text
Current flow:
  Seed "BMW" -> 15 items
  Seed "Toyota" -> 12 items
  Seed "Honda" -> 8 items
  => shuffle all 35 -> random order, BMW dominates

New flow:
  Seed "BMW" -> 15 items (keep top 2)
  Seed "Toyota" -> 12 items (keep top 2)
  Seed "Honda" -> 8 items (keep top 2)
  => interleave: BMW1, Toyota1, Honda1, BMW2, Toyota2, Honda2
  => ordered, balanced, diverse
```

### Change 3: Admin seed modal with drag-and-drop reordering

Update the seed editor modal in `HomeRecipes.tsx` to:
- Display seeds ordered by `sort_order` (not `weight`)
- Allow drag-and-drop reordering (using HTML5 drag events, no new dependency)
- Auto-save `sort_order` values when seeds are reordered
- Show the position number next to each seed

### Change 4: Backend seed loading respects `sort_order`

Update `loadSeedsForRecipe` in `homeRecipeBuilder.ts` to order by `sort_order ASC` instead of `weight DESC`, so the round-robin picks items in the admin-defined order.

## Files Changed

| File | Change |
|------|--------|
| Database migration | Add `sort_order` column to `home_recipe_seeds`, backfill from existing row order |
| `supabase/functions/_shared/homeRecipeBuilder.ts` | Change `loadSeedsForRecipe` to order by `sort_order ASC`; replace shuffle with round-robin interleave in `fetchItemsFromDB` |
| `src/pages/admin/HomeRecipes.tsx` | Add drag-and-drop reordering to seed modal; load/save `sort_order`; show position numbers |

## Technical Details

### Database Migration

```sql
ALTER TABLE public.home_recipe_seeds 
ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill: assign sort_order based on current weight DESC ordering per recipe
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY recipe_id ORDER BY weight DESC, created_at ASC
  ) AS rn
  FROM home_recipe_seeds
)
UPDATE home_recipe_seeds SET sort_order = numbered.rn
FROM numbered WHERE home_recipe_seeds.id = numbered.id;
```

### Round-Robin Logic (homeRecipeBuilder.ts)

```typescript
// Instead of shuffleArray(allItems).slice(0, targetCount):
// Group items by seed index, then interleave
const perSeedItems: RecipeItem[][] = []; // one array per seed
// ... fill from parallel queries ...

const interleaved: RecipeItem[] = [];
const maxPerSeed = Math.ceil(targetCount / perSeedItems.length);
for (let round = 0; round < maxPerSeed && interleaved.length < targetCount; round++) {
  for (const seedItems of perSeedItems) {
    if (round < seedItems.length && interleaved.length < targetCount) {
      interleaved.push(seedItems[round]);
    }
  }
}
return interleaved;
```

### Drag-and-Drop in Seed Modal

Uses native HTML5 drag events (no new library needed):
- Each seed row gets `draggable={true}`
- On drop, recalculate `sort_order` values and batch-update via a single query
- Visual drag indicator shows insertion point

