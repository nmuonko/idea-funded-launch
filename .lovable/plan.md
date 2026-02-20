

## Make Search Results Grid Match Homepage Size

The search results currently display products in a larger grid (2 columns on mobile, up to 5 on xl-desktop) using full-size ProductCards. The homepage trending section uses a denser grid (4 columns on mobile, up to 8 on desktop) with compact ProductCards. The fix is to update the `ProductGrid` component and the `SearchResults` page to use the compact layout.

---

### Changes

**File: `src/components/shop/ProductGrid.tsx`**

Update the grid column classes and pass `compact` to each ProductCard:

- Change grid from `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4` to `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2` (matching the homepage density)
- Pass `compact` prop to each `MemoizedProductCard`
- Update the skeleton grid to match the same column layout

**File: `src/components/shop/ProductCardSkeleton.tsx`**

- Default `compact` to `true` so the skeleton cards are sized to match the smaller grid

**File: `src/pages/shop/SearchResults.tsx`**

- Increase `skeletonCount` from 12 to 16 since the grid now fits more items per row

### Result

- Search result cards will be the same compact size as the homepage product cards
- Grid density matches the homepage (more products visible per screen)
- Skeletons match the new smaller card size
