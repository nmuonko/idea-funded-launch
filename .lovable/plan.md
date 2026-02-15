
# Speed Up Product Detail Image Loading

## Problem

When tapping a product, the gallery images load slowly because:
1. The main image (`motion.img`) has no explicit `loading="eager"` or `fetchpriority="high"` -- the browser may deprioritize it
2. No image preloading happens -- the single image from navigation state displays, then the API fetch brings additional gallery images that load from scratch
3. Thumbnail images (up to 6) all load simultaneously without any priority hints

## Solution

Three targeted changes in `src/pages/shop/ProductDetails.tsx`:

### 1. Eager-load the main hero image with high fetch priority

Add `loading="eager"` and `fetchPriority="high"` to the main `motion.img` element so the browser prioritizes it immediately:

```tsx
<motion.img
  key={safeImages[safeImageIndex]}
  src={safeImages[safeImageIndex] || '/placeholder.svg'}
  loading="eager"
  fetchPriority="high"
  ...
/>
```

### 2. Preload gallery images when API data arrives

After the API fetch merges new images into state, use `<link rel="preload">` via a `useEffect` to tell the browser to start downloading the first few gallery images in the background before the user scrolls to thumbnails:

```tsx
useEffect(() => {
  if (!safeImages.length || safeImages[0] === '/placeholder.svg') return;
  // Preload the first 4 images using Image() constructor
  safeImages.slice(0, 4).forEach(src => {
    const img = new Image();
    img.src = src;
  });
}, [safeImages]);
```

### 3. Lazy-load thumbnails beyond the first visible set

Add `loading="lazy"` to thumbnail `<img>` tags so they don't compete with the hero image for bandwidth:

```tsx
<img
  src={img}
  loading="lazy"
  ...
/>
```

## Files Changed

- `src/pages/shop/ProductDetails.tsx` -- 3 small edits (hero image attributes, preload effect, thumbnail lazy loading)

No backend changes needed.
