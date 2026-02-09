
# Fix: Vehicles Tab Showing No Products

## Problem
The `minPrice: 1500` filter added for the vehicles category is too restrictive. The eBay/Amazon search APIs return zero results at that price floor, causing "No products found."

## Fix
**File:** `src/pages/shop/SearchResults.tsx` (lines 86-89)

Remove the hardcoded `$1,500` minimum price override for vehicles. The backend guardrails (already lowered to `MIN_FILTERED = 5`) combined with the improved default query (`'used car truck sedan SUV'`) should be sufficient to filter out parts without needing a price floor that eliminates all results.

**Before:**
```typescript
// Vehicles category: enforce $1,500 minimum price to filter out parts/accessories
if (category === 'vehicles') {
  filters.minPrice = Math.max(filters.minPrice || 0, 1500);
}
```

**After:** Remove this block entirely.

| File | Change |
|------|--------|
| `src/pages/shop/SearchResults.tsx` | Remove the `minPrice: 1500` override for vehicles category (lines 86-89) |
