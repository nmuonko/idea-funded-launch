

# Make All Homepage Category Grids Load Instantly from Cache

## Problem
Currently, only 4 "slow" categories (vehicles, parts_accessories, jewelry_watches, clothing) use the curated localStorage cache for instant rendering. The remaining 9 categories (including Audio & Musique and Maison Connectee) fetch live data on every page load/refresh, causing visible image loading delays.

## Solution
Extend the curated cache system to cover ALL 13 homepage categories so every grid renders instantly from cache, with a silent background refresh to keep data fresh.

## Changes

### 1. `src/pages/shop/ShopHome.tsx`

**a) Expand `SLOW_CATEGORIES` to include ALL categories:**
Replace the limited set with all homepage categories so every category benefits from instant cached rendering.

```
// Before:
const SLOW_CATEGORIES = new Set(['vehicles', 'parts_accessories', 'jewelry_watches', 'clothing']);

// After:
const SLOW_CATEGORIES = new Set(ALL_HOMEPAGE_CATEGORIES);
```

This single change ensures:
- On first visit: categories fetch live (normal behavior)
- On subsequent visits: cached results render instantly (0ms), while a background refresh silently updates the cache for next time
- No blank grids -- cached data is never replaced with empty results (existing guard on line 760 handles this)

**b) Also cache the "standard path" categories explicitly:**
The existing code at line 754-757 already caches results for `SLOW_CATEGORIES`. Since we expanded that set, all categories will now be cached automatically -- no additional code needed.

**c) Read cache for all categories on load:**
The existing code at lines 408-416 already reads cached results for `SLOW_CATEGORIES` and shows them instantly. Since we expanded the set, all categories will now get instant rendering.

### Summary
This is a one-line change that makes ALL homepage category grids:
- Render instantly from localStorage cache (1-hour TTL)
- Silently refresh in the background
- Never show blank grids during refresh

