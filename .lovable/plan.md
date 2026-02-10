

# Fix: Homepage and Category Tabs to Use Admin Seeds

## Problem

The products displayed on the homepage and category tabs don't match the seeds configured in the admin "Home Recipes" panel. This happens because:

1. **Homepage ("all" tab):** Shows a flat mix of products from ALL 12 recipe categories combined, instead of showing only the "Homepage (Featured Mix)" seeds you configured.
2. **Category tabs (Gaming, Vehicles, etc.):** Navigate to a search page that uses hardcoded search queries (e.g., `gaming -> "video game console"`), completely ignoring the admin seeds you've set for each category.

## Solution

Tag each product in the web cache with its recipe key, then filter by recipe key when serving content.

## Changes

### 1. Backend: Tag items with recipe key (`homeRecipeBuilder.ts`)

In `buildWebHomepage`, add a `_recipeKey` field to each item so the cache knows which recipe each product belongs to.

```text
Before: items stored as flat pool, no recipe association
After:  each item tagged with _recipeKey (e.g., "homepage", "gaming", "vehicles")
```

### 2. Backend: Filter by category in `catalog-home/index.ts`

When the web client sends a `category` parameter:
- `category = ""` or `"all"` or absent: serve only items tagged with `_recipeKey = "homepage"`
- `category = "gaming"`: serve only items tagged with `_recipeKey = "gaming"`
- Map tab keys to recipe keys (e.g., `home -> home_garden`, `fashion -> clothing`, `watches -> jewelry_watches`)

### 3. Frontend: Keep category tabs on homepage (`ShopHome.tsx`)

Instead of navigating away to `/search?category=X`, the category tabs will stay on the homepage and re-fetch from `catalog-home` with the selected category parameter. This uses the admin seeds.

- Add `category` state to ShopHome
- Pass category to the `catalog-home` fetch URL
- Reset pagination when category changes

### 4. Frontend: Update CategoryTabs behavior (`CategoryTabs.tsx`)

When used on the homepage, category changes will call `onCategoryChange` instead of navigating to `/search`. The search page remains unchanged for direct text searches.

## Key Mapping (Tab key -> Recipe key)

```text
all         -> homepage
gaming      -> gaming
vehicles    -> vehicles
home        -> home_garden
fashion     -> clothing
toys        -> toys
sporting_goods -> sporting_goods
watches     -> jewelry_watches
refurbished -> refurbished
```

## Files Modified

- `supabase/functions/_shared/homeRecipeBuilder.ts` -- tag items with `_recipeKey`
- `supabase/functions/catalog-home/index.ts` -- filter cached items by recipe key
- `src/pages/shop/ShopHome.tsx` -- add category state, pass to fetch, handle tab changes
- `src/components/shop/CategoryTabs.tsx` -- no navigation change needed (already supports `onCategoryChange` prop)

## What Stays the Same (No Regressions)

- Mobile homepage flow is untouched (already uses sections per recipe)
- Direct search (typing in search bar) still uses `catalog-search`
- Admin Publish/Rebuild buttons keep working as before
- Cache structure remains backward-compatible (items just gain one new field)
- `catalog-home-v2` for mobile is unaffected
- SearchResults page remains fully functional for text searches

