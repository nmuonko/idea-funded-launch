

## Fix: Product Images Cutoff on Mobile

### Problem
On mobile, product images appear cropped/cutoff in two places:

1. **Product cards** (homepage, category pages): Use `aspect-[4/3]` on mobile, switching to `aspect-square` only at `sm:` breakpoint. The 4:3 ratio cuts off tall product images (like cars, furniture) on small screens.

2. **Product detail hero**: Uses `aspect-[4/3] max-h-[55vh]` which constrains certain image shapes. While `object-contain` prevents true cropping, the combination of aspect ratio + max-height makes images appear small/constrained on mobile until users tap to open the lightbox.

### Solution

#### 1. ProductCard: Use square aspect ratio on all screen sizes
Change the non-compact image container from `aspect-[4/3] sm:aspect-square` to `aspect-square` across all breakpoints. Square containers with `object-contain` show the full product image regardless of orientation.

#### 2. Product detail hero: Better mobile aspect ratio
- Change from `aspect-[4/3] max-h-[55vh]` to `aspect-square sm:aspect-[4/3]` on the hero container
- Increase max-height from `55vh` to `60vh` on mobile for more breathing room
- Keep padding at `p-2` on mobile (currently `p-4`) to maximize image display area

#### 3. ProductCardSkeleton: Match the new aspect ratio
Update the skeleton to also use `aspect-square` consistently so loading states match.

### Files Changed

| File | Change |
|------|--------|
| `src/components/shop/ProductCard.tsx` | Change `aspect-[4/3] sm:aspect-square` to `aspect-square` |
| `src/components/shop/ProductCardSkeleton.tsx` | Match skeleton aspect ratio to `aspect-square` |
| `src/pages/shop/ProductDetails.tsx` | Change hero to `aspect-square sm:aspect-[4/3]`, increase mobile max-height, reduce mobile padding |
