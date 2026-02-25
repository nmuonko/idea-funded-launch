

# Fix: Hero Image Oversized on Initial Load (Some Products)

## Problem
For some products, the hero image appears huge/overflowing on first render. Clicking it (which opens/closes the lightbox) causes it to "snap" to the correct size. This happens because `AnimatePresence` sits between the flex container and the `motion.img`, preventing `max-w-full max-h-full` from resolving against the parent's dimensions.

## Root Cause
The layout chain is: `div (flex + aspect-ratio)` > `AnimatePresence` > `motion.img (max-w-full max-h-full)`. `AnimatePresence` does not forward CSS or act as a proper flex child, so the image's percentage-based max constraints have no concrete parent dimensions to reference. Large images render at their natural pixel size, clipped by `overflow-hidden` but still appearing oversized.

## Fix
Use **absolute positioning** instead of flex for the image. This is more robust because `absolute inset-0` creates an explicit bounding box regardless of intermediate wrappers like `AnimatePresence`.

### File: `src/pages/shop/ProductDetails.tsx`

**Change the container and image classes (lines 586-599):**

```
Before:
  className="relative aspect-[4/3] sm:aspect-square bg-white/5 rounded-2xl overflow-hidden border border-white/10 cursor-pointer flex items-center justify-center"
  ...
  className="max-w-full max-h-full object-contain p-4 sm:p-8"

After:
  className="relative aspect-[4/3] sm:aspect-square bg-white/5 rounded-2xl overflow-hidden border border-white/10 cursor-pointer"
  ...
  className="absolute inset-0 w-full h-full object-contain p-4 sm:p-8"
```

- Remove `flex items-center justify-center` from the container (not needed with absolute positioning)
- Change image to `absolute inset-0 w-full h-full object-contain` -- this forces the image element to exactly match the container bounds, and `object-contain` handles visual centering within that box

## Why This Works
- `absolute inset-0` pins the image to all four edges of the `relative` container, bypassing `AnimatePresence` entirely
- `w-full h-full` fills the absolute-positioned box
- `object-contain` centers the visual content within that box, regardless of aspect ratio
- This pattern works for every image size and aspect ratio, on every screen size

## Files Changed

| File | Change |
|------|--------|
| `src/pages/shop/ProductDetails.tsx` | Switch from flex centering to absolute positioning for hero image |

