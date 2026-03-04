

## Suggested Improvements for Image/Content Filtering

The current implementation covers the major layers (ingestion, serving, frontend) well. Here are remaining gaps and improvements:

### Backend Improvements

1. **Sync blocked patterns between frontend and backend validators**
   - `src/lib/imageValidation.ts` has tokens the backend `supabase/functions/_shared/imageValidator.ts` lacks (e.g., `promo_badge`, `promo-badge`, `promotion-badge`, `shop_logo`, `shop-logo`, `store_logo`, `store-logo`, `brand_logo`, `brand-logo`, `no-image-placeholder`, `/v4/p/ccc/`, `images3_pi/2024/01/01/00/`, `site-cars/merchandising`, `_thumbnail_126x`, `.html` check, `http` prefix check)
   - Backend is missing the `promotion + badge/banner` combo check
   - Backend is missing the `.html` extension block
   - **Action**: Add all missing patterns from frontend to `imageValidator.ts`

2. **Run a broader DB purge**
   - The original SQL purge only targeted obvious keywords. Run a more comprehensive pass using the full blocked-token list, including eBay non-standard paths
   - Also null out URLs ending in `.html`
   - **Action**: Execute an expanded UPDATE statement

3. **Add `catalog-product` single-item endpoint filtering**
   - `supabase/functions/catalog-product/index.ts` has its own `isLikelyRealImage` function that's now outdated relative to the shared `imageValidator.ts`
   - **Action**: Replace `isLikelyRealImage` with `isValidProductImageUrl` from the shared module

### Frontend Improvements

4. **Remove duplicate validation in `ProductCard.tsx`**
   - `ProductCard` has its own `isLikelyPromotionalImageUrl` with `PROMO_IMAGE_TOKENS` (lines 30-49) that duplicates `isRenderableImageUrl` from `src/lib/imageValidation.ts`
   - **Action**: Replace `isLikelyPromotionalImageUrl` in `ProductCard` with `isRenderableImageUrl` from the shared module to keep one source of truth

5. **Tighten `isValidProduct` to also check `isRenderableImageUrl`**
   - Currently `isValidProduct` (line 247) only checks `p.imageUrl` is truthy — an invalid URL that somehow got through mapping would still pass
   - **Action**: Change to `const isValidProduct = (p: Product) => p.id && p.priceUsd > 0 && p.imageUrl && isRenderableImageUrl(p.imageUrl);`

6. **Show placeholder instead of hiding in category grids**
   - Per the user's preference, products with no valid image should show a placeholder rather than being hidden. Currently `isValidProduct` filters them out entirely (including in category grids)
   - **Action**: In category grid paths, remove the `imageUrl` requirement from the filter and let `ProductCard`'s existing "No image" placeholder render

### Files to Modify
- `supabase/functions/_shared/imageValidator.ts` — sync all missing patterns from frontend
- `supabase/functions/catalog-product/index.ts` — replace `isLikelyRealImage` with shared validator
- `src/components/shop/ProductCard.tsx` — replace `isLikelyPromotionalImageUrl` with shared `isRenderableImageUrl`
- `src/pages/shop/ShopHome.tsx` — strengthen `isValidProduct`, adjust placeholder behavior
- Database: run expanded purge SQL

