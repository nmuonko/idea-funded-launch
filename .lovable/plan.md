
# Plan: Fix Full Image Galleries for All Items (Amazon + eBay)

## Problem Summary

The Rainforest adapter correctly extracts **all images** from Amazon products (up to 100), but the catalog endpoints ignore the `p.images` array and only use `p.imageUrl` (single image). This results in all items showing just 1 image.

## Root Cause

In **catalog-search/index.ts**, when mapping Rainforest products:

```typescript
// Lines 521-523 (CURRENT - BUG)
images: p.imageUrl ? [p.imageUrl] : [],      // Ignores p.images!
imageUrls: p.imageUrl ? [p.imageUrl] : [],
imageCount: 1,
```

The same pattern exists in cache mapping and DB upsert logic.

Similarly, **catalog-prewarm-worker/index.ts** doesn't pass the images array to cached items.

## Technical Changes

### File 1: `supabase/functions/catalog-search/index.ts`

**Change 1: Fix live Rainforest mapping (lines 511-528)**

```typescript
// BEFORE (lines 521-523):
images: p.imageUrl ? [p.imageUrl] : [],
imageUrls: p.imageUrl ? [p.imageUrl] : [],
imageCount: 1,

// AFTER:
images: (p.images && p.images.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
imageUrls: (p.images && p.images.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
imageCount: p.imageCount || (p.images?.length || 1),
```

**Change 2: Fix DB upsert (line 565)**

```typescript
// BEFORE:
images: p.imageUrl ? [p.imageUrl] : [],

// AFTER:
images: (p.images && p.images.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
```

**Change 3: Fix cache hit mapping (lines 606-608)**

```typescript
// BEFORE:
images: p.imageUrl ? [p.imageUrl as string] : [],
imageUrls: p.imageUrl ? [p.imageUrl as string] : [],
imageCount: 1,

// AFTER:
images: (p.images && Array.isArray(p.images) && p.images.length > 0) 
  ? p.images as string[] 
  : (p.imageUrl ? [p.imageUrl as string] : []),
imageUrls: (p.images && Array.isArray(p.images) && p.images.length > 0) 
  ? p.images as string[] 
  : (p.imageUrl ? [p.imageUrl as string] : []),
imageCount: (p.imageCount as number) || ((p.images as string[])?.length || 1),
```

### File 2: `supabase/functions/catalog-prewarm-worker/index.ts`

**Change 1: Fix mapAmazonToProviderItem (lines 239-256)**

```typescript
// BEFORE (lines 246-249):
imageCount: 1,
imageMissing: !imageUrl,

// AFTER - add images array:
images: (p.images && Array.isArray(p.images) && p.images.length > 0) 
  ? p.images as string[] 
  : (imageUrl ? [imageUrl] : []),
imageUrls: (p.images && Array.isArray(p.images) && p.images.length > 0) 
  ? p.images as string[] 
  : (imageUrl ? [imageUrl] : []),
imageCount: (p.imageCount as number) || ((p.images as string[])?.length || 1),
imageMissing: !imageUrl,
```

**Change 2: Fix mapEbayToProviderItem (lines 260-277)**

```typescript
// BEFORE (lines 268-270):
imageCount: item.image_count || 1,
imageMissing: !imageUrl,

// AFTER - add images array:
images: item.images || item.image_urls || (imageUrl ? [imageUrl] : []),
imageUrls: item.images || item.image_urls || (imageUrl ? [imageUrl] : []),
imageCount: item.image_count || (item.images?.length || item.image_urls?.length || 1),
imageMissing: !imageUrl,
```

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `supabase/functions/catalog-search/index.ts` | 521-523 | Use p.images array for live Rainforest |
| `supabase/functions/catalog-search/index.ts` | 565 | Use p.images array for DB upsert |
| `supabase/functions/catalog-search/index.ts` | 606-608 | Use p.images array for cache mapping |
| `supabase/functions/catalog-prewarm-worker/index.ts` | 246-249 | Add images arrays to Amazon items |
| `supabase/functions/catalog-prewarm-worker/index.ts` | 268-270 | Add images arrays to eBay items |

## Data Flow After Fix

```text
Rainforest API
     ↓
extractImages() → images: ["url1", "url2", "url3", "url4", "url5"]
     ↓
normalizeProduct() → { images: [...], imageCount: 5 }
     ↓ (FIXED)
catalog-search mapping → { images: [...], imageCount: 5 }  ← NOW PRESERVED
     ↓
API Response → Full gallery available
```

## Expected Results

- **Amazon items**: Show 5-10+ images per product (from Rainforest API)
- **eBay items**: Continue showing full galleries (already working)
- **Cached items**: Will preserve all images going forward
- **Homepage**: New prewarmed items will have full galleries

## Note on Existing Cache

Items already cached with only 1 image will continue to show 1 image until:
1. Cache expires (TTL-based)
2. Next prewarm cycle runs
3. User views product detail (fetches fresh data)

New searches and prewarmed content will have full galleries immediately.
