

## Add More Premium Slides to the Hero Carousel

### What Changes

Keep the existing 3 slides (Gaming, Delivery, Smartphones) and add 3 new premium slides using high-quality Unsplash images, bringing the total to 6 slides.

### New Slides

| # | Theme | Image Source | Gradient | CTA Link |
|---|-------|-------------|----------|----------|
| 4 | **Laptops & Computers** | Unsplash: sleek MacBook on desk | Slate/blue tones | `/category/computers` |
| 5 | **Audio & Headphones** | Unsplash: premium headphones studio shot | Amber/orange tones | `/category/audio` |
| 6 | **Smart Home & Accessories** | Unsplash: smart home devices | Rose/pink tones | `/category/accessories` |

All images are free under the Unsplash License and loaded via URL (1600px wide, optimized for web).

### Technical Details

**File: `src/components/shop/HeroBannerCarousel.tsx`**

- Add 3 new entries to the `SLIDES` array after the existing 3
- Each new slide uses an Unsplash URL in the `image` field (no local file imports needed)
- Add `loading="eager"` to the first slide image and `loading="lazy"` to the rest for performance
- The dot indicators, 30s auto-scroll, and all existing behavior remain unchanged -- they automatically adapt to the new slide count

No other files are touched. Existing slides are untouched.

