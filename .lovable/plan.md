
# Fix: Vehicle Detection Must Use Canonicalized Query

## Root Cause Analysis

The investigation revealed a **query ordering bug** in `catalog-search/index.ts`:

| Step | Current (Broken) | Should Be |
|------|------------------|-----------|
| 1 | User types "inifiniti qx80" | Same |
| 2 | **Check vehicle intent with ORIGINAL query** | Canonicalize first |
| 3 | `isVehicleMakeModelQuery("inifiniti qx80")` → `false` | `isVehicleMakeModelQuery("infiniti qx80")` → `true` |
| 4 | `vehicleMode = false` | `vehicleMode = true` |
| 5 | Cache key: `vm=0` (accessories cached) | Cache key: `vm=1` (vehicles cached) |

**Evidence from database:**
```
cache_key: search:v3:q=infiniti qx80:p=mixed:cat=:pg=1:sz=36:vm=0:mp=0:ex=0
query column: "inifiniti qx80" (typo!)
```

The cache key was canonicalized (`q=infiniti qx80`), but `vm=0` because vehicle detection ran BEFORE canonicalization.

---

## Solution

### 1. Apply Query Canonicalization BEFORE Vehicle Detection

**File: `supabase/functions/catalog-search/index.ts`**

Move the canonicalization step earlier so vehicle detection uses the corrected query:

```text
Current flow (lines 868-888):
1. qOriginal = raw user input
2. qNormEarly = qOriginal.toLowerCase().replace(/\s+/g, " ")
3. isVehicleEarly = isVehicleQuery(qNormEarly)
4. hasBuyingIntent = hasVehicleBuyingIntent(qOriginal)  ← BUG: uses uncanonicalized query

Fixed flow:
1. qOriginal = raw user input  
2. qCanonicalized = canonicalizeQuery(qOriginal)  ← NEW: early canonicalization
3. qNormEarly = qCanonicalized.toLowerCase().replace(/\s+/g, " ")
4. isVehicleEarly = isVehicleQuery(qNormEarly)
5. hasBuyingIntent = hasVehicleBuyingIntent(qCanonicalized)  ← FIX: uses canonicalized query
```

### 2. Import and Use Query Canonicalizer

Add the import at the top of the file:
```typescript
import { canonicalizeQuery } from "../_shared/queryCanonicalizer.ts";
```

Then update the early detection block (around lines 868-888):
```typescript
// ─── EARLY VEHICLE DETECTION & PRICE FILTER OVERRIDE ────────────────────────
// Canonicalize query FIRST so vehicle detection works on corrected typos
// e.g., "inifiniti qx80" → "infiniti qx80" before checking for vehicle intent
const qCanonicalized = canonicalizeQuery(qOriginal);
const qNormEarly = qCanonicalized.toLowerCase().replace(/\s+/g, " ");
const isVehicleEarly = isVehicleQuery(qNormEarly);

// ... maxPrice override logic stays the same ...

// SMART VEHICLE INTENT: Use canonicalized query for detection
// This ensures typos like "inifiniti" still match "infiniti" brand
const hasBuyingIntent = hasVehicleBuyingIntent(qCanonicalized);
const hasMakeModel = isVehicleMakeModelQuery(qCanonicalized);
```

### 3. Purge Poisoned Cache Entries

After deploying the fix, the existing `vm=0` cache entries for vehicle queries must be deleted:

```sql
DELETE FROM public.catalog_cache 
WHERE cache_type = 'search' 
  AND cache_key LIKE '%vm=0%'
  AND (
    cache_key ILIKE '%infiniti%' OR
    cache_key ILIKE '%toyota%' OR
    cache_key ILIKE '%honda%' OR
    cache_key ILIKE '%bmw%' OR
    cache_key ILIKE '%mercedes%' OR
    cache_key ILIKE '%lexus%'
  );
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Import `canonicalizeQuery`, apply canonicalization before vehicle detection |
| Database | Purge `vm=0` cache entries for vehicle brand queries |

---

## Expected Behavior After Fix

| User Input | Canonicalized | vehicleMode | minPrice | Results |
|------------|---------------|-------------|----------|---------|
| "inifiniti qx80" | "infiniti qx80" | `true` | $1000 | Vehicles ($11k+) |
| "infiniti qx80" | "infiniti qx80" | `true` | $1000 | Vehicles ($11k+) |
| "infiniti qx80 floor mats" | "infiniti qx80 floor mats" | `false` | none | Floor mats ($10-50) |

---

## Technical Details

### Why This Happens
The `queryCanonicalizer.ts` correctly maps typos:
```typescript
"infiniti": ["infinti", "infinty", "inifiniti", "infintii", "infniti", "infinitie"]
```

But this canonicalization was only applied AFTER vehicle detection, making it useless for fixing the vehicleMode flag.

### Logging Added
After the fix, logs will show:
```
[CATALOG_SEARCH] query_canonicalized: "inifiniti qx80" → "infiniti qx80"
[VEHICLE_DETECT] Make+Model detected: brand="infiniti" model="qx80" in query="infiniti qx80"
```
