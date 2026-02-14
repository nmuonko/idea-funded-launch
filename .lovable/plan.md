

# Fix: Variant Selection Shows Wrong Image During Loading

## Problem

When clicking a color variant, three visual glitches happen in sequence:
1. The OLD product's image shows immediately (wrong color)
2. The image disappears or flickers during the fetch
3. The correct image finally appears after 100ms-7s (depending on cache)

## Root Cause

In `handleVariantSelect` (line 349-355), the navigation state passes the entire current product including its images:
```
state: { product: { ...product, id: asin } }
```
This means the new ASIN page renders with the OLD color's images until the API fetch completes and overwrites them.

## Fix

### File: `src/pages/shop/ProductDetails.tsx`

**Change 1: Pass variant-specific image in nav state**

Update `handleVariantSelect` to find the selected variant's image from the variants data and use it as the initial image, instead of carrying over all old images:

```typescript
const handleVariantSelect = useCallback((asin: string | undefined) => {
  if (!asin || asin === product?.id) return;
  const displayProv = product?.provider?.toLowerCase() === 'rainforest' 
    ? 'amazon' : (product?.provider || 'amazon');
  
  // Find the variant's own image
  const variant = product?.variants?.find(v => v.asin === asin);
  const variantImage = variant?.image;
  
  navigate(`/product/${displayProv}/${asin}`, {
    state: { 
      product: product ? { 
        ...product, 
        id: asin,
        // Use variant image if available, otherwise keep first image as fallback
        imageUrl: variantImage || product.images?.[0],
        images: undefined, // Clear old images so they don't flash
      } : undefined 
    },
  });
}, [product, navigate]);
```

**Change 2: Handle the cleared images in the route reset effect**

In the `useEffect` at line 144, the nav product construction already handles single `imageUrl`:
```typescript
images: nav.imageUrl ? [nav.imageUrl] : ['/placeholder.svg'],
```
This already works correctly -- when `images` is cleared and `imageUrl` is set to the variant image, the page will show just the variant's correct image immediately.

**Change 3: Use AnimatePresence key on the image URL (not just index)**

The current `motion.img` at line 428 uses `key={safeImageIndex}` which doesn't change when images swap (index stays 0). Update to key on the actual image URL for proper crossfade:

```typescript
<motion.img
  key={safeImages[safeImageIndex]}  // Key on URL, not index
  src={safeImages[safeImageIndex] || '/placeholder.svg'}
  ...
/>
```

This ensures a smooth crossfade when the image URL changes (variant image to full-res image), rather than an instant swap.

## Expected Behavior After Fix

| Step | Before | After |
|------|--------|-------|
| Click blue variant | Shows old red image | Shows blue variant thumbnail immediately |
| During fetch | Image disappears/flickers | Blue thumbnail stays stable |
| Fetch completes | Correct blue image appears suddenly | Smooth crossfade to full-res blue image |

## Files Modified

- `src/pages/shop/ProductDetails.tsx` -- 3 small changes (variant nav state, animation key)

