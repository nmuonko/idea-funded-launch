

# Fix Vehicle Detection and Shipping Visibility

## Problems Found

### Problem 1: Shipping fee shows on vehicle product pages
The `ProductDetails` page only detects vehicles from `location.state` data passed during navigation. If the state doesn't include `isVehicle: true`, the product shows normal pricing with shipping visible. Additionally, PriceBreakdown checks `vehicleQuoteStatus` which is a cart-level status -- it's `'none'` when just browsing a product page (not yet in cart), so the "awaiting quote" logic never triggers.

### Problem 2: Cheap vehicles ($3,900) don't trigger quote requirement
The vehicle detection in `shippingCategory.ts` requires BOTH `confidence >= 0.7` AND `bestScore >= 3.0` for eBay items to require a quote. A $3,900 car with a short title may only score 1.6-3.0, failing the threshold. The system should require a quote for ALL detected vehicles regardless of price or score -- only vehicle *parts/accessories* (exclusion keywords) should be exempt.

## Solution

### 1. Fix vehicle quote threshold (backend)

**File: `supabase/functions/_shared/shippingCategory.ts`** (line 516-517)

Change `requiresQuote` to trigger for ALL detected vehicles (not just car marketplaces or high-confidence ones). The exclusion keyword filter already prevents parts/accessories from being flagged.

Current:
```
const requiresQuote = isVehicle && !hasVehicleExclusion && 
  (isCarMarketplace || (confidence >= VEHICLE_QUOTE_CONFIDENCE_THRESHOLD && bestScore >= 3.0));
```

New:
```
const requiresQuote = isVehicle && !hasVehicleExclusion;
```

This means: if the category detection picks "vehicle" as the best category AND no exclusion keywords (charger, brake pad, toy car, etc.) were found, it always requires a quote -- regardless of price, confidence score, or store.

### 2. Detect vehicles from product title on ProductDetails page (frontend)

**File: `src/pages/shop/ProductDetails.tsx`** (lines 52-57)

Enhance vehicle detection to also check the product title using the same keyword patterns used in the backend. Instead of relying solely on `location.state`, also check if the loaded product title matches vehicle keywords (car brands, body types like sedan/SUV/truck, etc.).

Add a helper function that checks if a title looks like a vehicle listing (not a part). This runs after the product loads and updates the `isVehicle` flag dynamically.

### 3. Fix PriceBreakdown to handle per-product vehicle status (frontend)

**File: `src/components/shop/PriceBreakdown.tsx`** (lines 34-36)

When `isVehicle` is passed as `true`, ALWAYS treat shipping as pending -- don't check `vehicleQuoteStatus` from the cart context, because on a product details page the cart context has no knowledge of this specific product's quote status.

Current:
```typescript
const vehiclePendingQuote = isVehicle
  ? vehicleQuoteStatus !== 'quoted'
  : hasVehicleItems && vehicleQuoteStatus !== 'quoted';
```

New:
```typescript
const vehiclePendingQuote = isVehicle
  ? true  // Vehicle products ALWAYS show pending quote on product page
  : hasVehicleItems && vehicleQuoteStatus !== 'quoted';
```

This ensures that on the product page, a vehicle always shows "Awaiting quote" for shipping and "Estimated Subtotal" instead of a full total.

### 4. Use admin-set vehicle markup percentage (already working)

The `vehicleMarkupPercent` is already fetched from `mobile-public-config` API (`data.markup.vehicleValue`) and stored in `feeSettings`. The PriceBreakdown already uses `feeSettings.vehicleMarkupPercent` when `isVehicle` is true. No change needed here -- this part is working correctly.

## Technical Details

### Vehicle Title Detection Helper (ProductDetails.tsx)

```typescript
function looksLikeVehicleListing(title: string): boolean {
  const lower = title.toLowerCase();
  // Exclusion: parts, accessories, toys
  const exclusions = ['charger', 'mount', 'holder', 'brake pad', 'oil filter', 
    'toy car', 'diecast', 'model car', 'rc car', 'hot wheels', 'key fob',
    'floor mat', 'seat cover', 'car wash', 'phone holder'];
  if (exclusions.some(e => lower.includes(e))) return false;
  
  // Vehicle body types
  const bodyTypes = ['sedan', 'suv', 'truck', 'coupe', 'hatchback', 'convertible', 
    'minivan', 'wagon', 'pickup', 'crossover', '4x4', 'motorcycle'];
  // Year pattern (e.g., "2022 Toyota")
  const hasYear = /\b(19|20)\d{2}\b/.test(title);
  // Car brands
  const brands = ['toyota', 'honda', 'ford', 'chevrolet', 'chevy', 'nissan', 
    'bmw', 'mercedes', 'audi', 'tesla', 'jeep', 'hyundai', 'kia', 'subaru',
    'mazda', 'volkswagen', 'lexus', 'porsche', 'dodge', 'ram', 'gmc',
    'land rover', 'range rover', 'volvo', 'buick', 'cadillac', 'lincoln'];
  
  const hasBrand = brands.some(b => lower.includes(b));
  const hasBodyType = bodyTypes.some(b => lower.includes(b));
  
  // A vehicle listing typically has: year + brand, or brand + body type
  return (hasYear && hasBrand) || (hasBrand && hasBodyType);
}
```

This will be used alongside the existing `location.state` check, so `isVehicle` becomes:
```typescript
const isVehicle = !!(
  (location.state as any)?.product?.isVehicle ||
  (location.state as any)?.isVehicle ||
  (location.state as any)?.categoryKey?.includes('vehicle') ||
  (location.state as any)?.subtabKey?.includes('vehicle') ||
  (product && looksLikeVehicleListing(product.title))
);
```

### Edge Function Redeployment

The `catalog-home` and `mobile-add-cart-item` functions use `determineShippingCategory` from the shared module. Changing the threshold in `shippingCategory.ts` will affect all functions that import it. The following functions will be redeployed:
- Any function importing from `_shared/shippingCategory.ts`

## Files Modified

| File | Change |
|---|---|
| `supabase/functions/_shared/shippingCategory.ts` | Remove score/confidence threshold for vehicle quote requirement |
| `src/pages/shop/ProductDetails.tsx` | Add title-based vehicle detection helper |
| `src/components/shop/PriceBreakdown.tsx` | Always show pending quote for vehicle products |

## No Regressions

- Vehicle parts/accessories still excluded by the extensive exclusion keyword list
- Non-vehicle products unchanged (different category wins the scoring)
- Mobile app unaffected (uses backend `requiresManualQuote` flag from DB)
- Admin vehicle markup percentage continues to flow from admin portal through the config API
- Cart-level vehicle quote status still works correctly for the cart/checkout pages
