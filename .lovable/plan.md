
# Fix: Vehicles Filter Showing Parts Instead of Real Vehicles

## Root Cause

The vehicles category tab sends the query `"cars trucks SUV"` to `catalog-search`. The backend has vehicle guardrails that filter out parts/accessories, but they use a **3-tier fallback**: strict (needs 20+ results) -> relaxed (needs 20+ results) -> **fallback (returns everything unfiltered)**. Since eBay/Amazon return fewer than 20 real vehicle listings for this generic query, the guardrails fall back to tier 3 and show all results -- including window tints, floor mats, and other parts.

Meanwhile, the `catalog-collection` function (used for curated feeds) successfully filters vehicles because it applies a **$1,500 minimum price** and aggressive deny-keyword filtering. The `catalog-search` path lacks this price floor.

## Fix (Two Changes)

### 1. Frontend: Add minimum price filter for vehicles category
**File:** `src/pages/shop/SearchResults.tsx`

When `category === 'vehicles'`, automatically inject a `minPrice: 1500` filter into the search params. This eliminates cheap accessories ($80 window tints, $20 floor mats) at the API level before guardrails even run.

```typescript
// In fetchProducts, after building the filters object:
if (category === 'vehicles') {
  filters.minPrice = Math.max(filters.minPrice || 0, 1500);
}
```

### 2. Backend: Lower guardrail fallback threshold
**File:** `supabase/functions/_shared/vehicleGuardrails.ts`

Reduce `MIN_FILTERED` from 20 to 5. Currently, if strict filtering yields even 15 real vehicle listings, the guardrail discards them all and falls back to the unfiltered list (which includes parts). With a threshold of 5, even a handful of real vehicles will be shown instead of falling back to parts.

```typescript
const MIN_FILTERED = 5;  // was 20
```

### 3. Frontend: Improve default query
**File:** `src/pages/shop/SearchResults.tsx`

Change the vehicles default query from `'cars trucks SUV'` to `'used car truck sedan SUV'` to better match the `catalog-collection` query patterns that are known to return real vehicles.

## Summary

| File | Change |
|------|--------|
| `src/pages/shop/SearchResults.tsx` | Add `minPrice: 1500` for vehicles category; update default query |
| `supabase/functions/_shared/vehicleGuardrails.ts` | Lower `MIN_FILTERED` from 20 to 5 |
