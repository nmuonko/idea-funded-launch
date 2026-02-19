

# Fix Tendances Count and Fill Category Grid Rows

## Problem
1. **Tendances** currently shows only 8 products (1 row). User wants 16 products arranged in 2 full rows of 8.
2. **More Categories section** (where "Reconditionne" appears) has an incomplete last row. If only 1 or 2 categories have data, the rest of the row is empty. Need to always fill rows of 4.

## Changes

### 1. Tendances: 16 products (2 rows of 8)
**File: `src/components/shop/SectionBlock.tsx`** (line 49)
- Change `items.slice(0, 8)` to `items.slice(0, 16)` so the grid shows 16 products, filling exactly 2 rows on desktop (xl:grid-cols-8).

### 2. More Categories: Always fill rows of 4
**File: `src/pages/shop/ShopHome.tsx`** (lines 294-305)
- After rendering the `morePreviews` cards, calculate how many empty slots remain to complete the last row of 4.
- Fill remaining slots by re-using categories from `promoPreviews` (the top 4 categories) so every row is fully populated with real category grid cards, no empty space.
- Example: if `morePreviews` has 5 items (5 mod 4 = 1 leftover), add 3 more cards from promoPreviews to complete the row.

## Files to Modify
- **`src/components/shop/SectionBlock.tsx`** -- line 49: change slice from 8 to 16
- **`src/pages/shop/ShopHome.tsx`** -- lines 294-305: pad morePreviews grid with extra category cards to fill rows of 4
