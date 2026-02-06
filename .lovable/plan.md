

# Fix: Cache Settings Integration + Production Schema Sync + Home Curation Alignment

## Issues Found (3 Critical, 2 Medium)

### Critical 1: Production Cache Schema Mismatch
The production mobile sections cache is stuck at `schema_version: 3` while the code expects version `4`. This causes EVERY mobile request to miss cache, rebuild sections from scratch, and then save under version 4 -- but production never gets updated because the prewarm job (which writes production cache) hasn't run since the version bump.

**Fix**: Update the production cache row to `schema_version: 4` by triggering a rebuild, and ensure the prewarm function writes version 4.

### Critical 2: Cache Settings Tab is Disconnected
The admin Cache Settings page (`CacheSettings.tsx`) writes to `catalog_cache_settings` table, but the edge functions (`catalog-home`) read TTLs from `admin_settings` table (`home_feed_ttl_seconds`, `home_cache_ttl_seconds`, etc.). The two tables are completely independent -- changing values in the Cache Settings UI has zero effect on actual cache behavior.

**Fix**: Make `catalog-home` read from `catalog_cache_settings` as a secondary source, converting minutes to seconds, and falling back to `admin_settings` if not found.

### Critical 3: Home Curation Seeds Missing for 5 of 10 Mobile Sections
The database has seeds for only 3 sections: `phones` (25 seeds), `gaming` (19 seeds), `vehicles` (38 seeds). The other 7 mobile sections (`electronics`, `parts_accessories`, `clothing`, `home_garden`, `toys`, `sporting_goods`, `refurbished`) have ZERO curated seeds. Additionally, the DB defines a `computers` section that doesn't exist in `sectionProfiles.ts` -- those seeds go unused.

**Fix**: Add the missing 7 sections to `home_sections` and populate initial seeds for each. Map the existing `computers` seeds into the `electronics` section.

### Medium 1: Catalog Sources Cache TTLs Are Duplicated
The Catalog Sources page (`CatalogSourcesSettings.tsx`) has its own cache TTL fields (`search_cache_ttl_seconds`, `home_cache_ttl_seconds`, etc.) stored in `admin_settings`, while the Cache Settings page stores similar values in `catalog_cache_settings`. This creates confusion about which values are authoritative.

**Fix**: Remove the cache TTL fields from the Catalog Sources page (they already exist in the dedicated Cache tab) and add a note pointing users to the Cache tab.

### Medium 2: Mobile Sections Cache TTL Is Hardcoded
`mobileSectionsCache.ts` uses `DEFAULT_TTL_SECONDS = 1800` (30 min) regardless of what the admin sets in any settings table.

**Fix**: Read the TTL from `admin_settings` (`home_cache_ttl_seconds`) or `catalog_cache_settings` (`home_expires_minutes`) at serve time.

---

## Implementation Plan

### 1. Fix `mobileSectionsCache.ts` -- Read TTL from DB
In `serveMobileSections()`, accept an optional `ttlOverride` parameter. The calling function in `catalog-home/index.ts` will pass the TTL loaded from `admin_settings`.

### 2. Fix `catalog-home/index.ts` -- Bridge Cache Settings
In `loadFeedSettings()`, after reading `admin_settings`, also check `catalog_cache_settings` for `home_expires_minutes` and convert to seconds. Use the most recently updated value as authoritative.

### 3. Add Missing Home Sections + Seeds (DB migration)
Insert the 7 missing sections into `home_sections`:
- `electronics` (sort_order 1)
- `parts_accessories` (sort_order 4)
- `clothing` (sort_order 5)
- `home_garden` (sort_order 6)
- `toys` (sort_order 7)
- `sporting_goods` (sort_order 8)
- `refurbished` (sort_order 9)

Insert starter seeds for each (10-15 queries per section based on the keywords already in `sectionProfiles.ts`).

Rename the `computers` section key to `electronics` (or merge its seeds).

### 4. Clean Up Catalog Sources Page
Remove the "Cache Duration" card from `CatalogSourcesSettings.tsx` since it duplicates the Cache tab. Add a small info note: "Cache settings are managed in the Cache & Performance tab."

### 5. Fix Production Cache Schema
After deploying the edge functions, trigger a prewarm to rebuild the production mobile sections cache with `schema_version: 4`.

### 6. Deploy
Redeploy `catalog-home`, `catalog-home-v2`, and `catalog-home-legacy`.

---

## What Does NOT Change
- Web app response format (single featured feed)
- Mobile section keys and titles (same 10 sections from `sectionProfiles.ts`)
- Payments, cart, checkout -- zero changes
- Product sourcing logic, provider mixing -- zero changes
- The Cache Settings admin UI layout -- unchanged (it just starts working)

## Expected Result
- Cache Settings tab values actually control edge function TTLs
- Home Curation has all 10 sections with seeds, so prewarm populates all carousels
- Production cache stays on schema version 4 (no more constant rebuilds)
- Catalog Sources page no longer has confusing duplicate cache fields
- Mobile app gets fuller sections with more diverse products

