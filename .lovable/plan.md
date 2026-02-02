
# Plan: Faster Infinite Scroll + Full Image Galleries for All Items

## Overview

This plan addresses two issues:
1. **Slow Loading**: Increase batch sizes and optimize fetching for faster infinite scroll
2. **Single Image Problem**: Return full image galleries for ALL items (not just vehicles)

---

## Root Cause Analysis

### Problem 1: Slow Infinite Scroll
Current configuration:
- `HOME_PAGE_SIZE = 12` - Only 12 items per section on initial load
- `HOME_LOAD_MORE_SIZE = 12` - Only 12 items fetched when loading more
- `DEFAULT_LIMIT = 24` in search/category (reasonable)
- eBay API has 5-second timeout per section

**Why it feels slow**: Each "load more" fetches only 12 items, requiring more requests for the same content.

### Problem 2: Missing Full Gallery
In `ebayBrowseSearch.ts`, line 181:
```typescript
const maxImages = isVehicle ? 100 : 2;  // ← Only 2 images for non-vehicles!
```

In response mapping functions:
- `mapEbayItemToResponse` returns `mainImageUrl` and `imageCount` but NOT the `images` array
- `mapDbItemToResponse` returns `mainImageUrl` and `imageCount` but NOT the `images` array

**Result**: List views only show 1-2 images even though more exist on the listing.

---

## Technical Implementation

### Phase 1: Faster Loading (Increase Batch Sizes)

**File: `supabase/functions/catalog-home/index.ts`**

```text
Changes:
Line 57: HOME_PAGE_SIZE = 12 → 18 (50% more items per section initially)
Line 58: HOME_LOAD_MORE_SIZE = 12 → 24 (double the items per load-more request)
```

**File: `supabase/functions/catalog-search/index.ts`**

```text
Changes:
Line 104: DEFAULT_LIMIT = 24 → 36 (50% more items per page)
Line 105: MAX_LIMIT = 60 → 100 (allow larger requests)
```

**File: `supabase/functions/catalog-category/index.ts`**

```text
Changes:
Line 63: DEFAULT_LIMIT = 24 → 36 (50% more items per page)
Line 64: MAX_LIMIT = 60 → 100 (allow larger requests)
```

### Phase 2: Full Image Galleries for All Items

**File: `supabase/functions/_shared/ebayBrowseSearch.ts`**

```text
Changes:
Line 181: const maxImages = isVehicle ? 100 : 2;
       →  const maxImages = 100;  // Full gallery for ALL items

This ensures ALL eBay items get their complete image array.
```

**File: `supabase/functions/catalog-search/index.ts`**

```text
Changes to mapEbayItemToResponse (lines 223-246):
- Add images field: images: item.images || item.image_urls || [],
- Add imageUrls field: imageUrls: item.images || item.image_urls || [],

This returns the full gallery in search results.
```

**File: `supabase/functions/catalog-category/index.ts`**

```text
Changes to normalizeEbayItem (lines 216-249):
- Add images field with all available images
- Add imageUrls field for backward compatibility

Changes to normalizeDbItem (lines 251-290):
- Add images field from DB record
- Add imageUrls field for backward compatibility
```

**File: `supabase/functions/catalog-home/index.ts`**

```text
Changes to mapEbayItemToResponse (lines 322-341):
- Add images field: images: item.images || item.image_urls || [],
- Add imageUrls field: imageUrls: item.images || item.image_urls || [],

Changes to mapCacheItemToResponse (lines 300-320):
- Extract images array from cached items
- Add images and imageUrls fields
```

---

## Data Flow After Changes

```text
eBay API Response:
┌─────────────────────────────────────────────────────────────────┐
│ extractHighResImages(item, { isVehicle: false })                │
├─────────────────────────────────────────────────────────────────┤
│ Before: maxImages = 2   → returns [main, additional]            │
│ After:  maxImages = 100 → returns [all images]           [NEW]  │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ Response Item Structure                                         │
├─────────────────────────────────────────────────────────────────┤
│ Before:                                                         │
│   mainImageUrl: "https://..."                                   │
│   imageCount: 5                                                 │
│                                                                 │
│ After:                                             [NEW]        │
│   mainImageUrl: "https://..."                                   │
│   imageCount: 5                                                 │
│   images: ["https://...", "https://...", ...]                   │
│   imageUrls: ["https://...", "https://...", ...]                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `supabase/functions/catalog-home/index.ts` | Enhance | Increase batch sizes (12→18, 12→24), add images arrays to response |
| `supabase/functions/catalog-search/index.ts` | Enhance | Increase limits (24→36), add images arrays to response |
| `supabase/functions/catalog-category/index.ts` | Enhance | Increase limits (24→36), add images arrays to response |
| `supabase/functions/_shared/ebayBrowseSearch.ts` | Fix | Remove 2-image limit for non-vehicles (allow full gallery) |

---

## Response Type Changes

Updated CatalogItem interface (all endpoints):
```typescript
interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  mainImageUrl: string | null;   // Best single image
  imageUrl: string | null;       // Backward compat
  images: string[];              // NEW: Full gallery array
  imageUrls: string[];           // NEW: Full gallery array (alias)
  imageCount: number;            // Total images available
  imageMissing: boolean;
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  // ... other fields
}
```

---

## Expected Results

After implementation:
- **Faster Loading**: 50-100% more items per request, fewer round trips
- **Full Galleries**: All items (phones, clothing, electronics, etc.) show complete image galleries
- **Backward Compatible**: `mainImageUrl` and `imageCount` fields unchanged

---

## Performance Considerations

- **Bandwidth**: Larger image arrays increase response size (~500-1000 bytes per additional URL)
- **Mitigation**: eBay typically provides 5-10 images per listing, so impact is modest
- **Benefit**: Eliminates need for separate product detail fetch just to see images

---

## Implementation Order

1. Increase batch sizes (immediate speed improvement)
2. Remove 2-image limit in eBay adapter
3. Add images arrays to all response mappers
4. Deploy and test

