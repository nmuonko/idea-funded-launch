

# Fix Amazon Product Gallery Images via Rainforest API

## Problem Summary

Amazon products are showing only 1 image in the app instead of the full gallery (5-10+ images). Investigation reveals **two distinct issues**:

### Issue 1: Images Array Only Contains Thumbnails
The `catalog_items` table shows Amazon products with only 1 thumbnail image:
```
images: ["https://m.media-amazon.com/images/I/81hZmCZ5RVL._AC_UL320_.jpg"]
```
- This `_AC_UL320_` suffix indicates a 320px low-resolution thumbnail
- The full gallery images are NOT being extracted from Rainforest API responses

### Issue 2: Media Cache Has Empty Image Arrays
Similar to the eBay issue, the `catalog_item_media` table shows:
```
image_count: 1, image_urls: []  // Empty for ALL Amazon items
```
This indicates the media enrichment fetch is failing to extract images.

---

## Root Cause Analysis

After reviewing `rainforestAdapter.ts`, the `extractImages` function (lines 711-845) already checks 10 different image sources:
1. `product.images[]`
2. `product.image_gallery[]`
3. `result.images[]`
4. `result.image_gallery[]`
5. `hi_res_images[]`
6. `images_flat[]`
7. `variants[].main_image` and `variants[].images[]`
8. `main_image`
9. `image` (string)
10. `thumbnail` / `small_image` fallbacks

However, the function is **only returning 1 image** because:
1. **Rainforest search results** (used for list views) only return `main_image` with a single thumbnail
2. **Rainforest product details** should return full `images[]` array, but the current code may not be receiving it

The key insight from logs is that `extractImages` logs show:
```
sources: { images: 0, gallery: 0, hiRes: 0, variants: 0 }
```
This means Rainforest is not returning the `images` array in the expected format.

---

## Solution: Enhanced Rainforest Image Extraction

### Step 1: Add Debug Logging to Rainforest Adapter
Before fixing, we need to understand what Rainforest is actually returning:

```typescript
// In fetchProductDetails()
console.log("[RAINFOREST_PRODUCT_RAW_KEYS]", JSON.stringify({
  asin: data.product?.asin,
  topKeys: Object.keys(data.product || {}),
  hasImages: !!data.product?.images,
  imagesType: typeof data.product?.images,
  imagesLength: Array.isArray(data.product?.images) ? data.product.images.length : 'N/A',
  hasMainImage: !!data.product?.main_image,
  hasGallery: !!data.product?.image_gallery,
}));
```

### Step 2: Handle Rainforest's Actual Response Structure
Based on Rainforest API documentation and common patterns, their `type=product` response typically includes:
- `product.main_image` - Primary product image object with `link` property
- `product.images` - Array of image objects, each with `link`, `variant`, etc.
- `product.variants[].images` - Variant-specific images

The current code expects image objects with `link` or `large` fields, but Rainforest may use different field names. We need to handle:
```typescript
// Rainforest image object can be:
{ link: "url", variant: "PT01" }  // Standard
{ url: "url" }                     // Alternative
"https://..."                      // Direct string
```

### Step 3: Add Variant Image Aggregation
Rainforest product responses often have most images in `variants[].images` rather than the top-level `images[]`. We should:
1. Increase the variant image limit from 3 to 8 per variant
2. Prioritize unique images across all variants

### Step 4: Request All Image Data from Rainforest
The current API call may not be requesting full image data. We should verify the API request includes necessary parameters.

---

## Technical Implementation

### File: `supabase/functions/_shared/rainforestAdapter.ts`

#### Change 1: Enhanced Debug Logging in `fetchProductDetails()`
Add logging after receiving the Rainforest response to see exactly what fields are present.

#### Change 2: Improve `extractImages()` Function
```typescript
function extractImages(product: RainforestProduct): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  const rawProduct = product as any;
  
  // ENHANCED: Log raw image data for debugging
  console.log("[RAINFOREST_IMAGES_RAW]", JSON.stringify({
    asin: product.asin,
    hasImages: !!rawProduct.images,
    imagesType: Array.isArray(rawProduct.images) ? 'array' : typeof rawProduct.images,
    imagesLen: rawProduct.images?.length || 0,
    sampleImage: rawProduct.images?.[0] ? JSON.stringify(rawProduct.images[0]).slice(0, 100) : null,
    hasGallery: !!rawProduct.image_gallery,
    galleryLen: rawProduct.image_gallery?.length || 0,
    hasHiRes: !!rawProduct.hi_res_images,
    variantsLen: rawProduct.variants?.length || 0,
  }));

  // ... existing extraction logic with enhancements ...
  
  // CHANGE: Increase variant image limit from 3 to 8
  for (const variant of rawProduct.variants.slice(0, 10)) {
    if (variant.main_image) {
      addImage(extractUrl(variant.main_image));
    }
    if (variant.images && Array.isArray(variant.images)) {
      for (const img of variant.images.slice(0, 8)) { // Was 3, now 8
        addImage(extractUrl(img));
      }
    }
  }
  
  // CHANGE: Increase max images from 10 to 15
  return images.slice(0, 15);
}
```

#### Change 3: Handle Rainforest-Specific Image Fields
Add extraction for additional Rainforest-specific fields:
```typescript
// === Source 11: product.main_image.link (common Rainforest format) ===
if (rawProduct.main_image?.link) {
  addImage(rawProduct.main_image.link, true);
}

// === Source 12: Check for "images_count" field and log mismatch ===
if (rawProduct.images_count && rawProduct.images_count > images.length) {
  console.log("[RAINFOREST_IMAGE_MISMATCH]", JSON.stringify({
    asin: product.asin,
    reported: rawProduct.images_count,
    extracted: images.length,
  }));
}
```

### Step 5: Clear Stale Amazon Media Cache
After deployment, run SQL to force re-fetch:
```sql
DELETE FROM catalog_item_media 
WHERE provider = 'amazon' 
  AND image_count <= 2;

DELETE FROM catalog_items 
WHERE provider = 'rainforest' 
  AND jsonb_array_length(COALESCE(images, '[]'::jsonb)) <= 2;
```

---

## Files to Modify

1. **`supabase/functions/_shared/rainforestAdapter.ts`**
   - Add detailed debug logging in `fetchProductDetails()` 
   - Enhance `extractImages()` with more sources
   - Increase image limits (variants: 3→8, total: 10→15)
   - Add Rainforest-specific field handling

2. **Database cleanup**
   - Delete stale Amazon items with ≤2 images to force re-fetch

---

## Expected Outcome

After these fixes:
- Amazon products will display full image galleries (5-15 images typical)
- Debug logs will reveal exactly what Rainforest returns
- Media cache will properly store all Amazon image URLs
- Product detail pages will show complete photo galleries

---

## Risk Assessment

**Low Risk**: These are data extraction improvements with added logging. No API contract changes.

**Testing Plan**:
1. Deploy with debug logging enabled
2. Open an Amazon product to trigger fresh fetch
3. Check edge function logs for `[RAINFOREST_IMAGES_RAW]` output
4. Verify `catalog_item_media` shows correct `image_count` > 1
5. Confirm frontend displays multiple images

