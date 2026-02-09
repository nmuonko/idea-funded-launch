

# Fix: Vehicles Tab Must Return Only Real Vehicle Listings

## Problem
When users click the Vehicles tab (`category=vehicles`), the system still shows parts, owners manuals, emblems, and accessories. Three root causes:

1. **No intent override for category=vehicles**: The `effectiveIntent` is determined by query text analysis, not by the category tab. The default query `"used car truck sedan SUV"` may not trigger `vehicle_listing` intent consistently.
2. **eBay fetches from category 6000 (eBay Motors root)** which includes Parts & Accessories subcategories.
3. **Guardrails only trigger if `isVehicleLikeQueryGuardrail()` matches** the query -- and even then, Tier 3 fallback can reintroduce parts when filtered count is very low.

## Changes (Backend Only)

### 1. Force vehicle_listing intent when category=vehicles
**File:** `supabase/functions/catalog-search/index.ts` (~line 413)

After `effectiveIntent` is computed, override it when `categoryKey === "vehicles"`:
```typescript
// Force vehicle_listing intent when Vehicles tab is active
if (categoryKey === "vehicles" || categoryKey === "vehicles_cars_trucks" || categoryKey === "vehicles_motorcycles") {
  effectiveIntent = { ...effectiveIntent, intentKey: "vehicle_listing", vehicleListingIntent: true };
  hasBuyingIntent = true;
  console.log(`[CATALOG_SEARCH] requestId=${requestId} FORCED vehicle_listing intent via category=${categoryKey}`);
}
```
This requires changing `effectiveIntent` from `const` to `let`.

### 2. eBay fetcher: use listing-only categories for vehicles tab
**File:** `supabase/functions/_shared/ebayFetcher.ts` (~line 48)

Update `CATEGORY_MAPPING` to point `vehicles` at `6001` (Cars & Trucks) instead of `6000` (eBay Motors root which includes parts):
```typescript
vehicles: "6001",  // Cars & Trucks listings only (was 6000 which includes parts)
```

Also add dual-fetch logic: when `categoryKey === "vehicles"` and the query contains motorcycle signals, fetch both 6001 and 6024 in parallel, then merge.

### 3. Add hardMode to vehicle guardrails
**File:** `supabase/functions/_shared/vehicleGuardrails.ts`

Add a `hardMode` option parameter:
- In `hardMode`, Tier 3 fallback NEVER returns unfiltered items -- it returns the best filtered set even if small
- If absolutely 0 items remain after parts drop, relax signal requirements but KEEP parts drop active
- Update `applyVehicleGuardrails` signature to accept `{ hardMode?: boolean }`

### 4. Call guardrails in hardMode for vehicles tab
**File:** `supabase/functions/catalog-search/index.ts` (~line 852)

When `categoryKey === "vehicles"`, always run guardrails in hardMode regardless of query detection:
```typescript
const isVehiclesTab = categoryKey === "vehicles" || categoryKey === "vehicles_cars_trucks" || categoryKey === "vehicles_motorcycles";
const vehicleGuardrailActive = isVehiclesTab || isVehicleLikeQueryGuardrail(providerQuery);
if (vehicleGuardrailActive) {
  const guardrailResult = applyVehicleGuardrails(finalItems, providerQuery, filteredFinalItems, { hardMode: isVehiclesTab });
  finalItems = guardrailResult.items as typeof finalItems;
}
```

### 5. Bump cache version
**File:** `supabase/functions/_shared/catalogCache.ts` (line 15)

Change `AMAZON_CACHE_VERSION` from `"v15"` to `"v16"` to flush old vehicle tab results that contain parts.

## Summary

| File | Change |
|------|--------|
| `catalog-search/index.ts` | Force `vehicle_listing` intent + `hasBuyingIntent` when `categoryKey=vehicles`; always run guardrails in `hardMode` for vehicles tab |
| `_shared/ebayFetcher.ts` | Change vehicles mapping from `6000` to `6001`; add dual-fetch (6001+6024) for motorcycle queries |
| `_shared/vehicleGuardrails.ts` | Add `hardMode` option: Tier 3 keeps parts drop active, never returns raw unfiltered list |
| `_shared/catalogCache.ts` | Bump cache version to `v16` |

