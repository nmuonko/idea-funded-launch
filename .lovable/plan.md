

## Fix Carousel Images and Adjust Auto-Scroll Speed

### Changes (all in one file)

**File: `src/components/shop/HeroBannerCarousel.tsx`**

1. **Laptops slide -- replace image** with two better Unsplash photos showing actual laptops:
   - Use `https://images.unsplash.com/photo-1517336714460-d13f82280306` replaced with a clear MacBook Pro image: `https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=1600&q=80&auto=format&fit=crop` (MacBook Pro on desk, sharp and premium)
   - Update subtitle to mention "MacBook Pro, Microsoft Surface" instead of "Dell, HP"

2. **Audio slide -- replace image** with a Bose headphones photo:
   - Replace current image with `https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=1600&q=80&auto=format&fit=crop` (premium over-ear headphones, studio shot)
   - Update subtitle to emphasize Bose: "Bose, Sony, AirPods"

3. **Auto-scroll timer -- decrease to 10 seconds**:
   - Change `setInterval(next, 30000)` to `setInterval(next, 10000)`

### No other files touched.

