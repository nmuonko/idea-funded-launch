

# Fix Vehicle Search: Smart Intent Detection to Avoid Empty Results

## Problem

Searching "infiniti qx80" takes forever and returns **0 results** because:

1. **"infiniti"** is in `VEHICLE_QUERY_KEYWORDS` → detected as vehicle intent
2. System enforces **`minPrice = $1500`** to "exclude parts"
3. Amazon returns 36 items (floor mats, filters, accessories) all priced **under $1500**
4. eBay returns 0 items (no matching eBay listings)
5. Post-filter removes ALL 36 Amazon items → **0 results displayed**

The user expected to see Infiniti QX80 **accessories** (like floor mats, cargo liners, etc.) but got nothing.

---

## Root Cause

The current logic in lines 714-718 assumes:
> "If query contains a car brand → user wants to buy a car → enforce $1500 minimum"

This is **wrong** for queries like:
- "infiniti qx80" → Could want accessories, not the vehicle
- "toyota camry floor mats" → Definitely wants accessories
- "ford f150 parts" → Definitely wants parts

---

## Solution: Smart Vehicle Intent Detection

Only enforce the $1500 minimum when the query **explicitly** indicates the user wants to buy a whole vehicle:

```text
Current (Wrong):
"infiniti qx80" → isVehicle=true → minPrice=$1500 → 0 results ❌

Fixed (Smart):
"infiniti qx80" → isVehicle=false (no "for sale" indicator) → no minPrice → 36 results ✓
"infiniti qx80 for sale" → isVehicle=true → minPrice=$1500 → vehicle results ✓
```

---

## Technical Changes

### File: `supabase/functions/catalog-search/index.ts`

**1. Add explicit vehicle-buying intent keywords:**

```typescript
// Keywords that indicate user wants to BUY a vehicle (not parts/accessories)
const VEHICLE_BUYING_INTENT_KEYWORDS = [
  "for sale", "à vendre", "buy", "acheter", "purchase",
  "used car", "new car", "certified pre-owned", "cpo",
  "dealer", "dealership", "financing", "lease",
];
```

**2. Create a smarter vehicle intent check:**

```typescript
function hasVehicleBuyingIntent(query: string): boolean {
  const lower = query.toLowerCase();
  
  // Check if query has explicit buying intent
  const hasBuyingIntent = VEHICLE_BUYING_INTENT_KEYWORDS.some(kw => lower.includes(kw));
  if (hasBuyingIntent) return true;
  
  // Check if query is JUST a brand/model (without accessory keywords)
  const hasAccessoryKeywords = [
    "floor mat", "mat", "cover", "case", "filter", "oil",
    "brake", "part", "parts", "accessory", "accessories",
    "key fob", "remote", "battery", "tire", "wheel",
    "seat cover", "cargo", "liner", "sunshade", "visor",
  ].some(kw => lower.includes(kw));
  
  // If query has accessory keywords, NOT vehicle buying intent
  if (hasAccessoryKeywords) return false;
  
  // For brand-only queries like "infiniti qx80", don't assume vehicle intent
  // Let them see all products (accessories + vehicles if any)
  return false;
}
```

**3. Update the minPrice enforcement logic:**

```typescript
// OLD (lines 714-718):
if (isVehicleEarly && (catalogFilters.minPrice === undefined || catalogFilters.minPrice < 1500)) {
  catalogFilters.minPrice = 1500;
}

// NEW:
const hasBuyingIntent = hasVehicleBuyingIntent(qOriginal);
if (hasBuyingIntent && (catalogFilters.minPrice === undefined || catalogFilters.minPrice < 1500)) {
  catalogFilters.minPrice = 1500;
  console.log(`[SEARCH] requestId=${requestId} Vehicle BUYING intent detected: enforcing minPrice=$1500`);
} else if (isVehicleEarly) {
  console.log(`[SEARCH] requestId=${requestId} Vehicle brand detected but no buying intent - allowing all prices`);
}
```

---

## Expected Results

| Query | Before | After |
|-------|--------|-------|
| "infiniti qx80" | 0 results (all filtered) | 36 results (accessories) |
| "infiniti qx80 for sale" | Vehicle results | Vehicle results (unchanged) |
| "toyota camry floor mats" | 0 results | Floor mat results |
| "used tesla model 3" | Vehicle results | Vehicle results (unchanged) |
| "honda civic" | 0 results | Accessories + any vehicles |

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Add `VEHICLE_BUYING_INTENT_KEYWORDS`, create `hasVehicleBuyingIntent()`, update minPrice logic |

---

## Alternative Considered: Remove minPrice Entirely

We could remove the $1500 minimum entirely, but this would:
- Show car floor mats when someone searches "toyota for sale" 
- Mix low-cost accessories with actual vehicle listings
- Degrade the experience for users who DO want to buy vehicles

The smart intent detection approach preserves both use cases.

