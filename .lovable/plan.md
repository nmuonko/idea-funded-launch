

# Optimize Pool Size to 300 + 3-Page Pagination + Prettier Load More

## Problem

1. **Rebuild seeds 1000+ items** per filter -- this is wasteful since each non-homepage tab only shows ~100 items. Fetching 1000 items burns Rainforest/eBay API credits unnecessarily.
2. **Non-homepage tabs show only 1 page** -- users see ~100 products with no pagination on category tabs (Gaming, Vehicles, etc.), while homepage shows all pages.
3. **"Load more" button** has an ugly down-arrow (ChevronDown icon) that should be replaced with a prettier design.

## Solution

### 1. Reduce default pool size from 1000 to 300

**File: `supabase/functions/catalog-home/index.ts`**
- Change `DEFAULT_POOL_SIZE` from `1000` to `300`
- Adjust `getSegmentConfigs()` segment targets proportionally (scale factor stays the same, but base is now 300 instead of 1000):
  - phones: 250 x 0.3 = 75
  - accessories: 200 x 0.3 = 60
  - cars: 150 x 0.3 = 45
  - gaming: 200 x 0.3 = 60
  - home: 200 x 0.3 = 60

This means each rebuild fetches ~300 relevant items total instead of 1000+, saving ~70% of API credits.

### 2. Reduce web recipe per-section target from 100 to 100 (already correct)

**File: `supabase/functions/_shared/homeRecipeBuilder.ts`**
- `WEB_ITEMS_PER_PAGE` is already 100 -- this is used as the target per recipe in `buildWebHomepage()`
- Each web recipe already fetches ~100 items per section via `fetchItemsForRecipe(recipe, seeds, WEB_ITEMS_PER_PAGE, ...)`
- With ~12 web recipes, total pool stays around 300 relevant items per section

No change needed here since the recipe builder already caps at 100 per recipe. The issue is the legacy `DEFAULT_POOL_SIZE = 1000`.

### 3. Ensure each category tab shows 3 pages of 100 products

**File: `src/pages/shop/ShopHome.tsx`**
- `PAGE_SIZE` is already 100 -- correct
- The `totalPages` is already computed from backend response: `Math.ceil(poolSize / pageSize)`
- With 300 items per filter, each tab will show 3 pages (300/100 = 3)
- The "Load more" button already works for pagination -- no logic change needed
- Cap displayed `totalPages` at 3 in the UI to keep it clean

### 4. Make the "Load more" button prettier

**File: `src/pages/shop/ShopHome.tsx`** (lines 276-304)
- Remove `ChevronDown` icon
- Replace with a gradient-styled pill button with a subtle animation
- Show page progress (e.g., "Page 1 of 3") without the ugly parenthetical text
- Use `Loader2` spinner only when loading
- Add a subtle `framer-motion` scale animation on hover

New button design:
```text
+-------------------------------------------+
| Show More Products  (Page 1 of 3)         |
+-------------------------------------------+
```
- Gradient border with white text
- No down arrow
- Clean page indicator

## Technical Details

### File: `supabase/functions/catalog-home/index.ts`

**Line 165**: Change `DEFAULT_POOL_SIZE` from `1000` to `300`

**Lines 815-875** (`getSegmentConfigs`): The function already scales by `poolSize / 1000`, so with `poolSize = 300`:
- phones: `Math.round(250 * 0.3)` = 75
- accessories: `Math.round(200 * 0.3)` = 60
- cars: `Math.round(150 * 0.3)` = 45
- gaming: `Math.round(200 * 0.3)` = 60
- home: `Math.round(200 * 0.3)` = 60
- Total: 300

This automatically scales down. No code change needed in the function itself.

### File: `src/pages/shop/ShopHome.tsx`

**Line 2**: Remove `ChevronDown` from imports

**Lines 276-304**: Replace the "Load more" button with a prettier version:
- Remove `ChevronDown` icon
- Use a gradient border button with `rounded-full` styling
- Show clean page indicator: "Page X of Y" as a subtle badge
- Remove "(live)" and "(page X/Y)" parenthetical text from the button label
- Add motion animation for smooth appearance

## Files Modified

- `supabase/functions/catalog-home/index.ts` -- reduce `DEFAULT_POOL_SIZE` to 300
- `src/pages/shop/ShopHome.tsx` -- prettier "Load more" button, remove ChevronDown

## Suggested Improvements

1. The recipe builder (`homeRecipeBuilder.ts`) `WEB_ITEMS_PER_PAGE = 100` already caps each recipe at 100 items. With the admin controlling how many recipes exist per tab, each tab should naturally have ~100-300 items.
2. The legacy `buildFullFeed` (segment-based) is the one that was generating 1000+ items. Reducing `DEFAULT_POOL_SIZE` to 300 fixes this for the legacy path.
3. No mobile impact -- mobile sections have their own `MOBILE_ITEMS_PER_SECTION = 30` cap (unchanged).

