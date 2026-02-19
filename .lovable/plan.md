

# Fix Tendances Grid Alignment and Fill Empty Spaces

## Problem
From the screenshot:
1. **Tendances** shows 12 products across 2 rows (8 on top, 4 on bottom), leaving 4 empty spaces on the second row
2. Product images in the grid are not squared -- they use a fixed height which creates inconsistent sizing
3. **Reconditionne** category card has empty space when fewer than 4 products are available (though the repeat logic exists, it may not be working for this section)

## Solution

### 1. Limit Tendances to exactly 8 items (one full row on xl)
In `src/components/shop/SectionBlock.tsx`, change `items.slice(0, 12)` to `items.slice(0, 8)` so the grid fills exactly one row at `xl:grid-cols-8` with no leftover empty spaces.

### 2. Make compact ProductCard images squared
In `src/components/shop/ProductCard.tsx`, change the compact image container from `h-[160px] sm:h-[170px]` to `aspect-square` so images are uniformly squared and naturally smaller.

### 3. Ensure Reconditionne grid matches the same density
In `src/pages/shop/ShopHome.tsx`, the "more categories" grid (`morePreviews`) already uses `CategoryCard` which fills 4 slots by repeating. This should already work -- but we need to verify data is flowing. The `CategoryCard` repeat logic (lines 36-39) already handles this correctly.

## Files to Modify

- **`src/components/shop/SectionBlock.tsx`** (line 49): Change `.slice(0, 12)` to `.slice(0, 8)`
- **`src/components/shop/ProductCard.tsx`** (line 117): Change `compact ? "h-[160px] sm:h-[170px]"` to `compact ? "aspect-square"`

