

## Comprehensive Performance, Optimization & Styling Improvements

### 1. Route-Level Code Splitting

**File: `src/App.tsx`**

Replace all static admin page imports (lines 34-66) with `React.lazy()` dynamic imports. Keep shop pages eagerly loaded since they're the primary user flow.

- Wrap admin routes with `<Suspense fallback={<LoadingSpinner />}>` 
- Lazy-load ~30 admin pages (Dashboard, Orders, Analytics, Users, etc.)
- Also lazy-load secondary pages: Cars, KnowledgeBase, About, Coverage, Privacy, Terms, etc.
- Keep critical shop pages (ShopHome, ProductDetails, SearchResults, Cart, Checkout) eagerly loaded

This reduces the initial JS bundle significantly since most users never visit admin pages.

### 2. Optimize Product Grid Thumbnail Images

**File: `src/components/shop/ProductCard.tsx`**

Import and use the existing `resizeImageUrl` helper to load 300px thumbnails instead of full 1500px images:

```
import { resizeImageUrl, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
```

Change the `<img src>` from `product.imageUrl` to `resizeImageUrl(product.imageUrl, IMAGE_SIZE_THUMB)`.

This cuts image payload from ~300KB to ~15KB per card (the infrastructure already exists but isn't used in ProductCard).

### 3. Optimize Font Loading

**File: `index.html`**

Add preconnect and preload hints in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
```

**File: `src/index.css`**

Update the `@import` declarations (lines 1-3) to add `&display=swap` (already present on Inter, needs adding to Lora and Space Mono if missing). The `@import` blocks are render-blocking; adding preconnect in `index.html` helps the browser start the font download earlier.

**File: `index.html`** -- also update CSP `font-src` to include `https://fonts.gstatic.com` (currently only `'self' data:` -- fonts load because of the CSS import, but explicitly allowing the domain is cleaner).

### 4. Fix Mobile Touch Target for Save Button

**File: `src/components/shop/ProductCard.tsx`**

Update the save/heart button (line 142-154) minimum size to 44px for accessibility:

- Change `compact ? "min-h-[28px] min-w-[28px]"` to `compact ? "min-h-[44px] min-w-[44px]"` 
- Keep the icon size small (`h-3.5 w-3.5`) so only the tap area grows, not the visual weight

### 5. Summary of Files Changed

| File | Change |
|---|---|
| `src/App.tsx` | Lazy-load ~30 admin + secondary pages |
| `src/components/shop/ProductCard.tsx` | Use `resizeImageUrl` for 300px thumbnails; increase heart button touch target to 44px |
| `index.html` | Add font preconnect hints; update CSP font-src |
| `src/index.css` | Ensure `display=swap` on all font imports |

### Expected Impact

- **Initial bundle size**: ~40-50% smaller (admin code deferred)
- **Image bandwidth**: ~95% reduction per product card (300KB to 15KB each)
- **Font loading**: Faster first contentful paint with preconnect
- **Mobile UX**: Heart button meets 44px touch target standard

