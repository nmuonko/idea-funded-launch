

## Fix Trending Grid Images to Look Clean and Uniform

### Problem
The "Tendances" (Trending Now) grid images look uneven and stretched because they use `object-contain` inside square containers. This preserves original image proportions but leaves empty whitespace around non-square images, making the grid look inconsistent.

### Solution
Use `object-cover` instead of `object-contain` for product cards when displayed in the trending grid. This crops images to fill the square container uniformly, creating a clean, polished look (similar to how Amazon and eBay display grid thumbnails).

Since `object-cover` should only apply to the trending grid (not all product cards), we'll add a new prop `coverImage` to `ProductCard` and pass it from the `SectionBlock` static-grid mode.

### Changes

**File: `src/components/shop/ProductCard.tsx`**

1. Add an optional `coverImage` prop to `ProductCardProps`
2. When `coverImage` is true, use `object-cover` instead of `object-contain` and remove `mix-blend-multiply` (cover-cropped images on white backgrounds don't need blend mode)
3. Remove the inner padding (`p-3`) when using cover mode so the image fills edge-to-edge

**File: `src/components/shop/SectionBlock.tsx`**

1. Pass `coverImage` to `ProductCard` when rendering in `static-grid` mode (the Tendances grid)

### Result
- Trending grid: All 16 images fill their square containers uniformly with no whitespace gaps
- Category grids and other cards: Unchanged (still use `object-contain` with padding)
- The grid will look cohesive and professional like Amazon/eBay trending sections

### Technical Detail

```
// ProductCard.tsx - image className changes
compact && coverImage
  ? "w-full h-full object-cover"                          // fills container, crops excess
  : "w-full h-full object-contain mix-blend-multiply p-3" // current behavior
```
