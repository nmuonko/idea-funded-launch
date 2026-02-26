

## Fix: Hero Carousel Image/Text Sync + Premium Colors

### Problem
The carousel has **two separate `AnimatePresence` blocks** — one for the background image (lines 116-134) and one for the text (lines 137-158). They animate independently with different durations and directions, causing the image to appear late relative to the text.

### Solution

#### 1. Merge into a single AnimatePresence block
Combine the image background and the text overlay into one `motion.div` so they animate together as a single unit. This ensures the image and text appear simultaneously.

#### 2. Preload all slide images
Add an `useEffect` that preloads all slide images on mount using `new Image()`. This prevents the delay caused by lazy-loading images when a new slide appears.

#### 3. Premium gradient colors
Upgrade the slide gradients to richer, more luxurious tones:

| Slide | Current | New |
|-------|---------|-----|
| Gaming | indigo-900/purple-900 | violet-950/indigo-900 with deeper opacity |
| Delivery | black/black | slate-950/blue-950 for depth |
| Phones | emerald-900/teal-900 | emerald-950/cyan-900 richer |
| Laptops | slate-900/blue-900 | gray-950/slate-900 sleek |
| Audio | amber-900/orange-900 | amber-950/yellow-900 warm gold |
| Smart Home | rose-900/pink-900 | rose-950/fuchsia-900 elegant |

Also add a subtle inner border glow and refine the CTA button with a slight gradient for a more premium feel.

### Files Changed

| File | Change |
|------|--------|
| `src/components/shop/HeroBannerCarousel.tsx` | Merge AnimatePresence blocks, preload images, premium gradients + CTA styling |

