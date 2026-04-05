

# Fix "See All" to Show Relevant Items in RN App

## Problem
When a user taps "Voir Tout" (See All) on a homepage section (e.g., Phones, Gaming, Home), `catalog-home` delegates to `catalog-category` with the section key. `catalog-category` returns items based on broad DB `unified_category` values and eBay category IDs, but does NOT apply the same strict keyword include/exclude filtering that the homepage sections use (from `sectionProfiles.ts`). Result: irrelevant items leak into "See All" views.

Examples found:
- Home & Garden returns "WiFi Extender Signal Booster" (electronics)
- Home & Garden returns "Vegetable Packaging Machine" (industrial equipment)

## Root Cause
The homepage sections use `filterItemsForProfile()` from `sectionProfiles.ts` with strict `includeAny`/`excludeAny` keyword matching. But `catalog-category` has no awareness of section context — it just queries by `unified_category` and eBay category ID, both of which are too broad.

## Solution
Pass the section context from `catalog-home` to `catalog-category`, then apply the same section profile keyword filtering as a post-filter on results.

### Changes

**1. `catalog-home/index.ts` — Pass `sectionKey` in delegation URL**
- Add `&sectionKey=phones` (or whatever section) to the `catalog-category` delegation URL on line ~1081
- This tells `catalog-category` the request originated from a section "See All"

**2. `catalog-category/index.ts` — Accept `sectionKey` param and apply section keyword filter**
- Parse `sectionKey` from query params / POST body (alongside existing `category`, `cursor`, etc.)
- After mixing results (line ~746), if `sectionKey` is set, import and apply `filterItemsForProfile()` from `sectionProfiles.ts` to remove items that don't match the section's keyword rules
- This reuses the existing, well-tested keyword matching logic — no new filtering code needed
- Only applies when `sectionKey` is provided, so normal category browsing is unaffected

**3. `_shared/sectionProfiles.ts` — Export lookup helper**
- Add a `getSectionProfile(key: string)` export that returns the matching `SectionProfile` by key, or `null`
- This avoids importing the full `SECTION_PROFILES` array and searching manually

### Flow After Fix

```text
RN: "Voir Tout" on Phones section
  → catalog-home: section=phones
    → catalog-category?category=phones&sectionKey=phones&limit=500
      → Fetch Amazon DB + eBay by electronics_phones category
      → Mix results (200 items)
      → Post-filter with phones section profile keywords
      → Return only items matching phone keywords, excluding accessories
```

## What Stays the Same
- Normal category browsing (web tabs, direct category requests) — unchanged
- Homepage section card display — unchanged  
- Section profile keyword definitions — unchanged (reused as-is)
- All existing API contracts — unchanged
- The `see_all_category` field in cached sections — unchanged

## OTA Friendly
This is a backend-only change (edge functions). The frozen RN app sends the same `section` param it always has. No mobile code changes needed.

