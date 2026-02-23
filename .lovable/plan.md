

# Fix Mobile Web Responsiveness -- Product Detail Page

## Problem

When opening AfriShop on a mobile browser (Safari/Chrome on iPhone), the product detail page overflows horizontally, causing:
- Text cut off on the right (title, prices, description)
- User must pinch-to-zoom to see the full content
- "Add to Cart" button extends beyond viewport
- Prices like "$24999.00" and "$2499.90" are clipped

This happens because content overflows the viewport width with no containment, and long text (titles, descriptions, prices) has no word-wrapping or overflow protection.

## Root Causes

1. **No horizontal overflow containment** on the page wrapper -- long titles or descriptions push content wider than the viewport.
2. **Product title** (`h1`) has no `break-words` or `overflow-wrap` -- long product names like "2018 GMC Yukon Denali Sport Utility 4D" overflow.
3. **PriceBreakdown** prices can overflow when values are large (e.g. "$24999.00") -- the price `span` needs `flex-shrink-0` and the label side needs `min-w-0` to allow proper flex wrapping.
4. **Description** uses `whitespace-pre-line` which can cause overflow with long unbroken strings (URLs, VINs, etc.).
5. **Support chat bubble** (visible at bottom-right in screenshots) overlaps content.

## Fixes

### 1. ProductDetails.tsx -- Add overflow containment and word-breaking

**File:** `src/pages/shop/ProductDetails.tsx`

- Line 547: Add `overflow-x-hidden` to the root `div` to prevent any horizontal scroll on the entire page.
- Line 639: Add `break-words` class to the product title `h1` so long titles wrap properly instead of overflowing.
- Line 786: Change `whitespace-pre-line` to `whitespace-pre-line break-words` on the description paragraph so long text wraps.

### 2. PriceBreakdown.tsx -- Prevent price value clipping

**File:** `src/components/shop/PriceBreakdown.tsx`

For every price row that uses `flex justify-between`:
- Add `min-w-0` to the label span (left side) so it can shrink.
- Add `flex-shrink-0` to the price span (right side) so the price value is never clipped.

This affects lines: 65-70, 72-85, 103-108, 153-166, 168-181, and the total rows.

### 3. Global CSS -- Safety net for mobile

**File:** `src/index.css`

Add a global rule to prevent horizontal overflow on the html/body level:

```css
html, body {
  overflow-x: hidden;
  width: 100%;
}
```

This prevents any rogue element from causing horizontal scroll on mobile browsers.

## Summary of Changes

| File | Change | Why |
|------|--------|-----|
| `src/pages/shop/ProductDetails.tsx` | Add `overflow-x-hidden` to root div | Prevent horizontal scroll |
| `src/pages/shop/ProductDetails.tsx` | Add `break-words` to title h1 | Wrap long product names |
| `src/pages/shop/ProductDetails.tsx` | Add `break-words` to description | Wrap long descriptions with URLs/VINs |
| `src/components/shop/PriceBreakdown.tsx` | Add `min-w-0` on labels, `flex-shrink-0` on prices | Prevent price clipping |
| `src/index.css` | Add `overflow-x: hidden` on html/body | Global safety net for mobile |

