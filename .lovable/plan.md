

# Fix: "camry" Being Incorrectly Canonicalized to "camaro"

## Root Cause

The edge function logs reveal the bug:

```
[CACHE] Canonicalized query: "oyota camry" → "toyota camaro"
cache_key: "search:v4:q=toyota camaro:...vm=0"
```

**What's happening:**
1. User searches "toyota camry" (or "oyota camry" with typo)
2. "toyota" is correctly canonicalized
3. But "camry" is fuzzy-matched to "camaro" (Levenshtein distance = 2)
4. "toyota camaro" does NOT trigger `vehicleMode` detection properly
5. Cache key has `vm=0` (no vehicle mode), returns electronics

**Why "range rover" works but "toyota camry" doesn't:**
- "rover" is protected (line 79: `"rover": []`)
- "camry" is NOT protected, so fuzzy matching changes it to "camaro"

---

## Solution

Add "camry" and other popular vehicle model names as protected terms in the canonicalizer.

### File: `supabase/functions/_shared/queryCanonicalizer.ts`

Add these terms to the PROTECTED VEHICLE TERMS section (around lines 78-95):

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// PROTECTED VEHICLE TERMS: Prevent fuzzy matching to electronics
// These terms have empty arrays - they exist only to block fuzzy matches
// ═══════════════════════════════════════════════════════════════════════════
"rover": [],        // Prevent "rover" → "router"
"cherokee": [],     // Prevent unwanted fuzzy matches
"silverado": [],    // Prevent unwanted fuzzy matches
"escalade": [],     // Prevent unwanted fuzzy matches
"bronco": [],       // Prevent unwanted fuzzy matches
"mustang": [],      // Prevent unwanted fuzzy matches
"corvette": [],     // Prevent unwanted fuzzy matches
"camaro": [],       // Prevent unwanted fuzzy matches
"challenger": [],   // Prevent unwanted fuzzy matches (Dodge Challenger)
"navigator": [],    // Prevent unwanted fuzzy matches
"tahoe": [],        // Prevent unwanted fuzzy matches
"suburban": [],     // Prevent unwanted fuzzy matches
"wrangler": [],     // Prevent unwanted fuzzy matches
"gladiator": [],    // Prevent unwanted fuzzy matches
"prius": [],        // Prevent unwanted fuzzy matches
"miata": [],        // Prevent unwanted fuzzy matches

// NEW: Toyota models - prevent "camry" → "camaro" fuzzy match
"camry": [],        // Prevent "camry" → "camaro"
"corolla": [],      // Prevent unwanted fuzzy matches
"rav4": [],         // Prevent unwanted fuzzy matches
"highlander": [],   // Prevent unwanted fuzzy matches
"tacoma": [],       // Prevent unwanted fuzzy matches
"tundra": [],       // Prevent unwanted fuzzy matches
"sienna": [],       // Prevent unwanted fuzzy matches
"4runner": [],      // Prevent unwanted fuzzy matches

// Honda models
"civic": [],        // Prevent unwanted fuzzy matches
"accord": [],       // Prevent unwanted fuzzy matches
"pilot": [],        // Prevent unwanted fuzzy matches
"odyssey": [],      // Prevent unwanted fuzzy matches

// Nissan models
"altima": [],       // Prevent unwanted fuzzy matches
"sentra": [],       // Prevent unwanted fuzzy matches
"rogue": [],        // Prevent unwanted fuzzy matches
"pathfinder": [],   // Prevent unwanted fuzzy matches
"frontier": [],     // Prevent unwanted fuzzy matches

// Hyundai/Kia models
"elantra": [],      // Prevent unwanted fuzzy matches
"sonata": [],       // Prevent unwanted fuzzy matches
"tucson": [],       // Prevent unwanted fuzzy matches
"sportage": [],     // Prevent unwanted fuzzy matches
"telluride": [],    // Prevent unwanted fuzzy matches
"sorento": [],      // Prevent unwanted fuzzy matches
```

---

## Additional Fix: Clear Poisoned Cache

After deploying the fix, run this SQL to clear the incorrectly cached "camaro" entries:

```sql
DELETE FROM public.catalog_cache 
WHERE cache_type = 'search' 
  AND cache_key ILIKE '%camaro%';
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/queryCanonicalizer.ts` | Add popular vehicle model names as protected terms to prevent fuzzy matching |
| Database | Purge poisoned cache entries for "camaro" |

---

## Expected Behavior After Fix

| Query | Before (Broken) | After (Fixed) |
|-------|-----------------|---------------|
| "toyota camry" | "toyota camaro" → `vm=0` → phones ❌ | "toyota camry" → `vm=1` → cars ✅ |
| "camry" | "camaro" ❌ | "camry" ✅ |
| "honda civic" | "honda civic" ✅ | "honda civic" ✅ |
| "range rover" | "range rover" ✅ | "range rover" ✅ |

---

## Why This Works

By adding "camry" with an empty array `[]` to `CANONICAL_TERMS`:

1. `TYPO_TO_CANONICAL.set("camry", "camry")` is executed (line 151)
2. When canonicalizing "camry", direct lookup succeeds (line 226)
3. Fuzzy matching is skipped (never reaches line 230)
4. "camry" stays as "camry"
5. Vehicle detection correctly identifies "toyota camry" as make+model
6. `vehicleMode=true` → eBay category 6001 → actual vehicles returned

