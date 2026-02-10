

# Fix Image Arrow Navigation vs Fullscreen View

## Problem
On the product details page, clicking the left/right arrow buttons to navigate between images also opens the fullscreen image viewer. This happens because the arrows are nested inside a parent `div` that has an `onClick` handler to open the lightbox. The click event bubbles up from the arrow to the parent container.

## Solution
Add `e.stopPropagation()` to both arrow button click handlers so clicking them only navigates images without triggering the fullscreen view. Users can still open fullscreen by clicking directly on the image itself.

## Technical Details

**File**: `src/pages/shop/ProductDetails.tsx` (lines 345-356)

Change the arrow `onClick` handlers from:
- `onClick={prevImage}` to `onClick={(e) => { e.stopPropagation(); prevImage(); }}`
- `onClick={nextImage}` to `onClick={(e) => { e.stopPropagation(); nextImage(); }}`

This is a two-line change. No other files need modification.

