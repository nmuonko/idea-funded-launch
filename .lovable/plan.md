

## Lighten the Homepage

### Problem
The homepage renders all 13 category sections, 16 trending items, recently viewed, and category icons simultaneously on mount. This causes:
- Heavy initial render (all DOM nodes created at once)
- 13+ API fetch pipelines firing concurrently on load
- A wrapping framer-motion animation on the entire content block adds layout overhead
- Every category card (with images) is in the DOM even if far below the viewport

### Solution

#### 1. Viewport-based lazy rendering for category sections
Create a lightweight `LazySection` wrapper component that uses `IntersectionObserver` to only render its children when it enters (or is near) the viewport. This means below-fold category grids won't render or fetch until the user scrolls close to them.

- Render a placeholder `div` with a min-height matching the expected section size
- When the observer fires (with `rootMargin: "200px"` for pre-loading), swap in the real content
- Once rendered, stay rendered (no unmounting on scroll away)

#### 2. Remove the wrapping motion.div animation
The entire homepage content is wrapped in a `motion.div` with `initial={{ opacity: 0, y: 20 }}`. This forces framer-motion to manage layout for dozens of child elements. Replace it with a simple `div` — the hero carousel already has its own entrance animation.

#### 3. Stagger category fetches based on viewport priority
Instead of fetching all 13 categories at once with a concurrency limit of 4, split into two waves:
- **Wave 1 (immediate)**: Trending feed + first 4 promo categories (above the fold)
- **Wave 2 (deferred)**: Remaining 9 categories, triggered after wave 1 completes or after a short delay

#### 4. Add `content-visibility: auto` CSS optimization
Apply `content-visibility: auto` with `contain-intrinsic-size` to each category section wrapper. This tells the browser to skip rendering off-screen sections entirely, dramatically reducing paint and layout costs.

### Files Changed

| File | Change |
|------|--------|
| `src/components/shop/LazySection.tsx` | **New** — IntersectionObserver-based lazy render wrapper |
| `src/pages/shop/ShopHome.tsx` | Remove motion.div wrapper, wrap below-fold sections in LazySection, split fetch into two waves |
| `src/components/shop/CategoryCard.tsx` | Add `content-visibility: auto` style to the card container |

### Technical Details

**LazySection component** (new):
```tsx
function LazySection({ children, minHeight = 200 }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  
  return <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }}>{visible ? children : null}</div>;
}
```

**Fetch wave split**: The `fetchAllCategoryItems` function will be split so that the first 4 (PROMO_CATEGORIES) fetch immediately, and the remaining 9 are deferred by ~500ms or until the user scrolls.

**motion.div removal**: Line 888's `motion.div` with opacity/y animation will become a plain `div` with `className="space-y-6"`.

