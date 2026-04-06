

# Fix Mobile Sections: Relevance, Image Quality, and Vehicle Curation

## Problem
1. **Parts & Accessories** section shows irrelevant items (vanity mirrors, furniture) instead of actual car parts
2. Some sections show low-quality or non-product images (ad banners still slipping through)
3. **Vehicles** section needs to prominently feature popular makes (Tesla, Ford SUVs, etc.) from CarGurus/Carvana with attractive prices

## Changes

### 1. Fix "Parts & Accessories" relevance (`sectionProfiles.ts`)
Add HOME_WORDS, CLOTHING_WORDS, and furniture/cosmetic keywords to the `parts_accessories` `excludeAny` list. Currently it only excludes phones and gaming — home/furniture items leak in because "mirror" isn't excluded.

**Add to excludeAny for parts_accessories:**
- All of `HOME_WORDS` (sofa, bed, mattress, table, lamp, rug, curtain, furniture, decor, etc.)
- All of `CLOTHING_WORDS` (shirt, hoodie, shoes, sneakers, etc.)
- Additional: `"vanity"`, `"makeup"`, `"cosmetic"`, `"beauty"`, `"skincare"`, `"candle"`, `"pillow"`, `"blanket"`, `"towel"`, `"vase"`, `"planter"`

### 2. Boost Vehicles section with diversity queries (`sectionProfiles.ts`)
Add `diversityQueries` to the vehicles profile so backfill pulls specific popular makes/types from the database, ensuring a curated mix of Teslas, Ford SUVs, Toyota trucks, etc.

```
diversityQueries: [
  "tesla model 3 model y",
  "ford explorer f-150 suv",
  "toyota camry rav4 highlander",
  "bmw x3 x5 sedan",
  "chevrolet silverado equinox tahoe",
  "honda civic accord cr-v",
  "jeep wrangler grand cherokee",
]
```

### 3. Bump cache schema version (`mobileSectionsCache.ts`)
Change `MOBILE_SECTIONS_SCHEMA_VERSION` from **18** to **19** to invalidate stale cached sections and force a rebuild with the new filtering rules.

### 4. Redeploy affected functions
Deploy `catalog-home` (which imports both files) so the new profiles and cache version take effect immediately.

## Technical Details
- **Files modified**: `supabase/functions/_shared/sectionProfiles.ts`, `supabase/functions/_shared/mobileSectionsCache.ts`
- **Functions redeployed**: `catalog-home`
- After deployment, trigger "Rebuild Mobile" from admin to regenerate the homepage cache with clean sections

