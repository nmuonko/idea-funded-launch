

# Fix: Web Homepage Per-Category Curation + Missing Jewelry & Watches Recipe

## Problem Summary

The web app has category tabs (Homepage, Gaming, Vehicles, Living Room, Clothing, Toys, Sporting Goods, **Jewelry & Watches**, Refurbished, Parts & Accessories), but:

1. **No `jewelry_watches` recipe exists** in the admin portal — so this category has no curated seeds at all
2. **No `jewelry_watches` section exists** in `home_sections` — so Publish cannot target it
3. **The web homepage feed is a single mixed pool** — clicking a category tab navigates to `/search?category=X` which performs a live search instead of using the curated/prewarmed data from admin seeds

## What Changes

### 1. Add `jewelry_watches` recipe + seeds (Database)

- Insert `jewelry_watches` rows into `home_recipes` for both `mobile` and `web` targets (sort_order 8, between sporting_goods and refurbished)
- Insert curated seed queries: diamond ring, gold necklace, silver bracelet, luxury watch men, Casio G-Shock, Rolex watch, Seiko automatic, Apple Watch, pendant necklace, earrings gold
- Insert `jewelry_watches` row into `home_sections` table with appropriate eBay category and keywords

### 2. Add `jewelry_watches` to prewarm registry (Edge Function)

- Add `{ key: "jewelry_watches", categoryKey: "jewelry_watches" }` to `HOME_PREWARM_SECTIONS` in `catalog-prewarm-home/index.ts`
- This enables the admin "Publish" button to work for Jewelry & Watches

### 3. Add `jewelry_watches` to mobile section definitions (Edge Function)

- Add a `jewelry_watches` entry to the `MOBILE_SECTIONS` array in `catalog-home/index.ts` with keywords like: ring, necklace, bracelet, watch, jewelry, gold, silver, diamond, pendant, earring
- This ensures the mobile app can display a Jewelry & Watches section

### 4. No changes to frontend rendering code

Per the project constraint, no modifications to the web or mobile frontend rendering. The existing `CategoryTabs.tsx` already handles `watches`/`jewelry_watches` keys with proper icon mapping and localization. The search results page already handles category browsing via `catalog-search`.

## Technical Details

### Database Migrations

```text
-- home_recipes: 2 new rows (mobile + web) for jewelry_watches
-- home_recipe_seeds: ~10 seed queries per target
-- home_sections: 1 new row for jewelry_watches with eBay category, keywords
-- home_section_seeds: ~10 seed queries for prewarm
```

### Edge Function Changes

**`catalog-prewarm-home/index.ts`**: Add jewelry_watches to HOME_PREWARM_SECTIONS array

**`catalog-home/index.ts`**: Add jewelry_watches to MOBILE_SECTIONS array with appropriate keywords

### Files Modified

- `supabase/functions/catalog-prewarm-home/index.ts` (add registry entry)
- `supabase/functions/catalog-home/index.ts` (add mobile section definition)

### No-Regression Safeguards

- No frontend code changes (web or mobile)
- Existing recipes and sections are untouched
- Mobile 8-section logic continues to work (now 9 sections with jewelry)
- Web homepage mixed feed continues to work (jewelry seeds contribute to the pool)
- Category tab click behavior unchanged (still routes to /search?category=X)
- All existing prewarm and rebuild flows remain intact

