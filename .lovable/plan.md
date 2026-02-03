
# Fix Vehicle Search to Return Actual Vehicles

## Problem Analysis

When users search for vehicles (e.g., "toyota rav4", "tesla model 3", "GM Yukon") from the mobile app's search bar, the search returns **0 results** instead of actual vehicle listings.

### Root Cause

Based on the edge function logs:
```
[SEARCH] requestId=e49beb03 PostFilter: 32 → 0 items, filters={"maxPrice":1650}
```

1. **eBay returned 66 vehicle listings** successfully
2. **After filtering, 32 items remained** (passed the vehicle quality checks)
3. **A `maxPrice: 1650` filter was applied**, reducing results from 32 → 0

The issue is a **conflicting price filter**:
- The backend correctly enforces a **minimum price of $1,500** for vehicles (to exclude parts/accessories)
- The mobile app is sending a **maxPrice of $1,650** as a default filter
- This creates an effective price range of **$1,500 - $1,650**, which excludes almost all actual vehicles

Real vehicle prices typically start at $3,000+ for used cars and can go up to $100,000+.

### Current Flow
```text
Mobile App Search → catalog-search API
                   ↓
           Parse filters={"maxPrice":1650}
                   ↓
           Fetch from eBay Motors (66 items)
                   ↓
           Apply vehicle quality filter (32 remain)
                   ↓
           Apply maxPrice filter → 0 items!
```

---

## Solution

Modify the `catalog-search` edge function to **override restrictive price filters for vehicle searches**. When a vehicle intent is detected, any `maxPrice` filter below a reasonable vehicle threshold should be ignored or overridden.

### Changes Required

#### 1. Edge Function: `supabase/functions/catalog-search/index.ts`

Add vehicle-aware price filter logic after parsing filters:

```typescript
// After line 324 (where catalogFilters is parsed)
// Override restrictive maxPrice for vehicle searches
if (isVehicle && catalogFilters.maxPrice !== undefined) {
  const VEHICLE_MAX_PRICE_FLOOR = 5000; // Minimum maxPrice for vehicle searches
  if (catalogFilters.maxPrice < VEHICLE_MAX_PRICE_FLOOR) {
    console.log(`[SEARCH] requestId=${requestId} Vehicle search: overriding restrictive maxPrice=${catalogFilters.maxPrice} (removed)`);
    delete catalogFilters.maxPrice; // Remove the restrictive filter
  }
}
```

However, since `isVehicle` is calculated later (line 429), we need to restructure the logic. The fix will:

1. **Move the vehicle detection earlier** (before filter parsing impact)
2. **Add a vehicle price filter override** that removes or adjusts maxPrice when it's too restrictive for vehicle searches

#### Code Changes

**In `catalog-search/index.ts`:**

```typescript
// After parsing filters (around line 324):
const catalogFilters = parseFilters(filtersParam);

// Detect vehicle query early (move this check earlier in the flow)
const isVehicle = isVehicleQuery(qNorm);

// VEHICLE SEARCH FIX: Override restrictive price filters
// Mobile apps may send default maxPrice filters that are too low for vehicles
const VEHICLE_REASONABLE_MIN_MAX_PRICE = 5000; // Vehicles cost more than $5k typically

if (isVehicle && catalogFilters.maxPrice !== undefined) {
  if (catalogFilters.maxPrice < VEHICLE_REASONABLE_MIN_MAX_PRICE) {
    console.log(`[SEARCH] requestId=${requestId} Vehicle search: removing restrictive maxPrice=${catalogFilters.maxPrice} (vehicles typically cost $5,000+)`);
    delete catalogFilters.maxPrice;
  }
}

// Also ensure minPrice is at least $1500 for vehicles
if (isVehicle && (catalogFilters.minPrice === undefined || catalogFilters.minPrice < 1500)) {
  catalogFilters.minPrice = 1500;
  console.log(`[SEARCH] requestId=${requestId} Vehicle search: enforcing minPrice=$1500`);
}
```

#### Why This Works

1. **Detects vehicle intent** from the query (e.g., "toyota rav4", "GM Yukon")
2. **Removes restrictive maxPrice** filters that would exclude vehicles
3. **Enforces minimum price** of $1,500 to continue excluding parts
4. **Preserves user's intent** for high maxPrice filters (if user sets maxPrice=$50,000, it's respected)

---

## Implementation Steps

### Step 1: Move Vehicle Detection Earlier

The `isVehicleQuery()` call is currently at line 429. We need to call it earlier (around line 325) so we can adjust filters before they're used.

### Step 2: Add Price Filter Override Logic

Add conditional logic to:
- Remove `maxPrice` if it's below $5,000 for vehicle searches
- Set `minPrice` to $1,500 for vehicle searches (already enforced in eBay call, but this ensures consistency)

### Step 3: Add Logging

Log when filters are overridden for debugging and transparency.

---

## Technical Details

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/catalog-search/index.ts` | Add vehicle-aware price filter override logic |

### Constants to Add

```typescript
// Minimum maxPrice allowed for vehicle searches
// Any maxPrice below this is removed to prevent filtering out all vehicles
const VEHICLE_REASONABLE_MIN_MAX_PRICE = 5000;
```

### Expected Behavior After Fix

| Search Query | Before Fix | After Fix |
|--------------|------------|-----------|
| "toyota rav4" | 0 results (maxPrice=$1650 filtered everything) | 30+ vehicle listings |
| "tesla model 3" | 0 results | Tesla Model 3 vehicle listings |
| "GM Yukon" | 0 results | GMC Yukon vehicle listings |
| "iphone 15" | Works normally | Works normally (no vehicle intent) |

### Performance Impact

- **None** - only adds a simple conditional check
- **Faster perceived results** because users will see actual vehicles instead of empty results

---

## Additional Considerations

### Mobile App Side (Optional Future Enhancement)

The mobile app should ideally not send a default `maxPrice` filter for searches. However, fixing the backend is the priority since:
1. It's a single point of change
2. It protects against any client sending restrictive filters
3. It can be deployed immediately

### Amazon Integration

Currently, Amazon is skipped for vehicle searches because Amazon Auto only sells parts/accessories, not actual vehicles. This is correct behavior and should remain unchanged.

---

## Summary

This is a critical fix that will restore vehicle search functionality by:
1. Detecting vehicle search intent early in the request flow
2. Removing restrictive `maxPrice` filters that conflict with vehicle pricing norms
3. Maintaining the $1,500 minimum price floor to exclude parts/accessories
4. Allowing users to find actual vehicles when searching for car makes and models
