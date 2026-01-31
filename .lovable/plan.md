
# Fix: Vehicles Category Showing Wrong Products

## Problem Summary

The Vehicles category tab is displaying automotive equipment (lifts, diagnostic tools, parts) instead of actual vehicles (cars, trucks, motorcycles). This happens because:

1. **Wrong eBay Category ID**: The top-level `vehicles` and `vehicles_all` use eBay category `6000` ("eBay Motors"), which is a parent category containing both vehicles AND automotive equipment/parts
2. **Insufficient Filtering**: The parts keyword filter doesn't catch automotive equipment like "automotive lift" or "diagnostic scanner"
3. **Missing Search Query**: For vehicle categories, the API uses category_id alone without a query, returning everything in that broad category

---

## Solution Overview

Three-pronged approach to ensure only real vehicles appear:

```text
┌──────────────────────────────────────────────────────────────────────┐
│                    VEHICLE FILTERING STRATEGY                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. CORRECT CATEGORY IDS                                             │
│     vehicles_all → Use subcategory union, NOT 6000                   │
│     vehicles → Use explicit vehicle-only categories                   │
│                                                                       │
│  2. MANDATORY SEARCH QUERY                                           │
│     Always include vehicle-specific keywords                         │
│     "car for sale" OR "truck" OR "sedan" etc.                        │
│                                                                       │
│  3. EXPANDED EQUIPMENT BLOCKLIST                                     │
│     Add: "automotive lift", "car lift", "diagnostic",                │
│     "scanner", "obd", "alignment machine", "tire changer"            │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Phase 1: Update eBay Category Mappings

**File**: `supabase/functions/_shared/categoryRegistry.ts`

Update the `CATEGORY_META` with correct vehicle-specific category IDs:

| Category | Current ID | Corrected ID | Description |
|----------|------------|--------------|-------------|
| `vehicles` | 6000 | 6000 (keep) | Parent, but will use query |
| `vehicles_all` | 6000 | 6000 (keep) | Parent, but will use query |
| `vehicles_cars_trucks` | 6001 | 6001 | Cars & Trucks (correct) |
| `vehicles_motorcycles` | 6024 | 6024 | Motorcycles (correct) |
| `vehicles_powersports` | 66466 | 66466 | ATVs/UTVs (correct) |
| `vehicles_boats` | 26429 | 26429 | Boats (correct) |
| `vehicles_rvs_campers` | 50054 | 50054 | RVs (correct) |
| `vehicles_trailers_other` | 6038 | 6038 | Trailers (correct) |
| `vehicles_classic_cars` | 6001 | 6001 | Uses Cars category (correct) |

The category IDs are mostly correct - the issue is that category 6000 is too broad.

### Phase 2: Force Query for Vehicle Searches

**File**: `supabase/functions/catalog-category/index.ts`

Update the eBay search call to ALWAYS include a query for vehicle categories:

```typescript
// Lines ~550-572: Update searchEbayWithFallback call
const vehicleQuery = isVehicle && !isParts
  ? VEHICLE_FALLBACK_QUERIES[canonicalKey]?.[0] || "car for sale truck suv sedan"
  : undefined;

const searchResult = await searchEbayWithFallback(
  supabase,
  {
    query: vehicleQuery, // ADD THIS - force query for vehicles
    categoryId: ebayCategory || undefined,
    page,
    pageSize: limit,
    minPrice: minPrice > 0 ? minPrice : undefined,
    isVehicle,
    isParts,
    marketplaceId: "EBAY_US",
    sort,
    filters: Object.keys(catalogFilters).length > 0 ? catalogFilters : undefined,
  },
  fallbackQueries,
  requestId
);
```

### Phase 3: Expand Equipment Blocklist

**File**: `supabase/functions/_shared/motorsFilter.ts`

Add automotive equipment keywords to the block list (~line 50-230):

```typescript
// Add to MOTORS_PARTS_KEYWORDS array:
// ═══════════════════════════════════════════════════════════════════════════
// AUTOMOTIVE EQUIPMENT (shop/garage equipment - NOT vehicles)
// ═══════════════════════════════════════════════════════════════════════════
"automotive lift", "car lift", "vehicle lift", "two post lift", "four post lift",
"scissor lift", "motorcycle lift", "atv lift", "alignment rack", "alignment machine",
"tire changer", "tire machine", "wheel balancer", "balancing machine",
"diagnostic scanner", "obd scanner", "obd2", "obdii", "code reader",
"scan tool", "diagnostic tool", "diagnostic computer", "diagnostic kit",
"engine analyzer", "compression tester", "leak down tester",
"brake lathe", "drum lathe", "rotor lathe",
"parts washer", "solvent tank", "spray booth", "paint booth",
"engine hoist", "engine crane", "transmission jack", "floor jack",
"shop press", "hydraulic press", "bearing press",
"a/c machine", "ac machine", "refrigerant recovery", "evacuation machine",
"fluid extractor", "oil extractor", "brake bleeder",
"creeper", "mechanics creeper", "shop stool", "work bench",
"tool chest", "tool cabinet", "service cart", "parts cart",
"air compressor shop", "shop compressor",
"sandblaster", "bead blaster", "media blaster",
```

### Phase 4: Update Fallback Queries

**File**: `supabase/functions/catalog-category/index.ts`

Improve the `VEHICLE_FALLBACK_QUERIES` to be more specific about actual vehicles for sale:

```typescript
const VEHICLE_FALLBACK_QUERIES: Record<string, string[]> = {
  vehicles: [
    "car for sale clean title runs drives", 
    "truck for sale v8 automatic",
    "suv for sale awd 4wd",
  ],
  vehicles_all: [
    "car for sale clean title",
    "used car for sale low miles",
    "truck for sale one owner",
  ],
  vehicles_cars_trucks: [
    "sedan for sale clean title",
    "used car for sale low mileage",
    "pickup truck for sale 4x4",
  ],
  // ... existing entries are fine
};
```

---

## Files to Modify

1. **`supabase/functions/_shared/motorsFilter.ts`**
   - Add ~50 new automotive equipment keywords to `MOTORS_PARTS_KEYWORDS`
   - Add new section for shop/garage equipment

2. **`supabase/functions/catalog-category/index.ts`**
   - Force query parameter for vehicle categories (lines ~555-570)
   - Update `VEHICLE_FALLBACK_QUERIES` to be more specific

3. **`supabase/functions/_shared/ebayBrowseSearch.ts`**
   - Update `PARTS_DENY_KEYWORDS` with equipment terms
   - Add `EQUIPMENT_DENY_KEYWORDS` for automotive shop equipment

---

## Expected Outcomes

| Before | After |
|--------|-------|
| Category shows lifts, scanners, diagnostic tools | Category shows cars, trucks, SUVs |
| Parts filter misses equipment keywords | Equipment keywords blocked |
| No query for category browse | Query forces vehicle-specific results |
| 50% parts/equipment in results | <5% irrelevant items |

---

## Rollback Plan

If vehicle results become too restrictive:
1. Remove equipment keywords from blocklist
2. Remove forced query parameter
3. Deploy previous version of edge functions

---

## Testing Verification

After deployment, verify:
1. Browse `vehicles` tab - should show cars/trucks/SUVs
2. Browse `vehicles_motorcycles` - should show actual motorcycles
3. No automotive lifts, diagnostic scanners, or shop equipment in results
4. Price filter ($1500+) still applies
5. Pagination continues to work correctly
