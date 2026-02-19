

# Fix Disappeared/Under-filled Category Grids

## Root Cause

Two bugs are causing grids to disappear or show fewer than 4 items:

**Bug 1: Over-strict filtering on dedicated feed items**
When the backend returns items for a specific category (e.g., `catalog-home?category=electronics`), those items are already category-relevant by design. But `pickStrict` forces them through an include-keyword check too, rejecting many valid items whose titles don't happen to contain the hardcoded keywords. For example, an HP laptop returned by the electronics recipe might not match if its title says "HP Pavilion 15" without the word "laptop".

**Bug 2: Grids with 0 items are hidden from render**
Lines 469 and 495 filter out `g.items.length > 0`, so any category that got 0 items after strict filtering simply vanishes. The async top-up mechanism fetches replacements, but the render still hides grids with 0 initial items because `finalCategoryGrids` only adds to existing items, it doesn't re-show hidden grids.

Additionally, `CategoryCard` itself returns `null` when `items.length === 0` (line 33).

## Solution (single file: `src/pages/shop/ShopHome.tsx`)

### 1. Trust dedicated feed items (exclude-only filtering)

Split filtering into two tiers:
- **Dedicated feed items** (`categorySections[catKey]`): Only apply exclude checks (no include-keyword requirement). These items were fetched by the backend specifically for this category.
- **Accueil pool items** (`accueilProducts`): Apply full strict include + exclude checks (as today).

This means `buildGrid4` will:
- Stage A: Pick from dedicated feed using exclude-only filtering (up to 4)
- Stage B: If still < 4, pick from accueil pool using strict include+exclude filtering

### 2. Always render all 16 category grids

Remove the `g.items.length > 0` filter from both render sections (promo tiles at line 469 and remaining grids at line 495). Every category in `ALL_HOMEPAGE_CATEGORIES` always renders. If a grid currently has 0-3 items, it still shows while the async top-up fetches more.

### 3. Show loading skeleton for empty grids instead of hiding

For categories with 0 items that are still loading (top-up in progress), show the `CategoryCard` loading skeleton instead of `null`. Update the render to pass `loading={true}` when items are empty and top-up hasn't completed yet.

### 4. Top-up fetches for ALL categories with < 4 items

The existing top-up `useEffect` already handles this correctly -- it triggers for any category with < 4 items. No changes needed here, it just wasn't getting a chance to display results because the render was hiding the grids.

## Technical Details

### Changes in `src/pages/shop/ShopHome.tsx`

1. **New helper `pickExcludeOnly`**: Like `pickStrict` but skips the include-keyword check. Used for dedicated feed items.

2. **Updated `buildGrid4`**:
   - Stage A: `pickExcludeOnly(dedicatedFeed, catKey, 4)` -- trust backend's category selection
   - Stage B: `pickStrict(accueilPool, catKey, 4 - items.length)` -- strict for general pool

3. **Remove `g.items.length > 0`** from lines 469 and 495 render filters

4. **Pass `loading` prop** to `SectionBlock` for grids with 0 items while top-up is pending

No backend changes. No layout changes. No other files modified.

