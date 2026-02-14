

# Fix: Single-Recipe Rebuild Overwrites All Tabs

## Problem

When you click "Rebuild" on a specific recipe (e.g., "homepage") in the admin portal, it should only update that tab's items. Instead, the merge logic has a bug that can corrupt items from other tabs.

The web cache stores ALL recipes' items in a single row, tagged with `_recipeKey` (e.g., "homepage", "gaming", "vehicles"). When serving a tab, items are filtered by this tag. This part works correctly.

The bug is in the **merge step** when rebuilding a single recipe:

- **Current (broken)**: Removes existing items whose **product ID** collides with new items. This means if a product appears in both "gaming" and "homepage", rebuilding "homepage" would steal it from "gaming". It also keeps stale "homepage" items that weren't in the new fetch.
- **Correct**: Remove ALL existing items tagged with the rebuilt recipe's `_recipeKey`, then add the fresh items.

Additionally, when we ran `home-auto-refresh` earlier to fix your seeds, it called `buildWebHomepage(env)` **without** a `recipeKey` -- which rebuilt ALL 12 recipes at once. That's why every tab changed simultaneously.

## Fix

One code change in `supabase/functions/_shared/homeRecipeBuilder.ts` (lines 441-456):

Replace the ID-collision merge with a clean `_recipeKey`-based merge:

```typescript
// Merge: replace only the target recipe's items, keep everything else
if (recipeKey && existingPayload) {
  const existingItems = (existingPayload.items as Array<RecipeItem & { _recipeKey?: string }>) || [];
  // Keep all items that belong to OTHER recipes
  const kept = existingItems.filter(i => (i._recipeKey || "homepage") !== recipeKey);
  allItems = [...kept, ...newItems];
}
```

This is simpler (removes unnecessary seed-query loading) and correct -- rebuilding "homepage" only touches homepage-tagged items, leaving gaming/vehicles/etc. untouched.

## Technical Details

### File Changed
- `supabase/functions/_shared/homeRecipeBuilder.ts` (lines 441-456)

### What This Fixes
- Admin "Rebuild" button per recipe now correctly updates only that tab
- No cross-contamination between recipes when products appear in multiple categories
- Stale items from the rebuilt recipe are properly removed

### After Deploying
Use the admin portal's per-recipe "Rebuild" button to update individual tabs independently. The `home-auto-refresh` cron will continue to rebuild everything on schedule.

