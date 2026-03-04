

## Problem Analysis

Two related issues:

1. **Stale localStorage cache**: ALL categories are marked as "slow" (line 178), so cached results from localStorage are shown directly (line 794-796) **without re-validating** through `filterForCategory` or `isRenderableImageUrl`. Old cached data from before the filtering improvements still contains misclassified items (e.g., Kindle Paperwhite in Audio & Music) and items with bad images.

2. **Amazon small/icon images passing through**: The frontend `isRenderableImageUrl` checks `(\d+)x(\d+)` in URLs but doesn't check Amazon's `_SLnn_` dimension pattern (e.g., `_SL75_`). Tiny Amazon thumbnails slip through. The server-side `imageValidator.ts` already handles `_SL(\d+)_` but the client-side copy doesn't.

3. **Exclude list gaps**: The `audio_music` exclude list doesn't include common non-audio terms like `'kindle'`, `'e-reader'`, `'ebook'`, `'paperwhite'`, `'tablet'` (wait, `'tablet'` is already there). Need to add `'kindle'` and `'e-reader'`.

## Implementation Plan

### Step 1: Re-validate cached results before displaying
In `ShopHome.tsx` around line 794-796, when loading from localStorage cache, run the cached items through `isRenderableImageUrl` and `filterForCategory` before displaying. This ensures stale items with bad images or wrong categories are purged on next load.

### Step 2: Add Amazon `_SL` dimension check to frontend `isRenderableImageUrl`
Add a check for Amazon's `_SLnn_` URL pattern (matching the server-side `imageValidator.ts` logic). Block images where `_SL` dimension is < 80px.

### Step 3: Expand `audio_music` exclude keywords
Add `'kindle'`, `'e-reader'`, `'ebook'`, `'paperwhite'`, `'reader'` to the `CATEGORY_EXCLUDE_KEYWORDS.audio_music` list.

### Step 4: Bust stale localStorage cache
Increment the cache key prefix or add a version suffix (e.g., `afrishop_curated_v2:`) so all old cached data is ignored and re-fetched with the new filters applied.

### File to modify
- `src/pages/shop/ShopHome.tsx`

