
# Fix Mobile Search: Make Backend Return Rich Results for Vehicle Queries

## Problem
The mobile app (frozen build) calls `catalog-search` once and displays whatever comes back. Unlike the web frontend, it has no client-side query broadening (`expandQuery`) that generates similar queries like "GMC Yukon", "Yukon" when "SUV GMC Yukon" returns few results. This means vehicle searches often return 0 results on mobile.

## Root Cause
The backend's broadening logic (line 1178 in `catalog-search/index.ts`) only runs when `directQuery === true`, which requires either a digit or a known model token in the query. "SUV GMC Yukon" has neither, so it skips broadening entirely. The backend already has `generateBroadenedQueries` but it's gated behind this condition.

## Fix: Extend Backend Broadening to Vehicle Queries

### Change 1: Widen broadening trigger in `catalog-search/index.ts`
Currently (line 1178):
```
if (directQuery && totalAfterPrimary < BROADEN_THRESHOLD && !providerTimedOut)
```

Change to also trigger for vehicle-intent queries:
```
if ((directQuery || hasBuyingIntent || effectiveIntent.vehicleListingIntent) && totalAfterPrimary < BROADEN_THRESHOLD && !providerTimedOut)
```

This ensures "SUV GMC Yukon" (detected as vehicle intent) gets broadened to "GMC Yukon", "Yukon", etc. server-side.

### Change 2: Add vehicle-aware broadening queries
Enhance `generateBroadenedQueries` to also strip vehicle-type words like "SUV", "sedan", "truck", "coupe" etc., since these are category descriptors rather than product-identifying terms. This turns "SUV GMC Yukon" into "GMC Yukon" as the first broadened query.

Add a new set of vehicle type words to strip:
```
const VEHICLE_TYPE_WORDS = new Set([
  "suv","sedan","truck","pickup","coupe","convertible","minivan",
  "van","hatchback","wagon","crossover","motorcycle","car","vehicle",
]);
```

Add a step in `generateBroadenedQueries` that strips these words (similar to how qualifier words are stripped).

### Change 3: Add "GMC" and "Yukon" to MODEL_TOKENS set
Add common vehicle make names to the `MODEL_TOKENS` set so queries like "GMC Yukon" are recognized as direct queries and get the fast path + broadening treatment:
```
"gmc","yukon","tahoe","silverado","sierra","suburban","ford","f150",
"mustang","bronco","explorer","expedition","ram","wrangler","jeep",
"grand cherokee","4runner","tundra","camry","corolla","civic","accord",
"escalade","navigator","ranger","tacoma","highlander","rav4","crv"
```

### What stays the same
- The web frontend broadening continues to work as before
- All existing backend logic (DB-first, cache, provider mixing, intent scoring) unchanged
- The `categoryPageSize: 100` change from earlier is preserved

### Files to edit
- `supabase/functions/catalog-search/index.ts` -- Widen broadening trigger, add vehicle makes to MODEL_TOKENS, add vehicle-type stripping to `generateBroadenedQueries`
