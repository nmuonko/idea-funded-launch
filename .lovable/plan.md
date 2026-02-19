

# Amazon-Style Homepage Layout Redesign

## What Changes

The homepage will be restructured to match the reference screenshot layout while keeping the dark theme. Here's the section-by-section breakdown:

### 1. Hero Banner Carousel (Full-Width, with Arrows + Dots)
- Replace the current static `DeliveryHeroBanner` with a full-width image carousel
- Add left/right navigation arrows and dot indicators
- Support multiple slides (deals for gamers, delivery promo, etc.)
- Responsive heights: ~300px desktop, ~200px tablet, ~170px mobile
- Slides will have gradient overlay with text + CTA button ("Voir les offres")

### 2. Category Promo Tiles (4-Column Grid Below Banner)
- Keep the existing 4-column `CategoryCard` grid (Telephones, Electronique, Jeux Video, Vehicules)
- Each card shows a 2x2 grid of product thumbnails with titles beneath each thumbnail
- "Voir plus >" link at the bottom of each card
- Already working correctly -- just needs minor spacing tweaks to match reference

### 3. Trending Row ("Tendances") -- Single Horizontal Carousel
- Keep ONE "Tendances" row with horizontal scroll, left/right arrows, and dot indicators
- Remove any duplicate "Tendances" sections (the reference shows TWO -- we will keep only ONE as per prior requirements)
- Product cards: clean white image background, product title, provider badge, price in USD + CDF, cart button

### 4. "Economisez sur les categories" -- Category Icons Row
- NEW section at the bottom: a horizontal row of circular category icons with labels
- Shows categories: Telephones, Electronique, Jeux Video, Vehicules, Cuisine & Salon, Jouets, Montres, etc.
- Each icon is a circular container with a representative image/icon
- "Voir toutes les categories >" link
- Clicking a category navigates to `/category/:key`

### 5. Remove Duplicate Sections
- Ensure only ONE trending row exists (no duplicated "Tendances" block)
- No duplicate category tab bars

### 6. Recently Viewed (Keep as-is, below Trending)

## Technical Details

### Files to Create
- **`src/components/shop/HeroBannerCarousel.tsx`** -- New full-width carousel component with arrows, dots, auto-play, and swipe support. Uses hardcoded slide data (title, subtitle, CTA, background gradient/image) that can later be driven by backend.
- **`src/components/shop/CategoryIconsRow.tsx`** -- New horizontal scrollable row of circular category icons with labels and "Voir toutes les categories" link.

### Files to Modify
- **`src/pages/shop/ShopHome.tsx`**
  - Replace `<DeliveryHeroBanner />` with `<HeroBannerCarousel />`
  - Add `<CategoryIconsRow />` section after the "More Category Grid Cards"
  - Ensure only one trending row renders
  - Adjust spacing between sections to match reference

- **`src/components/shop/CategoryCard.tsx`**
  - Minor tweaks: ensure product title is shown below each thumbnail (already done)
  - Slightly increase card padding and font sizes to match reference density

- **`src/components/shop/HorizontalProductRow.tsx`**
  - Add dot indicators below the carousel (pagination dots showing current scroll position)
  - Ensure arrow buttons are always visible on desktop (not just on hover)

- **`src/components/shop/SectionBlock.tsx`**
  - Add "Voir plus >" link in the header area (right-aligned) for the trending section
  - This links to a general trending/all products page

### Component Structure

```text
ShopHome
  |-- HeroBannerCarousel (NEW - full width with arrows + dots)
  |-- Promo Tiles Grid (4x CategoryCard - existing)
  |-- Tendances Row (SectionBlock mode=scroll - existing, with dots added)
  |-- Recently Viewed (existing)
  |-- More Category Grids (existing)
  |-- CategoryIconsRow (NEW - circular icons with labels)
  |-- End of Feed CTA (existing)
  |-- ShopFooter
```

### Hero Banner Carousel Details
- Uses `useState` for active slide index
- Auto-advances every 5 seconds
- Slides array with: title, subtitle, CTA text, background CSS gradient or image URL
- Left/right `ChevronLeft`/`ChevronRight` buttons
- Dot indicators at bottom center
- Pauses auto-play on hover

### Category Icons Row Details
- Uses the existing `CATEGORY_TITLE_MAP` for labels
- Each category rendered as a circular container (~80px) with a representative icon from `lucide-react` (Smartphone, Monitor, Gamepad2, Car, Sofa, Gift, Watch, etc.)
- Horizontally scrollable on mobile with arrows on desktop
- "Voir toutes les categories >" link navigates to a future all-categories page or scrolls to category grids

