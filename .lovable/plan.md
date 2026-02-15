

# Fix Mobile View Cutoff Issues on Cart Page

## Problems Identified

From the screenshots, several elements are being clipped on the right edge on mobile:
1. The "Demander un devis" button text is cut off
2. Order summary text like "Frais de livraison" and "En attente du devis" is truncated
3. The bottom CTA button "Demander un devis" is also cut off on the right

## Root Causes

1. **Cart item row layout** (line 159): Uses `flex gap-4` with checkbox + 96px image + flex-1 details + quantity controls, which is too tight on small screens (320-375px wide)
2. **Container padding**: `px-4` on the main element combined with the grid layout doesn't leave enough breathing room on small screens
3. **Order summary panel**: Fixed padding `p-6` inside the summary card eats into available width

## Changes

### File: `src/pages/shop/ShopCart.tsx`

1. **Reduce mobile padding** on the main container: Change `px-4` to `px-3 sm:px-4` (line 76)
2. **Reduce cart item gap** on mobile: Change `gap-4` to `gap-2 sm:gap-4` on the cart item flex row (line 159)
3. **Reduce cart item padding** on mobile: Change `p-4` to `p-3 sm:p-4` on the cart item card (line 159)
4. **Shrink image on mobile**: Change `w-24 h-24` to `w-20 h-20 sm:w-24 sm:h-24` (line 178)
5. **Reduce order summary padding** on mobile: Change `p-6` to `p-4 sm:p-6` (line 288)
6. **Make vehicle badge text smaller on mobile**: Add `text-xs` to prevent line overflow (line 203-206)
7. **Ensure quote button wraps properly**: Add `whitespace-normal` and reduce horizontal padding on the "Demander un devis" button inside the cart item (lines 210-221)

### File: `src/components/shop/PriceBreakdown.tsx`

8. **Allow "En attente du devis" / "Awaiting quote" text to wrap**: Remove `italic` whitespace constraints and ensure the flex layout uses `min-w-0` and `text-right` so text doesn't overflow (lines 142-149)

## Result

- All prices, labels, and buttons will be fully visible on phones as narrow as 320px
- No content will be cut off on the right edge
- The layout will remain unchanged on tablet and desktop screens
