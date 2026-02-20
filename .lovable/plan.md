

# Fix Empty Category Grids -- Trust Backend Feeds, Strict Only for General Pool

## Root Cause

The grids are empty because **every** data source (dedicated category feeds, top-up pools from `catalog-category`) is forced through strict include-keyword matching. When the backend returns a product for "cameras_photo" but the product title says "Ring Light 18 inch" without any of the hardcoded keywords like "canon", "nikon", "dslr", it gets rejected. Same for every other category.

The include keywords are inherently incomplete -- no keyword list can cover every valid product title. Items fetched from `catalog-home?category=X` and `catalog-category?category=X` are **already categorized by the backend**. Requiring them to also match frontend keywords is double-filtering that causes most items to be dropped.

## Solution (single file: `src/pages/shop/ShopHome.tsx`)

### 1. Two-tier filtering in `buildGrid4`

- **Dedicated feed items** (`categorySections[catKey]}`) -- these came from `catalog-home?category=X`. Apply **exclude-only** filtering (trust backend categorization, just block known contaminants like shoes in cameras).
- **General pool** (`accueilProducts`) -- these are uncategorized homepage items. Apply **strict include + exclude** filtering (must match a keyword to prove relevance).

### 2. Two-tier filtering in `finalCategoryGrids` (top-up merge)

- **Top-up pool items** (`topUpPools[catKey]`) -- these came from `catalog-category?category=X`. Apply **exclude-only** filtering (same logic as dedicated feeds -- backend already categorized them).

### 3. Strengthen exclude lists to compensate

Since we're trusting backend categorization, the exclude lists become our primary defense against contamination. The existing excludes are already comprehensive (global shoe/watch/toy terms + per-category excludes). No changes needed here -- the current exclude lists already block shoes from cameras, watches from audio, etc.

### Technical Details

**In `buildGrid4` (lines 267-276):**
- Stage A: filter dedicated feed with excludes only (no include check)
- Stage B: filter accueil pool with strict include + exclude (unchanged)

**In `finalCategoryGrids` (lines 361-393):**
- Change line 385 from strict include check to skip include check for top-up pool items (these are from `catalog-category`)

This is the same approach as the first approved plan ("trust dedicated feeds"), but now applied consistently to **both** the dedicated feeds AND the top-up pools. The previous implementation only applied it to one place and then it was removed in favor of strict-everywhere, which caused the empty grids.

### Why this won't cause contamination

The global hard excludes (GLOBAL_SHOE_TERMS, GLOBAL_WATCH_JEWELRY_TERMS, GLOBAL_TOY_TERMS) plus per-category excludes cover the contamination vectors seen in screenshots. For example:
- Cameras grid: excludes `iphone`, `samsung galaxy`, `laptop`, `macbook`, `phone`, `smartphone`, `gaming`, `tablet` etc.
- Beauty grid: excludes `phone`, `iphone`, `samsung`, `case`, `protector`, `laptop`, `gaming` etc.
- All non-shoe categories: excludes `shoe`, `sneaker`, `nike`, `jordan`, `adidas`, etc.

### Files Changed
- `src/pages/shop/ShopHome.tsx` only

