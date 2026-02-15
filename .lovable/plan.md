
# Fix: "Vêtements et Mode" Tab Shows Unrelated Products

## Root Cause

There is a **key mismatch** between the category tabs and the homepage recipe cache:

1. The `catalog-tabs` endpoint returns tabs with key `clothing_shoes_accessories`
2. The frontend sends `category=clothing_shoes_accessories` to `catalog-home`
3. In `catalog-home/index.ts`, the `TAB_TO_RECIPE` mapping (line 1168-1179) only has `fashion: "clothing"` -- it does NOT have `clothing_shoes_accessories: "clothing"`
4. So `recipeKeyFilter` becomes `"clothing_shoes_accessories"` (the raw category value)
5. No items in the recipe cache have `_recipeKey: "clothing_shoes_accessories"` (they are tagged `"clothing"`)
6. Zero items match, the recipe cache path is skipped
7. Falls through to the legacy 3-tier cache, which has no entry for `production:clothing_shoes_accessories`
8. Falls through to live fetch or returns empty/homepage data

The same bug likely affects any tab whose key from `catalog-tabs` does not match the `TAB_TO_RECIPE` map (e.g., `jewelry_watches` works because it is mapped, but `clothing_shoes_accessories` is not).

## Fix

### File: `supabase/functions/catalog-home/index.ts`

Add `clothing_shoes_accessories` to the `TAB_TO_RECIPE` mapping (around line 1168):

```text
Before:
  fashion: "clothing",

After:
  fashion: "clothing",
  clothing_shoes_accessories: "clothing",
```

This single line addition ensures that when the frontend sends `category=clothing_shoes_accessories`, it correctly filters items tagged with `_recipeKey: "clothing"` from the recipe cache.

### File: `supabase/functions/catalog-home-v2/index.ts` (if it has a similar mapping)

Apply the same fix if the v2 endpoint has a `TAB_TO_RECIPE` map.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/catalog-home/index.ts` | Add `clothing_shoes_accessories: "clothing"` to TAB_TO_RECIPE |
| `supabase/functions/catalog-home-v2/index.ts` | Same fix if applicable |
