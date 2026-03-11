

# Fix: Product Detail Image Background & Pricing Display

## Issues Identified

### 1. Hero Image Not Visible on Dark Background
The product detail hero image container uses `bg-white/5` (line 666) — nearly transparent on the dark theme. Product images with dark/transparent backgrounds (like the iPhone) become invisible. The product **cards** correctly use `bg-white` for their image containers, but the detail page does not.

**Fix**: Change the hero image container background from `bg-white/5` to `bg-white` to match the product card pattern and ensure all product images are visible regardless of their background color.

### 2. Gallery Thumbnail Background Too Dark  
Thumbnails use `bg-white/5` (line 722) — same problem. Should be `bg-white` for consistency.

### 3. Price Values Not Rendering
The PriceBreakdown component receives `itemPriceUsd={displayPrice}` where `displayPrice = product.priceUsd`. When navigating from a product card, the initial nav state carries the price, but if `priceUsd` is `0` (common for products where the API hasn't resolved yet or the nav state was incomplete), all computed fees become `$0.00`, making the breakdown appear empty/blank.

**Fix**: 
- Show a skeleton/loading state in PriceBreakdown when `itemPriceUsd` is `0` and the page is still loading full data
- Ensure the price values don't get clipped on narrow mobile screens by adding `break-words` / `min-w-0` utilities to the price container

## Changes

### File: `src/pages/shop/ProductDetails.tsx`
- **Line 666**: Change hero container `bg-white/5` → `bg-white` for proper image visibility
- **Line 722**: Change thumbnail `bg-white/5` → `bg-white`

### File: `src/components/shop/PriceBreakdown.tsx`
- Add early return with skeleton/placeholder when `itemPriceUsd === 0` and no server total exists — display "Loading..." or dashes instead of `$0.00`
- This prevents the confusing blank-looking state while the full product data is being fetched

