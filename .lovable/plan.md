
# Surgical Hotfix: Force Cache Invalidation + Strengthen Section Gates

## Root Cause (confirmed)

The mobile sections cache (`catalog_home_mobile_sections_cache`) has `schema_version=1` data that was built with weaker filtering. The current code architecture is correct -- `serveMobileSections()` checks schema version and rebuilds on mismatch -- but the version hasn't been bumped since the profiles were strengthened. Additionally, some exclude lists need hardening (e.g., vehicles must forbid bare "phone", "samsung", "case").

## Changes (3 files only)

### 1. `supabase/functions/_shared/mobileSectionsCache.ts`
- Bump `MOBILE_SECTIONS_SCHEMA_VERSION` from `1` to `2`
- This single change forces every mobile request to treat existing cache as invalid, triggering a full rebuild with the current strict profiles
- No other changes to this file

### 2. `supabase/functions/_shared/sectionProfiles.ts`
Strengthen keyword lists per the user's exact gate specifications:

**Vehicles `excludeAny`**: Add bare "phone", "samsung", "case", "charger", "airpods", "earbuds", "screen protector", "magsafe", "controller", "accessory", "accessories", "parts" (currently only excludes compound phrases like "samsung galaxy")

**Gaming `excludeAny`**: Add "phone", "samsung", "case", "charger", "screen protector", "magsafe", "car", "truck", "suv", "motorcycle", "bumper", "brake", "headlight"

**Phones `excludeAny`**: Add bare "bumper", "brake", "headlight", "oem", "aftermarket" (already has VEHICLE_CORE + PARTS_WORDS but verify completeness)

**Electronics `excludeAny`**: Strengthen to also exclude PARTS_WORDS and PHONE_WORDS to prevent phone/parts bleed

**Parts `excludeAny`**: Already excludes PHONE_WORDS + GAMING_WORDS -- verify completeness

**Clothing, Home, Toys, Sporting Goods**: Add phone and gaming exclusions to prevent cross-contamination

### 3. `supabase/functions/_shared/titleNormalizer.ts`
- Add the new section keys ("parts_accessories", "gaming", "clothing", "refurbished") to the `TITLE_MAP` so title normalization works for all 10 sections
- No other changes

### What does NOT change
- `catalog-home/index.ts` -- no code changes needed, it already delegates to `serveMobileSections()`
- `catalog-home-v2/index.ts` -- no code changes needed, same delegation
- Web UI / web response path -- completely untouched
- Payments, cart, checkout -- zero changes
- Response shape -- identical `ok`, `sections[]`, `page`, `pageSize`, `hasMore`, `meta`
- Cache table schema -- same table, just new schema_version value in data

### Deploy
- Redeploy `catalog-home` and `catalog-home-v2` (they import the shared modules)
- First mobile request after deploy will see `schema_version` mismatch, rebuild strict sections from pool + backfill, cache result with `schema_version=2`
- Subsequent requests are instant cache hits

## Technical Details

The `MOBILE_SECTIONS_SCHEMA_VERSION` check in `readMobileSectionsCache()` (line 73) does an exact match:
```
if (row.schema_version !== MOBILE_SECTIONS_SCHEMA_VERSION) -> cache miss -> rebuild
```
Bumping from 1 to 2 triggers this path, which calls `buildStrictSectionsFromPool()` using the updated `SECTION_PROFILES` with hardened exclude lists. The rebuilt sections are then cached with `schema_version=2`.
