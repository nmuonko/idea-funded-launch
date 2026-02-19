

# Add All 16 Categories to Admin + Backend + Ensure 300-Item Prefetch on "Voir Plus"

## Overview

Currently, only 12 categories exist in the admin portal (`home_recipes` table) and backend routing. The 5 newer categories (`beauty_health`, `collectibles`, `audio_music`, `shoes_sneakers`, `cameras_photo`) are only defined in the frontend -- they have no admin recipes, no backend recipe mapping, and no prewarm support. This means they get zero dedicated items and rely entirely on the emergency backfill from the general pool.

This plan adds full end-to-end support for all 16 categories (the original 11 + homepage + the 5 new ones).

---

## Changes

### 1. Database: Add 5 New Recipe Rows

Insert into `home_recipes` for target=`web`:

| key | title_fr | title_en | sort_order |
|-----|----------|----------|------------|
| beauty_health | Beaute et Sante | Beauty & Health | 12 |
| collectibles | Collections | Collectibles | 13 |
| audio_music | Audio et Musique | Audio & Music | 14 |
| shoes_sneakers | Chaussures et Sneakers | Shoes & Sneakers | 15 |
| cameras_photo | Cameras et Photo | Cameras & Photo | 16 |

Each will be `enabled=true`, `mode='manual'`.

### 2. Backend: catalog-home TAB_TO_RECIPE

Add the 5 new keys to the `TAB_TO_RECIPE` map so when the frontend requests `?category=audio_music`, the backend knows which recipe key to filter by:

```
audio_music: "audio_music",
beauty_health: "beauty_health",
collectibles: "collectibles",
shoes_sneakers: "shoes_sneakers",
cameras_photo: "cameras_photo",
```

### 3. Backend: categoryRegistry.ts Aliases

Add fallback aliases so `catalog-category` (used by "Voir plus" / category page) can resolve these keys:

```
audio_music -> electronics_audio (closest canonical parent)
beauty_health -> (new canonical or fallback to general search)
collectibles -> (general search)
shoes_sneakers -> clothing_shoes
cameras_photo -> electronics_cameras
```

### 4. Backend: catalog-category Fallback Queries

Add default search queries for the new categories so the category page can fetch relevant items:

```
audio_music: ["bose speaker", "jbl speaker", "headphones", "guitar"]
beauty_health: ["perfume", "skincare", "makeup", "hair dryer"]
collectibles: ["trading cards", "collectible figurine", "vintage"]
shoes_sneakers: ["nike shoes", "jordan sneakers", "adidas"]  
cameras_photo: ["canon camera", "gopro", "nikon dslr"]
```

### 5. Backend: catalog-prewarm-home

Add the 5 new sections to `HOME_PREWARM_SECTIONS` so the "Publish All" button in admin prewarms these categories too.

### 6. Frontend: ShopHome.tsx

Update `FETCH_CATEGORY_KEYS` to include all 16 categories (currently only 11 are fetched from the backend). This ensures each category grid gets dedicated items instead of relying on emergency backfill:

```
const FETCH_CATEGORY_KEYS = [
  'phones', 'electronics', 'gaming', 'vehicles', 'clothing',
  'home_garden', 'toys', 'sporting_goods', 'jewelry_watches',
  'parts_accessories', 'refurbished', 'beauty_health', 'collectibles',
  'audio_music', 'shoes_sneakers', 'cameras_photo',
];
```

### 7. Frontend: CategoryResultsPage.tsx

Add the 5 missing keys to `CATEGORY_TITLE_MAP` so the category page shows correct titles when navigating via "Voir plus":

```
audio_music: { fr: 'Audio & Musique', en: 'Audio & Music' },
beauty_health: { fr: 'Beaute & Sante', en: 'Beauty & Health' },
collectibles: { fr: 'Collections', en: 'Collectibles' },
shoes_sneakers: { fr: 'Chaussures & Sneakers', en: 'Shoes & Sneakers' },
cameras_photo: { fr: 'Cameras & Photo', en: 'Cameras & Photo' },
```

The existing 300-item prefetch pool (`POOL_TARGET = 300`) and pagination logic already work correctly -- the fix is just ensuring the backend can resolve and return items for these category keys.

### 8. No Regressions

- No changes to existing category logic, filtering, dedup, or backfill pipeline
- No changes to the Tendances section
- No changes to mobile feed behavior
- The `catalog-home` function's fallback behavior (line 1193: `TAB_TO_RECIPE[category] || category || "homepage"`) already passes unknown keys through, so existing categories continue to work even during deployment

---

## Technical Details

### Files Modified

1. **Database migration** -- INSERT 5 rows into `home_recipes`
2. `supabase/functions/catalog-home/index.ts` -- Add 5 entries to `TAB_TO_RECIPE`
3. `supabase/functions/catalog-category/index.ts` -- Add fallback queries for 5 new keys
4. `supabase/functions/_shared/categoryRegistry.ts` -- Add alias mappings
5. `supabase/functions/catalog-prewarm-home/index.ts` -- Add 5 sections to `HOME_PREWARM_SECTIONS`
6. `src/pages/shop/ShopHome.tsx` -- Expand `FETCH_CATEGORY_KEYS`
7. `src/pages/shop/CategoryResultsPage.tsx` -- Expand `CATEGORY_TITLE_MAP`

