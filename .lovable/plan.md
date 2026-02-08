

# Fix: Smooth Image Gallery Loading on Product Detail Page

## Problem

When you click a product from search results:
1. The page loads instantly with 1 image (from router state) -- good
2. A few seconds later, the background API returns full gallery (5-10 images)
3. The entire product state is **replaced**, causing the image to flicker/reload and thumbnails to suddenly appear

## Solution

When the background API response arrives, **merge** the new data into the existing product state instead of replacing it. Specifically:
- Keep the current main image in position 0 (no flicker)
- Append additional gallery images after it
- Only update fields that are missing (description, brand, reviewCount, etc.)
- Do NOT reset `currentImageIndex` (user may have already scrolled)

### File: `src/pages/shop/ProductDetails.tsx`

**Change the `setProduct` call (lines 123-135)** to merge with existing state instead of replacing:

```typescript
setProduct(prev => {
  const newImages = item.images || item.imageUrls || (item.image_url ? [item.image_url] : []);
  
  // If we already have images from nav state, merge: keep existing first, add new unique ones
  let mergedImages = newImages;
  if (prev?.images?.length) {
    const existingSet = new Set(prev.images);
    const additional = newImages.filter((img: string) => !existingSet.has(img));
    mergedImages = [...prev.images, ...additional];
  }
  if (mergedImages.length === 0) mergedImages = ['/placeholder.svg'];

  return {
    id: item.provider_product_id || item.id || prev?.id || '',
    provider: item.provider || provider || prev?.provider || '',
    title: item.title || prev?.title || 'Product',
    description: item.description || prev?.description,
    images: mergedImages,
    priceUsd: item.price_usd || item.priceUsd || prev?.priceUsd || 0,
    rating: item.rating ?? prev?.rating,
    reviewCount: item.review_count || item.reviewCount || prev?.reviewCount,
    inStock: item.in_stock !== false,
    productUrl: item.product_url || item.productUrl || prev?.productUrl,
    brand: item.brand || prev?.brand,
  };
});
```

This single change ensures:
- Main image never flickers (it stays in position 0)
- Thumbnail strip appears smoothly as new images arrive
- No `currentImageIndex` reset
- Description, brand, and other enriched data fill in seamlessly

## Files Modified

| File | Change |
|------|--------|
| `src/pages/shop/ProductDetails.tsx` | Change `setProduct({...})` to `setProduct(prev => {...})` with image merging logic |

