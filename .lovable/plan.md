
# Fix: Mobile Section Relevancy — Use `segment` Field Instead of Keyword Matching

## Problem

The cached items already have a correct `segment` tag (e.g., `phones`, `cars`, `gaming`, `accessories`, `home`) assigned during cache building. However, the `buildMobileSectionsFromPool()` function in `catalog-home/index.ts` and `catalog-home-v2/index.ts` **ignores this field entirely** and instead does loose keyword matching on item titles. This causes:

- **Vehicles section** showing phones (because "Samsung Galaxy" doesn't match any vehicle keyword, so it falls into redistribution)
- **Video Games section** showing phone stands (because "cell phone stand" matches the keyword "game" nowhere, but redistribution dumps random items there)
- **Home & Garden** showing phone cases (redistribution)

### Current cache pool (891 items):
- `phones`: 146 items
- `cars`: 145 items  
- `gaming`: 200 items
- `accessories`: 200 items
- `home`: 200 items

These segment tags are accurate but unused.

## Solution

Replace keyword-based matching with **segment-based matching** in `buildMobileSectionsFromPool()`. Map the 5 segment values to the 8 mobile section keys. Sections without a matching segment (e.g., toys, sporting_goods) stay empty — this is better than showing irrelevant products.

### Segment-to-Section Mapping:
```text
segment "phones"      -> section "phones"
segment "accessories"  -> section "electronics"  
segment "cars"         -> section "vehicles"
segment "gaming"       -> section "video_games"
segment "home"         -> section "home_garden"
```

Sections without segment matches (clothing_fashion, toys, sporting_goods) will only get items via keyword fallback on unmatched items — never random redistribution.

## Changes

### 1. `supabase/functions/catalog-home/index.ts` — `buildMobileSectionsFromPool()`

- Add a segment-to-section-key mapping
- **Phase 1**: Assign items to sections by their `segment` field (fast, accurate)
- **Phase 2**: For remaining unmatched items, use keyword matching as a secondary signal
- **Remove the blind redistribution** fallback that dumps random items into sections when fewer than 3 sections have items — this is the main source of irrelevant products

### 2. `supabase/functions/catalog-home-v2/index.ts` — Same fix

Apply the identical change to the v2 function since both define their own `buildMobileSectionsFromPool`.

### 3. `supabase/functions/_shared/mobileCatalogHandler.ts` — Same fix  

The shared handler also has `buildMobileSections()` with the same redistribution bug. Apply the same segment-first logic.

## What Does NOT Change

- Section keys, titles, and count (still 8 sections)
- Cache structure and cache-building logic
- Web response format
- Client detection logic
- Title normalization
- Fallback tiers (fresh cache, stale cache, DB bootstrap)
- CORS headers

## Risk Assessment

- **Zero regression risk on web**: Web path is completely separate (`clientType === "web"`)
- **Zero regression on mobile detection**: No changes to detection logic
- **Mobile sections will be more relevant**: Items placed by segment tag rather than loose title matching
- **Some sections may have fewer items**: Clothing, toys, sporting_goods may be empty if no matching segment exists in the cache — this is correct behavior (empty section is better than wrong items)
