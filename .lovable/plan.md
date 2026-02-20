

## Fix Stretched Images in the Trending Grid

### Problem
The Trending Now ("Tendances") grid images use `object-cover`, which zooms into and crops product photos to fill the square container. This makes products like phones and laptops look stretched and unnatural because the image is being clipped and enlarged to fill the space.

### Solution
Switch the `coverImage` mode from `object-cover` to `object-contain` with a clean white/light background. This keeps each image fully visible and properly proportioned inside its square container, with consistent padding so the grid looks uniform and polished -- no stretching, no cropping.

### Changes

**File: `src/components/shop/ProductCard.tsx`**

Update the image className logic for `coverImage` mode:
- Change from `object-cover` to `object-contain` so images maintain their natural proportions
- Add small padding (`p-2`) so images don't touch the container edges
- Keep the white background on the container for a clean, uniform look

The change is just one line in the className conditional:

```
// Before (crops and stretches):
compact && coverImage ? "object-cover"

// After (fits nicely, no stretch):
compact && coverImage ? "object-contain p-2"
```

### Result
- All trending grid images will be fully visible with correct proportions
- Uniform square containers with centered, non-stretched product photos
- Clean, polished appearance similar to major e-commerce product grids
