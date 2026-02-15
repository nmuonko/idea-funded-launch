
# Fix: Slow Image Loading on Product Page

## Root Cause

The backend (`catalog-product/index.ts`) upgrades ALL image URLs to `_SL1500` (1500px) resolution via `upgradeGalleryImages()`. The frontend then:
1. Preloads **4 of these 1500px images** at once via `new Image()` (lines 127-133)
2. Renders 64x64px thumbnails using the same 1500px URLs (lines 601-606)
3. Shows the hero image at 1500px even though the container is ~400-600px wide

A single `_SL1500` Amazon image is typically 200-500KB. Loading 4-5 of them simultaneously (hero + 4 preloads) means 1-2.5MB hitting the network at once, causing visible delay especially on mobile.

## Solution: Multi-Resolution Image Strategy (Frontend Only)

Add a lightweight URL rewriter on the frontend that downsizes image URLs based on display context. No backend changes needed.

### New File: `src/lib/imageResize.ts`

A small utility (~30 lines) with two functions:
- `resizeImageUrl(url, targetSize)` -- rewrites `_SL1500` to the target size (e.g., `_SL800`, `_SL300`)
- Constants: `IMAGE_SIZE_HERO = 800`, `IMAGE_SIZE_THUMB = 300`, `IMAGE_SIZE_FULL = 1500`

Works for both Amazon (`_SL###`) and eBay (`s-l###`) URL patterns.

### Changes to `src/pages/shop/ProductDetails.tsx`

1. **Hero image** (line 552): Rewrite URL to `_SL800` (800px is plenty for a ~500px container at 2x). This cuts the main image payload by ~60%.

2. **Thumbnail strip** (line 601): Rewrite URLs to `_SL300` (300px for a 64px display at 2x). This cuts each thumbnail from ~300KB to ~15KB.

3. **Preloading** (lines 127-133): Reduce from 4 images to just the **first image** at `_SL800`. The rest load lazily as the user scrolls thumbnails.

4. **Lightbox** (line 785-790): Pass the original `_SL1500` URLs to `ProductImageViewer` -- fullscreen is the only place that needs max resolution.

### Changes to `src/components/shop/ProductImageViewer.tsx`

No changes needed -- it already receives the full `safeImages` array which will remain at `_SL1500`.

## Expected Impact

| Context | Before | After |
|---------|--------|-------|
| Hero image | ~300KB (_SL1500) | ~120KB (_SL800) |
| Each thumbnail | ~300KB (_SL1500) | ~15KB (_SL300) |
| Preload budget | 4 x 300KB = 1.2MB | 1 x 120KB = 120KB |
| Initial page load | ~1.5MB images | ~250KB images |
| Lightbox (on tap) | Already loaded | 300KB per image (on demand) |

## Files Changed

- `src/lib/imageResize.ts` -- NEW: URL rewriting utility
- `src/pages/shop/ProductDetails.tsx` -- use resized URLs for hero + thumbnails, reduce preloading
