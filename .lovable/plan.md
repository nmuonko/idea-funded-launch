
# Vehicle Guardrails (Smart + Dynamic) for eBay Motors + Amazon Auto

## Overview

Add a post-fetch vehicle guardrail layer that activates ONLY for vehicle-like queries. For all other queries, search behavior remains unchanged (true proxy mode). The guardrails ensure vehicle searches return real vehicle listings (cars, trucks, motorcycles) instead of parts, accessories, floor mats, and toys.

## What Already Exists

The codebase already has significant vehicle infrastructure:
- `vehicleDetection.ts`: intent classification, make/model detection, buying intent, token-aware matching
- `motorsFilter.ts`: strict parts keyword filtering with `isAllowedMotorListing()`
- `searchIntentScorer.ts`: intent-based scoring that hard-drops parts for `vehicle_listing` intent
- `ebayFetcher.ts`: already forces eBay category 6001 (Cars & Trucks) or 6024 (Motorcycles) when `hasBuyingIntent` is true
- `vehicleProbe.ts`: dynamic eBay Motors probe for ambiguous queries

The existing `searchIntentScorer.ts` already hard-drops vehicle parts for `vehicle_listing` intent (line 93-95), and the eBay fetcher already forces Motors categories (lines 118-128). However, the current approach has gaps:
1. The scorer drops aggressively but has no safe fallback (can result in 0 items)
2. No "vehicle listing signal" requirement (year, mileage, VIN) to confirm real listings
3. Amazon results for vehicle queries are mostly accessories (Amazon doesn't sell cars)

## Changes

### 1. Create Vehicle Guardrails Module

**New file: `supabase/functions/_shared/vehicleGuardrails.ts`**

This module provides a single function `applyVehicleGuardrails(items, query)` that:

1. **Parts/Accessory Hard-Drop Filter**: Uses a compact multilingual keyword list to filter out parts and accessories from results. This list combines the most impactful keywords from the existing `MOTORS_PARTS_KEYWORDS` (motorsFilter.ts) and `VEHICLE_PARTS_HARD_DROP` (searchIntentScorer.ts), plus French equivalents:
   - Parts: "brake pad", "rotor", "filter", "oil", "spark plug", "alternator", etc.
   - Accessories: "floor mat", "seat cover", "key fob", "dash cam", "charger", etc.
   - French: "huile", "pneus", "jante", "batterie", "pompe", "joint", etc.
   - Broken/junk: "for parts", "not working", "broken", "as-is", "untested"

2. **Vehicle Listing Signal Requirement**: Keeps an item only if it has at least ONE vehicle-listing signal:
   - Year present (19xx/20xx pattern)
   - Mileage present (miles/mi/km)
   - VIN present
   - Body terms: sedan, suv, truck, pickup, coupe, hatchback, van
   - Listing format terms: "4D", "2D", "AWD", "FWD", "4x4"

3. **Safe Fallback (3 tiers)**:
   - If filtered results >= 20: return filtered results (strict mode worked)
   - If filtered results < 20: relax signal requirement (keep items from Motors categories even without year/miles)
   - If still < 20: fall back to unfiltered original merged list so user always sees something

### 2. Add `isVehicleLikeQuery()` Detection Function

**File: `supabase/functions/_shared/vehicleGuardrails.ts`**

A focused function that returns `true` only for strong vehicle signals (separate from the broad `isVehicleQuery` which matches brand names that may have non-vehicle meanings):

Strong signals (any one triggers):
- Standalone tokens: car, cars, suv, truck, pickup, van, vehicle, voiture, camion, 4x4
- Multi-word patterns: "model 3", "model y", "land cruiser", "range rover"
- Year pattern: `/\b(19|20)\d{2}\b/` in combination with any vehicle-related word
- Motorcycle words: moto, motorcycle, scooter, 150cc, 125cc, quad, atv
- VIN keyword

Uses the existing `wordishMatch()` token-aware boundary matching from `vehicleDetection.ts` to avoid substring bugs (no "google" matching "gle").

### 3. Integrate Guardrails into Search Orchestrator

**File: `supabase/functions/catalog-search/index.ts`**

After the existing scoring/ranking step (line ~835) and before the universal wrong-category guard (line ~840):

```
// Only for vehicle_listing intent
if (effectiveIntent.intentKey === "vehicle_listing") {
  const guardrailResult = applyVehicleGuardrails(finalItems, providerQuery);
  finalItems = guardrailResult.items;
  // Log guardrail outcome
}
```

This runs AFTER the existing `scoreAndRankItems()` which already does some vehicle_listing scoring, adding an extra safety layer with the signal requirement and safe fallback.

### 4. Cache Key: Add Mode Flag

**File: `supabase/functions/_shared/catalogCache.ts`**

- Bump `AMAZON_CACHE_VERSION` to `v15`
- The cache key already includes `vehicleMode` and `intentKey` (line 422 of index.ts), so vehicle-guardrailed results are already separated from normal searches. No structural cache key change needed -- just the version bump to flush old v14 entries.

### 5. eBay Fetcher: Remove $500 minPrice for Vehicle Buying Intent

**File: `supabase/functions/_shared/ebayFetcher.ts`**

Line 90 currently enforces `minPrice = 500` when `hasBuyingIntent && !isHeavyEquipment`. This was the old approach (pre-fetch price gating). Since we now have post-fetch guardrails with signal-based filtering, remove this:

```
// Before: const minPrice = (hasBuyingIntent && !isHeavyEquipment) ? 500 : undefined;
// After:  const minPrice = undefined; // Post-fetch guardrails handle filtering
```

This ensures we get the full set of eBay Motors results and let the guardrails filter intelligently post-fetch.

## Technical Details

### Vehicle Guardrails Function Signature

```typescript
interface GuardrailResult {
  items: CatalogItem[];
  mode: "strict" | "relaxed" | "fallback";
  dropped: number;
  reason: string;
}

function applyVehicleGuardrails(
  items: CatalogItem[],
  query: string,
  unfilteredItems?: CatalogItem[],  // original pre-scoring items for fallback
): GuardrailResult
```

### Parts Hard-Drop List (compact, bilingual)

```typescript
const VEHICLE_PARTS_DROP = [
  // Parts
  "parts","part","accessory","accessories","floor mat","mats","seat cover",
  "cover","charger","cable","brake","pads","rotor","filter","oil filter",
  "air filter","huile","pneus","tire","tires","battery","batterie",
  "alternator","alternateur","bumper","headlight","mirror","rim","jante",
  "wiper","spark plug","injecteur","pompe","gasket","joint","bearing",
  "suspension","shock","strut","radio","stereo","carplay","camera","dash cam",
  // Broken/junk
  "for parts","parts only","not working","broken","repair","as-is",
  "untested","read description",
];
```

### Vehicle Signal Detection

```typescript
function hasVehicleListingSignal(title: string): boolean {
  const t = title.toLowerCase();
  if (/(19|20)\d{2}/.test(t)) return true;
  if (/\b\d[\d,]*\s*(miles|mi|km|k\s*miles)\b/i.test(t)) return true;
  if (/\bvin\b/i.test(t)) return true;
  if (hasAny(t, ["sedan","suv","truck","pickup","coupe","hatchback","van","4d","2d","awd","fwd","4x4","rwd"])) return true;
  return false;
}
```

### Safe Fallback Logic

```typescript
// Tier 1: strict (parts-dropped + signal required)
let filtered = items.filter(i => !isPartAccessory(i) && hasVehicleListingSignal(i));
if (filtered.length >= 20) return { items: filtered, mode: "strict", ... };

// Tier 2: relaxed (parts-dropped only, no signal requirement)
filtered = items.filter(i => !isPartAccessory(i));
if (filtered.length >= 20) return { items: filtered, mode: "relaxed", ... };

// Tier 3: fallback (return original unfiltered list)
return { items: unfilteredItems || items, mode: "fallback", ... };
```

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/vehicleGuardrails.ts` | **NEW** — `isVehicleLikeQuery()`, `applyVehicleGuardrails()`, parts list, signal detection, safe fallback |
| `supabase/functions/catalog-search/index.ts` | Import + call `applyVehicleGuardrails` after scoring for `vehicle_listing` intent; pass unfiltered items for safe fallback |
| `supabase/functions/_shared/ebayFetcher.ts` | Remove `minPrice = 500` for buying intent (post-fetch guardrails replace it) |
| `supabase/functions/_shared/catalogCache.ts` | Bump `AMAZON_CACHE_VERSION` to `v15` |

## What is NOT Changed

- Non-vehicle queries are completely unaffected (guardrails only activate for `vehicle_listing` intent)
- Frontend: no changes
- AI refiner: no changes
- Provider fetching logic: both Amazon+eBay still called for all queries
- Intent classification: still runs as-is
- Cache key structure: no changes (version bump only)
- Response shape: no changes

## Expected Results

- "Tesla Model 3" returns actual vehicle listings (year/mileage in titles), not floor mats or brake pads
- "Toyota SUV" returns SUVs with year/price, not oil filters or seat covers
- "moto 150cc" returns motorcycles/scooters from eBay category 6024
- "google pixel" (non-vehicle) is completely unaffected by guardrails
- "iphone 11" (non-vehicle) is completely unaffected
- Never returns empty results due to guardrails if providers returned items (safe 3-tier fallback)
