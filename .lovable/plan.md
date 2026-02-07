
# Fix Category Filters Returning Irrelevant Items

## Problem
When clicking category tabs like "Vehicles", "Home & Garden", "Clothing & Fashion", etc., the search returns irrelevant items from other categories. Two root causes:

1. **Frontend sends short alias keys** (e.g., `fashion`, `home`, `watches`, `sportingGoods`) but the backend expects canonical keys (e.g., `clothing_shoes_accessories`, `home_garden`, `jewelry_watches`, `sporting_goods`). The backend has a `resolveCategory()` function that maps aliases to canonical keys, but it is never called in the search orchestrator.

2. **Database search ignores category entirely** -- when searching the local `catalog_items` table, no category filter is applied, so items from any category that match the query text are returned.

## Changes

### File 1: `supabase/functions/catalog-search/index.ts`
**Add category resolution right after extracting categoryKey (around line 70)**

- Import `resolveCategory` from `categoryRegistry.ts`
- After line 70 where `categoryKey` is extracted, call `resolveCategory(categoryKey)` to normalize it
- Replace the raw `categoryKey` with the resolved canonical key for all downstream usage
- Log the resolution for debugging: `category_resolved: "fashion" -> "clothing_shoes_accessories" (alias)`
- This single change fixes eBay category mapping, search rewriter rules, and cache key consistency

### File 2: `supabase/functions/_shared/searchDbFirst.ts`
**Add category filter to database query**

- When `categoryKey` is provided and non-null, add `.eq("unified_category", categoryKey)` to the database query
- This ensures DB-first results only return items from the selected category
- For broad parent categories (e.g., `electronics`), also match subtab categories using `.or()` filter (e.g., `unified_category.eq.electronics,unified_category.like.electronics_%`)

### File 3: `supabase/functions/_shared/categoryRegistry.ts`
**Add missing frontend aliases**

- Add `sportinggoods` (camelCase lowered) to `FALLBACK_ALIAS_MAP` pointing to `sporting_goods`
- Add `computers` alias pointing to `electronics_computers`
- Add `gaming` alias pointing to `electronics_gaming`
- These are the keys sent by the frontend `CategoryTabs` component that currently have no alias mapping

### File 4: `src/components/shop/CategoryTabs.tsx` (minor)
**Align frontend keys with canonical keys where possible**

- Change `sportingGoods` to `sporting_goods` (matches canonical directly)
- This reduces reliance on alias resolution for common tabs

## Technical Details

### Category Resolution Flow (after fix)

```text
Frontend sends: category_key=fashion
                    |
                    v
catalog-search extracts: categoryKey = "fashion"
                    |
                    v
resolveCategory("fashion") -> { resolved: "clothing_shoes_accessories", method: "alias" }
                    |
                    v
All downstream uses canonical key:
  - eBay fetcher: CATEGORY_MAPPING["clothing_shoes_accessories"] -> "11450" (correct!)
  - DB search: .eq("unified_category", "clothing_shoes_accessories")
  - Cache key: includes canonical category
  - Search rewriter: matches category-specific rules
```

### Why this fixes the screenshots
The user's screenshots show duplicate "Electronics" tabs and categories like "Sporting Goods" returning wrong items. The duplicate tabs are from the `catalog-tabs` backend returning raw keys that the frontend does not deduplicate (separate issue), but the irrelevant results are fixed by this plan because:
- Each category tab click now resolves to the correct canonical key
- eBay searches are constrained to the right category ID
- Database results are filtered by `unified_category`
