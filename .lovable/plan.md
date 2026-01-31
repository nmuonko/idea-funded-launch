
# Fix: Home Curation Seeds and Vehicles Search Issues

## Problem Summary

You've identified two issues:

1. **Seeds cannot be deleted/updated** - Admin operations fail silently
2. **"See All" on Vehicles shows toys** - The search displays toy vehicles instead of real cars/trucks

---

## Root Cause Analysis

### Issue 1: Seed Operations Failing

The edge functions `admin-home-seeds`, `admin-home-sections`, and `admin-home-seed-suggestions` are returning 404 errors from the gateway, even though the code exists and logs show the functions booting successfully.

**Diagnosis**: There appears to be a deployment synchronization issue where the functions need to be force-redeployed to ensure they're properly registered with the gateway.

### Issue 2: Vehicles Showing Toys

When you click "See All" on the Vehicles section, the query "Vehicles" is sent to the search endpoint. However, the vehicle detection logic fails because:

**The `VEHICLE_QUERY_KEYWORDS` list is missing English "vehicle" and "vehicles"!**

```typescript
// Current list (line 100-101 in catalog-search):
"voiture", "voitures", "moto", "camion", "vehicule", "automobile"
//                                        ^^^^ French only!
```

The list has the French term `"vehicule"` but not the English terms `"vehicle"` or `"vehicles"`. When a user searches for "Vehicles", the `isVehicleQuery()` function returns `false`, allowing the query to go to Amazon, which returns toy vehicles.

---

## Solution

### Fix 1: Add Missing English Vehicle Keywords

Update `supabase/functions/catalog-search/index.ts` to include "vehicle" and "vehicles" in the keyword list:

```typescript
// French vehicle terms + English
"voiture", "voitures", "moto", "camion", "vehicule", "vehicle", "vehicles", "automobile",
```

### Fix 2: Redeploy All Affected Edge Functions

Force redeploy these functions to fix the 404 gateway issues:
- `admin-home-seeds`
- `admin-home-sections`
- `admin-home-seed-suggestions`
- `catalog-search`

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/catalog-search/index.ts` | Add `"vehicle"`, `"vehicles"` to `VEHICLE_QUERY_KEYWORDS` (line 101) |

---

## Expected Behavior After Fix

1. **Seed management**: Add, edit, and delete seed queries in Home Curation will work
2. **Vehicles "See All"**: Will search eBay Motors exclusively, returning real cars and trucks instead of toy vehicles

---

## Data Flow After Fix

```text
User clicks "See All" on Vehicles section
       │
       ▼
Frontend sends: q="Vehicles" category_key=vehicles_cars_trucks
       │
       ▼
catalog-search receives query
       │
       ▼
isVehicleQuery("vehicles") → TRUE (now matches "vehicles" keyword)
       │
       ▼
Amazon SKIPPED (only sells parts/toys)
eBay Motors searched exclusively
       │
       ▼
Returns real cars, trucks, SUVs with $1,500+ prices
```
