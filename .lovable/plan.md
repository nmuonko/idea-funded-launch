
# Plan: Infinite Scroll + Item Diversity + Full Car Galleries

## Overview

This plan addresses three improvements to the homepage and catalog experience:
1. Add infinite scroll to load more items in homepage sections
2. Implement item diversity/shuffling to show variety (e.g., iPhone, Galaxy, different phone each time)
3. Show full image galleries for cars/vehicles from eBay

---

## Current State Analysis

### Homepage Sections
- Currently shows 12 items per section with "See All" button
- Items come in the order returned by API (no shuffling)
- `hasMore` flag exists but no pagination/loading mechanism

### Item Order
- Items from eBay/Amazon appear in API order (relevance-based)
- Brand diversity only applies to clothing category
- Same products appear first in each section on every load

### Car/Vehicle Images
- Homepage eBay listings show max 2 images (performance optimization)
- Full gallery only fetched on product detail view
- `image_count` field exists showing total available images

---

## Technical Implementation

### 1. Homepage Infinite Scroll

**Backend Changes (catalog-home/index.ts):**
- Add `cursor` query parameter for pagination
- For cursor requests, return next batch of items from a specific section
- Return `next_cursor` and `has_more` per section

**New Endpoint Behavior:**
- `GET /catalog-home` - Initial load (all sections, 12 items each)
- `GET /catalog-home?section=phones&cursor=...` - Load more for a specific section

**Code Changes:**
```text
File: supabase/functions/catalog-home/index.ts
- Add parseCursor/buildNextCursor helpers
- When cursor present, only fetch/return that section
- Return next_cursor for infinite scroll
```

### 2. Item Diversity (Shuffle + Interleave)

**Backend Changes (catalog-prewarm-worker):**
- After fetching items from APIs, apply diversity algorithm
- Interleave items by detected "category" or "brand" within each provider
- Shuffle seed queries to get different products on each prewarm

**Diversity Algorithm:**
```text
Given items: [iPhone1, iPhone2, iPhone3, Galaxy1, Galaxy2, Pixel1]
Result:      [iPhone1, Galaxy1, Pixel1, iPhone2, Galaxy2, iPhone3]
```

**Code Changes:**
```text
File: supabase/functions/_shared/brandExtractor.ts
- Add phone/electronics brand detection (Apple, Samsung, Google, Tecno, etc.)
- Export applyItemDiversity() for any category

File: supabase/functions/catalog-prewarm-worker/index.ts  
- After mixing, apply applyItemDiversity() to shuffle items by brand/type
- Randomize seed query order during prewarm
```

### 3. Full Car Gallery Images

**Backend Changes (ebayBrowseSearch.ts):**
- For vehicle category, request full images instead of limiting to 2
- Store all images in response for vehicle listings

**Code Changes:**
```text
File: supabase/functions/_shared/ebayBrowseSearch.ts
- Add isVehicleCategory parameter to extractHighResImages()
- When isVehicle=true, return all images (no slice(0,2) limit)
- Return full images array in vehicle listings

File: supabase/functions/catalog-home/index.ts
- Pass isVehicle flag when mapping vehicle section items
- Ensure images array is fully returned for vehicles
```

---

## Implementation Sequence

### Phase 1: Item Diversity
1. Extend `brandExtractor.ts` with electronics/phone brand detection
2. Add generic `applyItemDiversity()` function
3. Apply diversity in `catalog-prewarm-worker` after mixing

### Phase 2: Full Car Gallery
1. Update `ebayBrowseSearch.ts` to not limit images for vehicles
2. Update `catalog-home` to pass vehicle flag
3. Test vehicle section shows multiple images

### Phase 3: Infinite Scroll
1. Add cursor parsing to `catalog-home`
2. Implement section-specific pagination
3. Return `next_cursor` for each section with more items

---

## Data Flow After Changes

```text
Homepage Load:
┌─────────────────────────────────────────────────────────────────┐
│ catalog-prewarm-worker (12-hour cron)                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. Fetch items from Amazon + eBay                               │
│ 2. Mix providers (Amazon-first → Blend → eBay)                  │
│ 3. Apply diversity: shuffle items by brand/type    [NEW]        │
│ 4. Cache mixed+diversified items                                │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ catalog-home (user request)                                     │
├─────────────────────────────────────────────────────────────────┤
│ 1. Read cached mixed items for each section                     │
│ 2. Return 12 items + next_cursor per section                    │
│ 3. For vehicles: include full image gallery         [NEW]       │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ catalog-home?section=phones&cursor=abc (load more)  [NEW]       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Decode cursor → offset                                       │
│ 2. Return next batch of items                                   │
│ 3. Return updated cursor for further pagination                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `supabase/functions/_shared/brandExtractor.ts` | Enhance | Add electronics brands, create generic diversity function |
| `supabase/functions/catalog-prewarm-worker/index.ts` | Enhance | Apply diversity after mixing, randomize seed order |
| `supabase/functions/_shared/ebayBrowseSearch.ts` | Enhance | Remove 2-image limit for vehicles |
| `supabase/functions/catalog-home/index.ts` | Enhance | Add cursor pagination, pass vehicle flag |

---

## Expected Results

After implementation:
- **Diversity**: Homepage shows iPhone, then Galaxy, then Pixel, then different iPhone, etc.
- **Car Images**: Vehicle listings show full gallery (3-10+ images with navigation)
- **Infinite Scroll**: Users can load more items in each section without navigating away

---

## Notes

- No frontend contract changes required (items array structure unchanged)
- Changes are backward compatible
- Diversity applies at cache-generation time (no extra runtime cost)
- Car gallery uses existing eBay API data (no additional API calls)
