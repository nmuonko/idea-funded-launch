
## Update Price When Selecting a Product Variant

### Problem
When a user selects a different size (or other variant) on the product detail page, the price stays the same. The variant data already contains a `price` field (`{ value: number; currency: string }`), but the optimistic UI update in `handleVariantSelect` ignores it -- only updating the image and marking `isCurrent`.

### Fix

**File: `src/pages/shop/ProductDetails.tsx`**

In the `handleVariantSelect` function, add the variant's price to the optimistic update:

- Check if `clickedVariant.price?.value` exists
- If so, set `priceUsd` to that value in the returned product state
- This makes the price change instantly when the user clicks a size/color/storage option
- The background fetch (which already updates `priceUsd` on line 468) will confirm or correct the price when it completes

The change is a single line addition inside the `setProduct` updater (around line 425):

```
priceUsd: clickedVariant.price?.value ?? prev.priceUsd,
```

### Result
- Price updates instantly when selecting a variant (size, color, storage)
- If the variant doesn't have a price field, the current price is preserved
- Background fetch still runs and will correct the price if the optimistic value was wrong
