

# Fix: Product Detail Hero Image Not Centering on Mobile

## Problem
On mobile, the main product image on the detail page appears pushed to the right side of the screen, with a large empty/black gap on the left. The image is not properly centered within its container.

## Root Cause
The hero image uses `w-full h-full object-contain p-4` on the `motion.img` element inside an `aspect-[4/3]` container. For certain product images (especially wide/landscape ones from eBay), this combination can cause the image to not center correctly. The `w-full h-full` forces the img element to stretch to the container boundaries, and depending on the image's natural aspect ratio, the visual content rendered by `object-contain` can appear misaligned.

## Fix
Change the image container and image styling to use **flexbox centering** with `max-w/max-h` constraints instead of `w-full h-full object-contain`. This is the same proven pattern used by the `ProductImageViewer` lightbox (which displays images correctly).

### File: `src/pages/shop/ProductDetails.tsx`

**Change 1 -- Hero image container (line 585-601)**

Add `flex items-center justify-center` to the container div, and change the `motion.img` from `w-full h-full object-contain p-4 sm:p-8` to `max-w-full max-h-full object-contain p-4 sm:p-8`. This ensures the image is always centered within the container regardless of its natural dimensions.

```text
Before:
  <div className="relative aspect-[4/3] sm:aspect-square bg-white/5 rounded-2xl overflow-hidden border border-white/10 cursor-pointer">
    <AnimatePresence mode="wait">
      <motion.img
        ...
        className="w-full h-full object-contain p-4 sm:p-8"
      />

After:
  <div className="relative aspect-[4/3] sm:aspect-square bg-white/5 rounded-2xl overflow-hidden border border-white/10 cursor-pointer flex items-center justify-center">
    <AnimatePresence mode="wait">
      <motion.img
        ...
        className="max-w-full max-h-full object-contain p-4 sm:p-8"
      />
```

This is a 2-line CSS class change. No logic changes needed.

## Why This Works
- `flex items-center justify-center` on the container ensures the image is always visually centered
- `max-w-full max-h-full` (instead of `w-full h-full`) lets the image size to its natural dimensions, capped by the container, rather than stretching the element to fill and relying on `object-contain` for visual positioning
- This matches the pattern already used successfully in `ProductImageViewer.tsx` (line 206)

## Files Changed

| File | Change |
|------|--------|
| `src/pages/shop/ProductDetails.tsx` | Add flex centering to hero container, change img to max-w/max-h |

