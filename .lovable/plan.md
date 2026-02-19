

# Homepage Improvements

## Changes Overview

### 1. Hero Banner Carousel -- Better Slide Images & Content
- **Gaming slide**: Use a high-quality image URL of premium consoles (PS5, Xbox Series X, Nintendo Switch) instead of the generic `/hero-airplane.jpg`
- **Delivery slide**: Keep as-is (already shows "Livraison 2-4 Semaines")
- **Smartphones slide**: Use a luxury phone image URL (iPhone, Samsung Galaxy flagship) instead of `/hero-airplane.jpg`
- Source images from free stock photo URLs (e.g., Unsplash) showing real premium products

### 2. Category Cards -- No Empty Skeleton Slots
- In `CategoryCard.tsx`, remove the padding logic that fills empty slots with blank placeholders
- If a category has fewer than 4 items, only render the items it has (show 1, 2, or 3) without empty gray squares
- Alternatively, duplicate items from the same category to always fill 4 slots (no cross-category mixing)

### 3. Tendances Section -- Static Grid, Not Scrolling, Moved to Top
- Change "Tendances" from a horizontal scrolling row to a static multi-column grid (e.g., 4-6 columns on desktop, 2-3 on mobile)
- Move it directly below the hero carousel (before the promo tiles)
- Show premium product images in a clean grid layout
- Remove `autoScroll` behavior for this section

### 4. "Economisez sur les categories" -- Real Product Images
- Replace lucide-react icons with actual product thumbnail images from each category's feed data
- Each circular icon container will show a real product image from the corresponding category instead of a generic icon
- Pass category product data down to `CategoryIconsRow`

### 5. Remove "Rechercher des produits" Button
- Delete the entire "End of Feed CTA" section at the bottom of the page (the "Vous ne trouvez pas..." block with the search button)

## Technical Details

### Files to Modify

**`src/components/shop/HeroBannerCarousel.tsx`**
- Update `SLIDES` array: replace `/hero-airplane.jpg` with Unsplash URLs for gaming consoles and luxury smartphones
- Keep the delivery slide image as-is or use a shipping/delivery themed image

**`src/components/shop/CategoryCard.tsx`**
- Change the empty slot logic: when items < 4, repeat items from same category to fill the grid, or render fewer columns -- no empty gray boxes

**`src/pages/shop/ShopHome.tsx`**
- Reorder sections: Hero -> Tendances (static grid) -> Promo Tiles -> Recently Viewed -> More Categories -> Category Icons -> Footer
- Remove the "End of Feed CTA" block (lines 319-340)
- Change Tendances rendering from `mode="scroll"` to a new static grid display

**`src/components/shop/SectionBlock.tsx`**
- Add a new `mode="static-grid"` option that renders products in a responsive grid (not scrolling)
- Grid: 2 cols mobile, 3 cols tablet, 5-6 cols desktop

**`src/components/shop/CategoryIconsRow.tsx`**
- Accept optional `categoryImages` prop mapping category keys to image URLs
- Replace icon components with `<img>` tags showing real product thumbnails inside the circular containers

