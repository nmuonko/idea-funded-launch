

# Smarter Vehicle Detection Using Database Category

## Problem
The current `looksLikeVehicleListing()` uses title heuristics (year + brand name) to guess if something is a vehicle. This is fundamentally fragile -- a "$3,000 2024 Dell Laptop" or "2023 Rolex Submariner" could false-positive if the exclusion list isn't exhaustive enough. Meanwhile, the database already **knows** which items are vehicles via the `category_key` column (e.g., `vehicles`, `vehicles_cars_trucks`) and `vehicles_subkey` column.

## Solution: Use the authoritative `category_key` from the database

The `catalog_items` table already has:
- `category_key`: values like `vehicles`, `vehicles_cars_trucks` for real vehicles
- `vehicles_subkey`: values like `cars_trucks`, `motorcycles`, `boats`, `rvs_campers`

These are set during ingestion from eBay category 6001 and are **100% reliable**. The fix is to pass this field from the backend to the frontend and use it as the primary vehicle signal.

## Changes

### 1. Backend: Include `categoryKey` in product API response

**File:** `supabase/functions/catalog-product/index.ts`

In `mapDbItemToResponse()`, add `categoryKey` and `vehiclesSubkey` to the returned object:

```typescript
return {
  id: item.id,
  // ... existing fields ...
  categoryKey: item.category_key || null,
  vehiclesSubkey: item.vehicles_subkey || null,
};
```

### 2. Frontend: Replace title-guessing with category-based detection

**File:** `src/pages/shop/ProductDetails.tsx`

Replace the entire `looksLikeVehicleListing()` function with a simple category check:

```typescript
function isVehicleProduct(product: ProductData): boolean {
  // PRIMARY: use the authoritative category from the database
  if (product.categoryKey?.startsWith('vehicle')) return true;
  if (product.vehiclesSubkey) return true;

  // FALLBACK: title heuristic only for items without category data
  // Requires ALL of: price >= $5,000 + year + (car brand + body type)
  // This is intentionally very strict since it's a guess
  if ((product.priceUsd || 0) < 5000) return false;
  const lower = product.title.toLowerCase();
  // ... (keep existing exclusion list) ...
  const hasYear = /\b(19|20)\d{2}\b/.test(product.title);
  const hasBrand = brands.some(b => lower.includes(b));
  const hasBodyType = bodyTypes.some(b => lower.includes(b));
  return hasYear && hasBrand && hasBodyType; // require ALL THREE
}
```

Key differences:
- Database category is checked **first** -- this is definitive, zero false positives
- Title heuristic is only a fallback for items missing category data
- Fallback price floor raised to **$5,000** (no vehicle costs less)
- Fallback requires year AND brand AND body type (all three, not two)

### 3. Backend: Also fix `shippingCategory.ts` vehicle scoring

**File:** `supabase/functions/_shared/shippingCategory.ts`

Add `categoryKey` as an input to `detectShippingCategory()`. If `categoryKey` starts with `vehicle`, return vehicle category immediately with full confidence -- no keyword scoring needed:

```typescript
if (input.categoryKey?.startsWith('vehicle')) {
  return { category: 'vehicle', confidence: 1.0, matchedKeywords: ['db_category'], requiresQuote: true, isEstimated: false };
}
```

This prevents the keyword-based scorer from ever mis-categorizing a laptop or watch as a vehicle.

## Why this is bulletproof

| Item | category_key | Result |
|------|-------------|--------|
| 2022 Tesla Model 3 ($20k) | `vehicles_cars_trucks` | Vehicle (from DB) |
| 2021 Ducati Motorcycle ($8k) | `vehicles` | Vehicle (from DB) |
| MacBook Pro 2024 ($3,500) | `uncategorized` | NOT vehicle (no DB category, brand not in car list) |
| Rolex Submariner 2023 ($12k) | `montres_bijoux` | NOT vehicle (DB says jewelry) |
| Honda Generator ($2,500) | `uncategorized` | NOT vehicle (no body type like sedan/truck) |

## Files Modified

| File | What Changes |
|------|-------------|
| `supabase/functions/catalog-product/index.ts` | Add `categoryKey` and `vehiclesSubkey` to API response |
| `src/pages/shop/ProductDetails.tsx` | Replace title-guessing with DB category check + strict fallback |
| `supabase/functions/_shared/shippingCategory.ts` | Add `categoryKey` input for definitive vehicle detection |

