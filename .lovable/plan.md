
# Fix Product Gallery Images for eBay and Amazon

## Problem Summary

You're not getting all the images/pictures for eBay and Amazon items - even though the official listings show more photos. After investigating the codebase, I found **multiple root causes**:

### Issue 1: ID Format Mismatch in Media Cache
The `parseProviderKey` function in `mediaCache.ts` expects IDs in format `ebay:v1|123...` (with colon), but the actual catalog items use format `ebay_v1|123...` (with underscore). This causes the media cache enrichment to fail silently.

**Evidence from logs:**
```
[CATALOG_PRODUCT] id=EBAY_V1|147110427949|0 provider=rainforest error=INVALID_ID
```
The uppercase ID and wrong provider shows the parsing is failing.

### Issue 2: Response Shape Mismatch
The `fetchAndCacheMedia` function looks for:
- `productData.imageUrls` 
- `productData.product?.imageUrls`

But `/catalog-product` returns:
- `productData.item.imageUrls`

This means even when a product is successfully fetched, the images are never extracted.

**Evidence from database:**
```
image_count: 1, actual_urls_count: 0  // For ALL items in catalog_item_media
```

### Issue 3: eBay Search API Limitations
The eBay Browse API's `/item_summary/search` endpoint (used for list views) only returns:
- 1 main image
- Limited `additionalImages` (typically 0-1)

The full gallery (up to 12 images) is only available from the `/item/{itemId}` detail endpoint.

### Issue 4: Amazon Search API Limitations
Similarly, Rainforest's search API returns limited images. The full gallery is only available from the product detail endpoint.

### Issue 5: eBay images limited to 2 in search results
In `ebayAdapter.ts`, the `extractImages` function explicitly limits images to 2:
```typescript
return images.slice(0, 2); // Strictly limit to 2 images for lists
```

This is by design for performance, but the detail fetch isn't working to populate the full gallery.

---

## Solution Plan

### Step 1: Fix ID Parsing in Media Cache
Update `parseProviderKey` to handle both formats:
- `ebay:v1|...` (colon separator)
- `ebay_v1|...` (underscore separator - used in DB)

```typescript
// Handle "ebay_..." format (underscore variant used in catalog_items)
if (compositeId.startsWith("ebay_")) {
  const itemId = compositeId.slice(5); // "v1|123..."
  return { provider: "ebay", itemId };
}
```

### Step 2: Fix Response Extraction in Media Cache
Update `fetchAndCacheMedia` to look in the correct response path:

```typescript
// Current (broken):
if (productData.imageUrls) ...
if (productData.product?.imageUrls) ...

// Fixed - check all possible paths:
if (productData.item?.imageUrls) ...      // Actual structure
if (productData.item?.images) ...          // Backward compat
if (productData.imageUrls) ...             // Fallback
```

### Step 3: Improve eBay Detail Image Extraction
The `extractDetailImages` function in `ebayAdapter.ts` should also check for:
- `item.images[]` array (sometimes present)
- `item.pictureURLs[]` (eBay-specific field in some responses)

### Step 4: Improve Amazon/Rainforest Image Extraction
Ensure all Rainforest image sources are checked:
- `product.images[]`
- `product.image_gallery[]`
- `product.hi_res_images[]`
- `product.variants[].images[]`

The code already does this but we should verify it's working.

### Step 5: Add Detailed Logging
Add logging to trace exactly what's being received from providers:
- Log raw image arrays before processing
- Log after deduplication
- Log final count vs. expected count

---

## Technical Details

### Files to Modify

1. **`supabase/functions/_shared/mediaCache.ts`**
   - Fix `parseProviderKey()` to handle underscore format
   - Fix `fetchAndCacheMedia()` response extraction path
   - Add debug logging for image extraction

2. **`supabase/functions/_shared/ebayAdapter.ts`**
   - Enhance `extractDetailImages()` to check more image fields
   - Add logging for raw image data from eBay API

3. **`supabase/functions/_shared/rainforestAdapter.ts`**
   - Verify `extractImages()` is capturing all sources
   - Add logging for raw image arrays

4. **`supabase/functions/catalog-product/index.ts`**
   - Ensure response includes all images in `imageUrls` array
   - Log image count for debugging

### Database Cleanup
After fixes are deployed, we'll need to clear the incorrectly cached media entries:
```sql
DELETE FROM catalog_item_media WHERE image_count = 1 AND image_urls = '[]'::jsonb;
```

---

## Expected Outcome

After these fixes:
- eBay items with 7 photos on the official site will show `image_count: 7` in list feeds
- Product detail pages will display all 7 photos in the gallery
- Amazon items will similarly show correct photo counts
- The media cache will properly store all image URLs for fast subsequent access

---

## Risk Assessment

**Low Risk**: These are targeted fixes to data extraction logic. No changes to database schema or API contracts.

**Testing Plan**:
1. Deploy fixes
2. Clear stale media cache entries
3. Browse a few eBay/Amazon items and verify image counts
4. Open product detail and verify full gallery displays

