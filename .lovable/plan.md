

# Fullscreen Image Viewer with Pinch-to-Zoom

## What Changes

When the user taps on a product image in the gallery, a fullscreen overlay opens showing the image with pinch-to-zoom (mobile) and scroll-to-zoom (desktop) support, plus swipe/arrow navigation between gallery images.

## Approach

Create a new `ProductImageViewer` component that opens as a fullscreen overlay (not a dialog -- for better mobile UX). It will use CSS transforms for zoom and pan, with touch gesture handling built in.

### New File: `src/components/shop/ProductImageViewer.tsx`

A fullscreen image viewer with:
- **Pinch-to-zoom** on mobile (touch events)
- **Scroll-to-zoom** on desktop (wheel events)
- **Pan/drag** when zoomed in
- **Swipe left/right** to navigate images (when not zoomed)
- **Arrow buttons** for desktop navigation
- **Double-tap to zoom** in/out
- **Close button** (X) and tap-outside-image to close
- Image counter indicator (e.g., "2 / 5")
- Black fullscreen background

No external dependencies needed -- all built with React state + touch/pointer events + CSS transforms.

### Modified File: `src/pages/shop/ProductDetails.tsx`

- Add `lightboxOpen` state and `lightboxIndex` state
- Make the main gallery image clickable (add `onClick` + `cursor-pointer`)
- Make thumbnail images clickable to open viewer at that index
- Render `ProductImageViewer` when open, passing `images`, `currentIndex`, and `onClose`

## Technical Details

### Zoom/Pan Implementation

```text
State: scale (1-4), translateX, translateY
- Pinch: track two-finger distance changes, update scale
- Double-tap: toggle between scale=1 and scale=2.5
- Drag/pan: when scale > 1, track pointer movement to update translate
- Wheel: increment/decrement scale by 0.3 per scroll tick
- Reset on image change or close
```

### Touch Gesture Logic

```text
- 1 finger + not zoomed: swipe left/right to change image
- 1 finger + zoomed: pan the image
- 2 fingers: pinch to zoom
- Double tap: toggle zoom
```

### Mobile-First Considerations

- Fullscreen overlay uses `fixed inset-0 z-50` (covers everything including nav)
- `touch-action: none` to prevent browser default zoom/scroll
- Close button is 44x44px minimum tap target
- Safe area padding for notch devices
