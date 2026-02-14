

# Fix: Variants Disappear During Variant Selection

## Problem

When clicking a color/size variant, the variant selectors disappear for ~5 seconds, then reappear. This is because the route reset effect reconstructs the product from navigation state but **drops the `variants` field**.

## Root Cause

The flow when clicking a variant:

1. `handleVariantSelect` passes `{ ...product, id: asin, images: undefined }` in nav state -- this INCLUDES `variants`
2. Route changes, triggering the reset `useEffect` (line 144)
3. The reset effect constructs `navProduct` from nav state at lines 147-159, but this object **does not include `variants`**
4. `setProduct(navProduct)` is called -- product now has no variants
5. Variant selectors vanish (they depend on `product.variants`)
6. The API fetch runs, takes ~5s, returns with variants, and they reappear

## Fix

### File: `src/pages/shop/ProductDetails.tsx`

**One change**: Add `variants` to the `navProduct` construction in the reset effect (line 147-159):

```typescript
const navProduct: ProductData | null = nav ? {
  id: nav.id,
  provider: normalizedProvider || 'amazon',
  title: nav.title || 'Product',
  description: undefined,
  images: nav.imageUrl ? [nav.imageUrl] : ['/placeholder.svg'],
  priceUsd: nav.priceUsd || 0,
  rating: nav.rating,
  reviewCount: undefined,
  inStock: true,
  productUrl: nav.productUrl,
  brand: undefined,
  variants: nav.variants,  // <-- ADD THIS LINE
} : null;
```

This preserves the variants from the previous product during variant selection, so selectors stay visible immediately. When the API fetch completes, it updates variants with the new ASIN's data (which may differ if the new variant has different options).

## eBay Variants

eBay products still won't show variants because the backend `catalog-product` function does not extract variation data from eBay API responses. This is a backend issue requiring a separate change to the eBay adapter -- it was deferred in the previous plan as a larger effort. The current fix only addresses the disappearing variants on Amazon products.

## Expected Behavior After Fix

| Step | Before | After |
|------|--------|-------|
| Click color variant | Variants disappear for ~5s | Variants stay visible immediately |
| During fetch | No selectors shown | Previous selectors shown (correct color highlighted after fetch) |
| Fetch completes | Variants reappear | Variants update smoothly if options differ |

## Files Modified

- `src/pages/shop/ProductDetails.tsx` -- add one line (`variants: nav.variants`) to the nav product construction
