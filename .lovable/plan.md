

## Show 4 Specific Luxury Cars in the Vehicles Homepage Grid

### Current Behavior
The vehicles section runs a broad 3-step search pipeline (eBay Motors cache, catalog-home feed, then generic SUV/Tesla searches) and picks the first 4 results that pass the vehicle filter. This means the displayed cars change unpredictably.

### What We'll Do
Replace the entire vehicles search pipeline with **4 exact search queries** targeting your chosen cars:

1. **2023 Tesla Model X Plaid Full Self Driving White**
2. **2025 GMC Yukon XL AT4 Ultimate 4WD Lifted 22 Vossens DVD Diesel**
3. **2025 Ford Explorer Active AWD**
4. **2025 Hyundai Santa Fe XRT Sport Utility**

### Changes

**File: `src/pages/shop/ShopHome.tsx`**

Replace the vehicles special path (lines ~447-521) with a simplified approach:

1. Define an array of 4 exact vehicle search queries matching your chosen cars
2. Run each query one at a time, taking the first valid result from each (price > $500, passes vehicle filter)
3. Remove the old 3-step pipeline (catalog-category, catalog-home, generic fallback queries)
4. Keep all existing vehicle exclusion filters (accessories, toys, etc.) to avoid false matches

```text
// New approach (simplified):
const EXACT_VEHICLE_QUERIES = [
  '2023 Tesla Model X Plaid Full Self Driving White',
  '2025 GMC Yukon XL AT4 Ultimate 4WD Lifted Vossens',
  '2025 Ford Explorer Active AWD SUV',
  '2025 Hyundai Santa Fe XRT Sport Utility',
];

// Search each query, take first valid match per query
for (const q of EXACT_VEHICLE_QUERIES) {
  if (items.length >= 4) break;
  const results = await searchVehicles([q], 1, seenIds, vehicleExcludes);
  items.push(...results);
}
```

### Result
- The homepage vehicles grid will show exactly those 4 cars (or the closest eBay listing match for each query)
- The "Voir plus" (See More) page is unaffected -- it still uses the full 27-seed recipe for deep browsing
- If any specific car isn't found on eBay, the slot stays empty rather than showing a random vehicle
