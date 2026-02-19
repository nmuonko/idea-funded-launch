

# Make Product Cards More Compact on Mobile

## Problem
On mobile (2-column grid), product cards are too large -- the square image + padded content area makes each card tall, so users see fewer products per screen.

## Changes

### 1. Reduce grid gap on mobile
- **ProductGrid.tsx**: Change `gap-4` to `gap-2 sm:gap-4`
- **VerticalProductGrid.tsx**: Change `gap-3 md:gap-4` to `gap-2 md:gap-4`

### 2. Make image area shorter on mobile
- **ProductCard.tsx**: On mobile (non-compact), switch from `aspect-square` to `aspect-[4/3]` so images take less vertical space. Compact cards already use smaller padding, but reduce image padding from `p-2` to `p-1.5`.

### 3. Tighten card content padding on mobile
- **ProductCard.tsx**: Reduce non-compact content padding from `p-4` to `p-2.5 sm:p-4`, and compact from `p-2` to `p-1.5 sm:p-2`
- Reduce title font size on mobile: non-compact from `text-sm` to `text-xs sm:text-sm`
- Reduce price font size: non-compact from `text-lg` to `text-base sm:text-lg`

### 4. Smaller card border radius on mobile
- Change `rounded-2xl` to `rounded-xl sm:rounded-2xl` for tighter fit on small screens

### 5. Pass `compact` prop on mobile for homepage grid
- **ShopHome.tsx**: The `VerticalProductGrid` already passes `compact` to cards, so this is handled. For `ProductGrid` used in search results and similar products, no change needed since those are secondary views.

## Files Modified
| File | Change |
|------|--------|
| `ProductCard.tsx` | Smaller image aspect ratio, tighter padding, smaller fonts on mobile |
| `ProductGrid.tsx` | Smaller gap on mobile |
| `VerticalProductGrid.tsx` | Smaller gap on mobile |
| `ProductCardSkeleton.tsx` | Match reduced padding/radius |
| `ProductGrid.tsx` (skeleton) | Match reduced padding/radius |

