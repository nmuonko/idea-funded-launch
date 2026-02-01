
# Implementation Plan: Infinite Scroll + Item Diversity + Full Car Galleries + Fix Category API Issues

## Overview

This plan addresses four improvements:
1. **Fix 0-products categories** - Expand Amazon category allowlist and add eBay rate-limit resilience
2. **Add item diversity/shuffling** - Show variety (iPhone, Galaxy, Pixel, etc.) instead of same-brand clusters
3. **Full image galleries for vehicles** - Remove 2-image limit for car listings
4. **Homepage infinite scroll** - Allow loading more items per section

## Root Cause Analysis: 0-Products Issue

The logs reveal two problems:

### Problem 1: eBay API Rate Limiting (HTTP 429)
```
[EBAY_BROWSE] API error: 429 "Too many requests"
```
The eBay Browse API is returning rate limit errors, causing all live searches to fail.

### Problem 2: Amazon Category Restrictions
Current `amazon_category_allowlist` only includes:
- `electronics`, `electronics_phones`, `electronics_computers`, `electronics_gaming`, `electronics_cameras`, `electronics_audio`

Categories like `clothing_women`, `toys`, `business_industrial`, `jewelry_watches` are **excluded**, so Amazon shows `"amazonStatus": "disabled"`.

### Combined Effect
- eBay: Rate limited → 0 items
- Amazon: Disabled for non-electronics → 0 items
- Result: Empty categories

---

## Technical Implementation

### Phase 1: Fix 0-Products Issue

#### 1.1 Expand Amazon Category Allowlist (Database Update)
Update `admin_settings` to include all categories in the allowlist:

```sql
UPDATE admin_settings 
SET value = '["electronics","electronics_phones","electronics_computers","electronics_gaming","electronics_cameras","electronics_audio","clothing_shoes_accessories","clothing_men","clothing_women","clothing_shoes","clothing_bags","toys","sporting_goods","business_industrial","jewelry_watches","home_garden","refurbished","parts_accessories"]',
    updated_at = now()
WHERE key = 'amazon_category_allowlist';
```

#### 1.2 Add eBay Rate Limit Backoff (ebayBrowseSearch.ts)
Add exponential backoff and caching for rate-limited responses:

```text
File: supabase/functions/_shared/ebayBrowseSearch.ts

Changes:
- Detect 429 responses
- Return cached results if available on rate limit
- Add circuit breaker pattern to avoid hammering rate-limited API
- Log rate limit events for monitoring
```

---

### Phase 2: Item Diversity (Brand Shuffling)

#### 2.1 Extend Brand Extractor for Electronics (brandExtractor.ts)
Add phone and electronics brand detection:

```text
File: supabase/functions/_shared/brandExtractor.ts

Add brands:
- Phone brands: Apple, Samsung, Google, Tecno, Infinix, itel, Oppo, Xiaomi
- Gaming: Sony, Microsoft, Nintendo
- Computers: Dell, HP, Lenovo, ASUS, Acer, MSI

New function: applyItemDiversity(items, options)
- Interleave by brand/type using round-robin
- Support configurable maxPerBrand (default: 2)
- Apply to all categories, not just clothing
```

#### 2.2 Apply Diversity in Prewarm Worker (catalog-prewarm-worker/index.ts)
```text
File: supabase/functions/catalog-prewarm-worker/index.ts

Changes:
- After mixing Amazon + eBay items, apply applyItemDiversity()
- Randomize seed query order for variety each prewarm cycle
- Log diversity distribution for debugging
```

#### 2.3 Apply Diversity in catalog-category (catalog-category/index.ts)
```text
File: supabase/functions/catalog-category/index.ts

Changes:
- Apply applyItemDiversity() after provider mixing (not just for clothing)
- Use category-specific diversity rules (phones: max 2 per brand)
```

---

### Phase 3: Full Vehicle Image Galleries

#### 3.1 Remove 2-Image Limit for Vehicles (ebayBrowseSearch.ts)
```text
File: supabase/functions/_shared/ebayBrowseSearch.ts

Changes to extractHighResImages():
- Add isVehicle parameter
- When isVehicle=true, return ALL images (no slice(0,2))
- Keep 2-image limit for non-vehicle categories (performance)

New function signature:
extractHighResImages(item, { isVehicle?: boolean })
```

#### 3.2 Pass Vehicle Flag in Search (searchEbay, searchEbayWithFallback)
```text
Ensure isVehicle param is passed through the chain:
- catalog-category → searchEbay → extractHighResImages
- Return full images array for vehicle listings
```

---

### Phase 4: Homepage Infinite Scroll

#### 4.1 Add Cursor Pagination to catalog-home (catalog-home/index.ts)
```text
File: supabase/functions/catalog-home/index.ts

New query parameters:
- section: string (section key for loading more)
- cursor: string (encoded offset)

Behavior:
- If cursor present: return next batch for specific section
- Return next_cursor and has_more per section
- Support infinite scroll without full page reload
```

---

## Data Flow After Changes

```text
Homepage Load (Initial):
┌─────────────────────────────────────────────────────────────────┐
│ catalog-home (GET /)                                            │
├─────────────────────────────────────────────────────────────────┤
│ Returns all sections with 12 items each                         │
│ Each section includes:                                          │
│   - items[]                                                     │
│   - hasMore: boolean                                            │
│   - nextCursor: string | null     [NEW]                         │
└─────────────────────────────────────────────────────────────────┘

Load More (Infinite Scroll):
┌─────────────────────────────────────────────────────────────────┐
│ catalog-home?section=phones&cursor=abc                [NEW]     │
├─────────────────────────────────────────────────────────────────┤
│ Returns next batch for that section only                        │
│ Returns updated cursor for further pagination                   │
└─────────────────────────────────────────────────────────────────┘

Item Diversity (Applied at Prewarm + Live):
┌─────────────────────────────────────────────────────────────────┐
│ Before: [iPhone, iPhone, iPhone, Galaxy, Galaxy, Pixel]         │
│ After:  [iPhone, Galaxy, Pixel, iPhone, Galaxy, iPhone]   [NEW] │
└─────────────────────────────────────────────────────────────────┘

Vehicle Images:
┌─────────────────────────────────────────────────────────────────┐
│ Before: images: [main, additional] (max 2)                      │
│ After:  images: [all images from listing]              [NEW]    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| **Database** | Update | Expand `amazon_category_allowlist` to include all categories |
| `supabase/functions/_shared/brandExtractor.ts` | Enhance | Add electronics brands, make diversity work for all categories |
| `supabase/functions/_shared/ebayBrowseSearch.ts` | Enhance | Add rate-limit resilience, full images for vehicles |
| `supabase/functions/catalog-category/index.ts` | Enhance | Apply diversity to all categories (not just clothing) |
| `supabase/functions/catalog-prewarm-worker/index.ts` | Enhance | Apply diversity after mixing, randomize seed order |
| `supabase/functions/catalog-home/index.ts` | Enhance | Add cursor pagination for infinite scroll |

---

## Implementation Order

1. **Database update** - Expand Amazon allowlist (immediate fix for 0-products)
2. **eBay rate limit handling** - Add resilience for API errors
3. **Brand extractor** - Add electronics brands and universal diversity
4. **catalog-category diversity** - Apply to all categories
5. **Vehicle full images** - Remove 2-image limit for cars
6. **Homepage infinite scroll** - Add cursor support

---

## Expected Results

After implementation:
- **All categories return products** - Amazon enabled for all, eBay with rate-limit resilience
- **Diverse results** - iPhone, Galaxy, Pixel interleaved instead of clusters
- **Full vehicle galleries** - All car images available for navigation
- **Infinite scroll** - Users can load more items in each section

---

## Technical Notes

- No frontend contract changes required (items array structure unchanged)
- Changes are backward compatible
- Diversity applies at both cache-generation time AND live requests
- Car gallery uses existing eBay API data (no additional API calls)
- Database update is safe and reversible
