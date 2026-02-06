
# Fix: Restore Multi-Section Mobile Response + Staging Fallback

## Problem

The previous "hide titles" hotfix replaced all 10 mobile sections with a single `key="featured"` section via `flattenToSingleSection()`. The mobile app renders each section as a horizontal carousel, so 1 section = 1 row of products. Users only see a few items instead of a scrollable feed.

The mobile app **needs** multiple sections with proper keys (`phones`, `electronics`, `vehicles`, etc.) and non-empty titles. The app always renders section headers -- this cannot be changed from the backend.

## Changes (1 file)

### `supabase/functions/_shared/mobileSectionsCache.ts`

**A) Remove `flattenToSingleSection`**

Delete the `flattenToSingleSection` function entirely.

**B) Return normalized sections directly (all 3 response paths)**

In all 3 places where `flattenToSingleSection(normalized)` is called (cache hit, rebuild, empty fallback), replace with just `normalized` -- the already-normalized multi-section array with proper keys and titles from `SECTION_PROFILES`.

Before:
```text
const hidden = flattenToSingleSection(normalized);
const totalItems = hidden[0].items.length;
sections: hidden,
```

After:
```text
const totalItems = calculateTotalItems(normalized);
sections: normalized,
```

**C) Add staging-to-production fallback in `serveMobileSections`**

When `readMobileSectionsCache(env)` returns a miss AND the pool is empty AND `env !== "production"`, automatically retry with `env = "production"`. This prevents empty responses when mobile requests `env=staging` but only production has cached data.

```text
// After cache miss + empty pool check:
if (poolItems.length === 0 && env !== "production") {
  // Try production cache as fallback
  const prodCache = await readMobileSectionsCache("production", correlationId);
  if (prodCache.hit && prodCache.payload) {
    // serve from production cache
  }
}
```

**D) Bump `MOBILE_SECTIONS_SCHEMA_VERSION` to 4**

Force cache invalidation so stale single-section cache entries are not served.

## What does NOT change

- `catalog-home/index.ts` -- no changes (calls `serveMobileSections` from shared module)
- `catalog-home-v2/index.ts` -- no changes (calls `serveMobileSections` from shared module)
- Web response path -- completely untouched (web uses its own single-feed logic in catalog-home/v2, never calls `serveMobileSections`)
- Mobile detection logic -- already correct in both functions (x-device-id priority 1)
- Product sourcing, caching, filtering -- zero changes
- Payments, cart, checkout -- zero changes
- `sectionProfiles.ts` -- no changes (already has correct profiles with word-boundary matching)
- `titleNormalizer.ts` -- no changes (already guarantees non-empty titles)

## Technical Detail: Section Keys Returned

The 10 sections from `SECTION_PROFILES` are:
1. `phones` -- "Telephones" / "Phones"
2. `electronics` -- "Electronique" / "Electronics"
3. `vehicles` -- "Vehicules" / "Vehicles"
4. `parts_accessories` -- "Pieces & Accessoires" / "Parts & Accessories"
5. `gaming` -- "Jeux Video" / "Gaming"
6. `clothing` -- "Vetements et Mode" / "Clothing & Fashion"
7. `home_garden` -- "Maison & Jardin" / "Home & Garden"
8. `toys` -- "Jouets" / "Toys"
9. `sporting_goods` -- "Articles de Sport" / "Sporting Goods"
10. `refurbished` -- "Offres Reconditionnees" / "Refurbished Deals"

All titles are guaranteed non-empty by `normalizeSectionTitles()`.

## Deploy

Redeploy `catalog-home`, `catalog-home-v2`, and `catalog-home-legacy` (they all import `mobileSectionsCache.ts`).

## Expected Result

- Mobile gets 10 sections with proper keys and localized titles (multiple scrollable carousels)
- Staging requests fallback to production cache when staging is empty
- Web stays unchanged (single featured feed)
- Payments untouched
