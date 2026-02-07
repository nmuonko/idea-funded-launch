

# Mobile Responsiveness Improvements

## Current State

The app is already partially mobile-ready: 2-column grids, a bottom navigation bar, lazy-loaded images, and a sticky header. However, several issues need fixing for a polished mobile experience.

## Changes Overview

### 1. Viewport Meta Update
**File: `index.html`**

Add `viewport-fit=cover` to the existing viewport meta tag for proper iOS safe area handling.

### 2. Container Padding on Mobile
**File: `tailwind.config.ts`**

The Tailwind container has `padding: '2rem'` globally -- this is too much on small screens. Change to responsive padding:
```
padding: {
  DEFAULT: '1rem',
  sm: '1.5rem',
  lg: '2rem',
}
```

### 3. Global Overflow Prevention
**File: `src/index.css`**

Add a base rule to prevent horizontal scrolling:
```css
html, body {
  overflow-x: hidden;
  -webkit-text-size-adjust: 100%;
}
```

### 4. Header Mobile Optimization
**File: `src/components/shop/ShopHeader.tsx`**

- Reduce header padding on mobile: `py-2` instead of `py-3` on small screens
- Make search bar height `h-10` on mobile (already `h-11`, close enough but tighten)
- Ensure all tap targets are at least 44px (the buttons are `p-2` with icons -- increase to `min-h-[44px] min-w-[44px]`)
- Hide the language globe icon text on very small screens (already partially done with `hidden sm:block`)

### 5. Category Tabs Mobile Polish
**File: `src/components/shop/CategoryTabs.tsx`**

- Add `min-h-[44px]` to each tab button for proper tap targets
- Add `snap-x snap-mandatory` scroll snapping to the container
- Add `snap-start` to each tab button
- The scrollbar is already hidden (`className="invisible"` on ScrollBar)

### 6. Product Card Mobile Improvements
**File: `src/components/shop/ProductCard.tsx`**

- Ensure the add-to-cart button has `min-h-[44px] min-w-[44px]` in non-compact mode
- The compact mode button (`h-7 w-7`) is 28px which is small -- increase to `h-9 w-9` (36px, acceptable since the whole card is tappable)
- The save (heart) button is `p-1.5` -- increase to `min-h-[36px] min-w-[36px]` for easier tapping

### 7. Product Grid -- No Changes Needed
**Files: `VerticalProductGrid.tsx` and `ProductGrid.tsx`**

Both already use `grid-cols-2` for mobile, `sm:grid-cols-3`, `md:grid-cols-4`, etc. This matches the requirement. No changes needed.

### 8. Search Results Page Mobile Fixes
**File: `src/pages/shop/SearchResults.tsx`**

- The sort dropdown (`w-[160px]`) and filter button side by side can overflow on small screens. Wrap in a responsive layout: stack vertically on mobile or hide sort label.
- Make "Load More" button `w-full` on mobile: add `w-full sm:w-auto`
- The sticky category tabs section has `pt-20` which creates a large gap -- adjust to `pt-16` on mobile since header is shorter
- Results header: make title text smaller on mobile (`text-lg` instead of `text-xl`)

### 9. ShopHome Page Mobile Tweaks
**File: `src/pages/shop/ShopHome.tsx`**

- The header spacer is `pt-20` -- reduce to `pt-16` on mobile to match the shorter header
- "Load More" button: add `w-full sm:w-auto` for full-width on mobile
- The end-of-feed CTA buttons: already `flex-col sm:flex-row` -- good

### 10. Bottom Navigation iOS Safe Area
**File: `src/components/shop/BottomNavigation.tsx`**

- Add `pb-[env(safe-area-inset-bottom)]` to the nav for proper iPhone notch handling (currently uses a separate div which may not work reliably)
- Ensure nav height accounts for safe area

### 11. Delivery Hero Banner
**File: `src/components/shop/DeliveryHeroBanner.tsx`**

- Already responsive (`h-40 md:h-60`, text sizes scale). No changes needed.

## Summary of Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Add `viewport-fit=cover` |
| `tailwind.config.ts` | Responsive container padding |
| `src/index.css` | `overflow-x: hidden`, text-size-adjust |
| `src/components/shop/ShopHeader.tsx` | Tighter mobile padding, 44px tap targets |
| `src/components/shop/CategoryTabs.tsx` | Scroll snap, 44px tap targets |
| `src/components/shop/ProductCard.tsx` | Larger tap targets for buttons |
| `src/pages/shop/SearchResults.tsx` | Full-width load more, responsive sort/filter, smaller header gap |
| `src/pages/shop/ShopHome.tsx` | Tighter header spacer, full-width load more |
| `src/components/shop/BottomNavigation.tsx` | Better iOS safe area handling |

## What This Does NOT Change

- No backend changes
- No changes to admin panel
- Product grid columns already correct (2 on mobile)
- Skeleton loaders already in place
- Lazy loading already on images (`loading="lazy"`)

