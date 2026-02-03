
# Dynamic Vehicle Detection for All Makes/Models

## Problem Summary
Searches like "range rover", "grand cherokee", "f-150" return accessories instead of vehicles because:
1. Current `isVehicleMakeModelQuery()` requires BOTH a brand AND a separate model to trigger vehicle mode
2. "Range Rover" is the model name itself (not "Land Rover + Range Rover")
3. Many iconic vehicles are searched as standalone names: "Mustang", "Corvette", "Wrangler", "Cybertruck"

## Solution: Regex-Based Standalone Vehicle Detection

### 1. Add `STANDALONE_VEHICLE_PATTERNS` List

**File: `supabase/functions/catalog-search/index.ts`**

Add a new const after `VEHICLE_MODEL_PATTERNS` (around line 174):

```typescript
// ══════════════════════════════════════════════════════════════════════════════
// STANDALONE VEHICLE NAMES: These trigger vehicle mode by themselves
// These are complete vehicle identifiers that don't need a brand prefix
// e.g., "Range Rover", "F-150", "Model 3", "Mustang", "Corvette"
// ══════════════════════════════════════════════════════════════════════════════
const STANDALONE_VEHICLE_PATTERNS: RegExp[] = [
  // Land Rover / Range Rover models
  /\brange\s*rover\b/i,
  /\bland\s*rover\b/i,
  // Tesla models (often searched without "tesla" prefix)
  /\bmodel\s*3\b/i,
  /\bmodel\s*s\b/i,
  /\bmodel\s*x\b/i,
  /\bmodel\s*y\b/i,
  /\bcybertruck\b/i,
  // Ford trucks
  /\bf[-\s]?150\b/i,
  /\bf[-\s]?250\b/i,
  /\bf[-\s]?350\b/i,
  // Jeep models
  /\bgrand\s*cherokee\b/i,
  /\bwrangler\b/i,
  /\bgladiator\b/i,
  // Chevrolet trucks/SUVs
  /\bsilverado\b/i,
  /\btahoe\b/i,
  /\bsuburban\b/i,
  // Dodge/Ram
  /\bram\s*1500\b/i,
  /\bram\s*2500\b/i,
  /\bram\s*3500\b/i,
  /\bchallenger\b/i,
  /\bcharger\b/i,
  // Sports cars
  /\bmustang\b/i,
  /\bcorvette\b/i,
  /\bcamaro\b/i,
  /\bgt[-\s]?r\b/i,
  // Luxury SUVs
  /\bescalade\b/i,
  /\bnavigator\b/i,
  /\bg[-\s]?wagon\b/i,
  // Classic/iconic
  /\bbronco\b/i,
  /\bprius\b/i,
  /\bmiata\b/i,
  /\b911\b/i,  // Porsche 911
];
```

### 2. Add Extended Toy/Accessory Keywords

**File: `supabase/functions/catalog-search/index.ts`**

Add after `VEHICLE_ACCESSORY_KEYWORDS` (around line 138):

```typescript
// Extended list of toy/accessory keywords for post-filtering vehicle results
const VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS = [
  // Toys and models
  "matchbox", "diecast", "die-cast", "die cast", "hot wheels", "hotwheels",
  "1:64", "1:43", "1:24", "1:18", "1:12", "1/64", "1/43", "1/24", "1/18",
  "toy", "lego", "rc", "remote control", "model car", "toy car", "scale model",
  "miniature", "collectible", "replica",
  // Vehicle accessories
  "floor mat", "floor mats", "mat set",
  "key fob", "key cover", "fob cover", "remote cover",
  "wiper", "wipers", "wiper blade",
  "sunshade", "sun shade", "windshield cover",
  "car cover", "seat cover", "seat covers",
  "emblem", "badge", "decal", "sticker",
  "led", "light", "lights", "headlight", "taillight", "bulb",
  // Phone accessories often have car names
  "phone case", "phone holder", "car mount", "phone mount",
  // Decorative items
  "poster", "wall art", "canvas", "print", "artwork",
];
```

### 3. Update `isVehicleMakeModelQuery()` Function

**File: `supabase/functions/catalog-search/index.ts`**

Replace the existing function (lines 187-205):

```typescript
/**
 * Check if a query indicates vehicle buying intent using:
 * A) Standalone vehicle names (Range Rover, F-150, etc.)
 * B) Brand + model combinations (Infiniti QX80, Toyota Camry)
 * 
 * Returns TRUE only if:
 * - Query matches a standalone pattern OR brand+model combination
 * - AND query does NOT contain accessory/toy keywords
 */
function isVehicleMakeModelQuery(query: string): boolean {
  const lower = query.toLowerCase().trim();
  
  // Check for accessory/toy keywords FIRST - these override everything
  const hasAccessoryKeywords = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => lower.includes(kw));
  if (hasAccessoryKeywords) {
    const matchedKeyword = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.find(kw => lower.includes(kw));
    console.log(JSON.stringify({
      event: "[VEHICLE_DETECT] accessory_override",
      query,
      keyword: matchedKeyword,
    }));
    return false;
  }
  
  // A) Check for standalone vehicle names (Range Rover, F-150, Model 3, etc.)
  for (const pattern of STANDALONE_VEHICLE_PATTERNS) {
    if (pattern.test(lower)) {
      console.log(JSON.stringify({
        event: "[VEHICLE_DETECT] standalone_match",
        pattern: pattern.source,
        query,
      }));
      return true;
    }
  }
  
  // B) Check for brand + model combinations (existing logic)
  for (const { brand, models } of VEHICLE_MODEL_PATTERNS) {
    const brandRegex = new RegExp(`\\b${brand}\\b`, 'i');
    if (brandRegex.test(lower)) {
      for (const model of models) {
        if (lower.includes(model)) {
          console.log(JSON.stringify({
            event: "[VEHICLE_DETECT] make_model_match",
            brand,
            model,
            query,
          }));
          return true;
        }
      }
    }
  }
  
  return false;
}
```

### 4. Enhance Post-Filter for Vehicle Results

**File: `supabase/functions/catalog-search/index.ts`**

Update the defensive post-filter in cache hit path (around lines 1143-1170) to use the extended keyword list:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// VEHICLE CACHE POISONING FIX (DEFENSIVE FILTER):
// Always enforce minPrice for vehicle searches even on cache hits
// ═══════════════════════════════════════════════════════════════════════════
if (hasBuyingIntent && cachedItems.length > 0) {
  const beforeVehicleFilter = cachedItems.length;
  cachedItems = cachedItems.filter((item: any) => {
    const price = item.priceUsd ?? item.price_usd ?? 0;
    return price >= 1000;
  });
  
  // Filter out toys and accessories by title
  cachedItems = cachedItems.filter((item: any) => {
    const title = (item.title || "").toLowerCase();
    return !VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => title.includes(kw));
  });
  
  if (beforeVehicleFilter !== cachedItems.length) {
    console.log(JSON.stringify({
      event: "[CATALOG_SEARCH] vehicle_post_filter",
      before: beforeVehicleFilter,
      after: cachedItems.length,
      minPriceUsed: 1000,
      requestId,
    }));
  }
}
```

### 5. Add Query Canonicalizer Mappings

**File: `supabase/functions/_shared/queryCanonicalizer.ts`**

Add new entries to `CANONICAL_TERMS` (around line 70):

```typescript
// Range Rover / Land Rover (commonly searched vehicle names)
"range rover": ["rangerover", "range rove", "rang rover", "rnage rover", "range rver"],
"land rover": ["landrover", "land rove", "lanr rover", "lnad rover"],
// Ford trucks
"f-150": ["f150", "f 150"],
"f-250": ["f250", "f 250"],
"f-350": ["f350", "f 350"],
// Jeep models
"grand cherokee": ["grandcherokee", "grand cheroki", "grand cheroke"],
"wrangler": ["wranler", "wranglr", "wrangeler"],
// Tesla models
"cybertruck": ["cyber truck", "cybertruk", "cybertuck"],
```

### 6. Ensure eBay Category 6001 is Forced for Vehicle Mode

This is already implemented correctly in the code (lines 768-773):
```typescript
if (hasBuyingIntent && !ebayCategory) {
  ebayCategory = "6001"; // Cars & Trucks category
  console.log(`[SEARCH] requestId=${requestId} Vehicle BUYING intent detected, forcing category=6001 for query="${query}"`);
}
```

### 7. Database: Purge Poisoned Cache Entries

Execute SQL migration to delete `vm=0` entries for newly supported standalone vehicle names:

```sql
-- Purge poisoned cache entries for standalone vehicle names
DELETE FROM public.catalog_cache 
WHERE cache_type = 'search' 
  AND cache_key LIKE '%vm=0%'
  AND (
    cache_key ILIKE '%range%rover%' OR
    cache_key ILIKE '%land%rover%' OR
    cache_key ILIKE '%grand%cherokee%' OR
    cache_key ILIKE '%wrangler%' OR
    cache_key ILIKE '%gladiator%' OR
    cache_key ILIKE '%f-150%' OR
    cache_key ILIKE '%f150%' OR
    cache_key ILIKE '%f%150%' OR
    cache_key ILIKE '%model%3%' OR
    cache_key ILIKE '%model%s%' OR
    cache_key ILIKE '%model%x%' OR
    cache_key ILIKE '%model%y%' OR
    cache_key ILIKE '%cybertruck%' OR
    cache_key ILIKE '%silverado%' OR
    cache_key ILIKE '%tahoe%' OR
    cache_key ILIKE '%suburban%' OR
    cache_key ILIKE '%mustang%' OR
    cache_key ILIKE '%corvette%' OR
    cache_key ILIKE '%camaro%' OR
    cache_key ILIKE '%challenger%' OR
    cache_key ILIKE '%charger%' OR
    cache_key ILIKE '%escalade%' OR
    cache_key ILIKE '%navigator%' OR
    cache_key ILIKE '%bronco%' OR
    cache_key ILIKE '%miata%' OR
    cache_key ILIKE '%g-wagon%' OR
    cache_key ILIKE '%ram%1500%' OR
    cache_key ILIKE '%ram%2500%'
  );
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Add `STANDALONE_VEHICLE_PATTERNS`, `VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS`, update `isVehicleMakeModelQuery()`, enhance post-filter |
| `supabase/functions/_shared/queryCanonicalizer.ts` | Add typo mappings for Range Rover, Land Rover, F-150, etc. |
| Database | Purge `vm=0` cache entries for standalone vehicle names |

---

## Expected Behavior After Fix

| Query | Detection Method | vehicleMode | Category | Results |
|-------|-----------------|-------------|----------|---------|
| "range rover" | Standalone pattern | `true` | 6001 | Range Rover vehicles |
| "range rover sport" | Standalone pattern | `true` | 6001 | Range Rover Sport |
| "range rover floor mats" | Accessory override | `false` | All | Floor mat accessories |
| "f-150" | Standalone pattern | `true` | 6001 | Ford F-150 trucks |
| "f150 for sale" | Standalone pattern | `true` | 6001 | Ford F-150 |
| "grand cherokee" | Standalone pattern | `true` | 6001 | Jeep Grand Cherokees |
| "model 3" | Standalone pattern | `true` | 6001 | Tesla Model 3 |
| "mustang" | Standalone pattern | `true` | 6001 | Ford Mustangs |
| "corvette" | Standalone pattern | `true` | 6001 | Chevrolet Corvettes |
| "infiniti qx80" | Brand + Model | `true` | 6001 | Infiniti QX80 |
| "mustang diecast" | Accessory override | `false` | All | Diecast models |

---

## Technical Details

### Detection Flow
```text
1. User searches "range rover"
2. canonicalizeQuery("range rover") → "range rover"
3. isVehicleMakeModelQuery("range rover"):
   a. Check VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS → no matches
   b. Check STANDALONE_VEHICLE_PATTERNS → /\brange\s*rover\b/i MATCHES
   c. Log: {"event":"[VEHICLE_DETECT] standalone_match","pattern":"range\\s*rover","query":"range rover"}
   d. Return TRUE
4. hasBuyingIntent = true
5. catalogFilters.minPrice = 1000
6. ebayCategory = "6001" (Cars & Trucks)
7. Cache key: search:v3:q=range rover:...:vm=1:mp=1000:...
8. Results: Actual Range Rover vehicles ($15k+)
```

### Logging Examples
```json
{"event":"[VEHICLE_DETECT] standalone_match","pattern":"range\\s*rover","query":"range rover"}
{"event":"[VEHICLE_DETECT] standalone_match","pattern":"f[-\\s]?150","query":"f-150"}
{"event":"[VEHICLE_DETECT] accessory_override","query":"range rover floor mats","keyword":"floor mat"}
{"event":"[VEHICLE_DETECT] make_model_match","brand":"infiniti","model":"qx80","query":"infiniti qx80"}
{"event":"[CATALOG_SEARCH] vehicle_post_filter","before":36,"after":28,"minPriceUsed":1000}
```
