
# Fix Tendances Grid — Smaller Product Cards

## Problem
The "Tendances" static grid cards are too large, taking up too much vertical space on the page.

## Solution
Two changes in `src/components/shop/SectionBlock.tsx` for the `static-grid` mode:

1. **Increase column count** — Show more items per row so each card is naturally smaller:
   - Current: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`
   - New: `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8`

2. **Use compact ProductCard** — Pass `compact` prop to `ProductCard` so images are shorter and text/padding is tighter:
   - `<ProductCard key={product.id} product={product} compact />`

3. **Reduce gap** — Change `gap-3` to `gap-2` for tighter spacing between cards.

These three small tweaks will make the Tendances grid feel denser and more Amazon-like, with smaller thumbnails and tighter layout.

## File to Modify
- `src/components/shop/SectionBlock.tsx` — lines 48-51 in the `static-grid` block
