
# Fix Toyota Vehicle Search (Backend Only)

## Problem Summary
When users search for "Toyota", the system returns phones/electronics instead of vehicles. Other brands like BMW, Mercedes, and Cadillac work correctly.

## Root Cause Analysis

After examining the codebase, I found **two issues**:

### 1. Poisoned Cache Entry
There is a cached entry with `vm=0` (vehicleMode=false) for Toyota:
```
cache_key: search:v4:q=toyota:p=mixed:cat=:pg=1:sz=36:vm=0:mp=0:ex=0
```
This was created before the dynamic probe system was in place, and it's being served instead of triggering fresh vehicle detection.

### 2. Toyota Not in STANDALONE_VEHICLE_PATTERNS
Looking at line 269-297 of `catalog-search/index.ts`, only **luxury/premium brands** are listed in `STANDALONE_VEHICLE_PATTERNS`:
- Cadillac, Lincoln, Lexus, Porsche, Tesla, Jeep, Ferrari, etc.

**Toyota, Honda, Ford, Nissan** (mainstream brands) are NOT in this list. So:
- Single-word query "toyota" → relies on dynamic probe
- Probe was cached incorrectly → returns vm=0 → phones shown

---

## Technical Implementation Plan

### Step 1: Purge All Toyota Cache Entries (SQL Migration)

Delete poisoned cache entries from **both** cache tables:

```sql
-- Delete Toyota search cache entries
DELETE FROM public.catalog_cache 
WHERE cache_key ILIKE '%toyota%';

-- Delete Toyota probe cache entries  
DELETE FROM public.catalog_cache
WHERE cache_key ILIKE 'vehicle_probe%toyota%';

-- Delete from search_proxy_cache if exists
DELETE FROM public.search_proxy_cache 
WHERE cache_key ILIKE '%toyota%';

-- Also clear other mainstream brands that might be poisoned
DELETE FROM public.catalog_cache
WHERE cache_type = 'search'
AND (
  cache_key ILIKE '%honda%' OR
  cache_key ILIKE '%nissan%' OR
  cache_key ILIKE '%ford%' OR
  cache_key ILIKE '%chevrolet%' OR
  cache_key ILIKE '%chevy%' OR
  cache_key ILIKE '%hyundai%' OR
  cache_key ILIKE '%kia%' OR
  cache_key ILIKE '%mazda%' OR
  cache_key ILIKE '%subaru%'
);
```

### Step 2: Add Mainstream Brands to STANDALONE_VEHICLE_PATTERNS

**File:** `supabase/functions/catalog-search/index.ts`

Add a new section after the luxury brands (around line 297):

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// MAINSTREAM BRANDS: Major car manufacturers - standalone = vehicle intent
// These brands are strongly associated with vehicles
// ═══════════════════════════════════════════════════════════════════════════
/\btoyota\b/i,
/\bhonda\b/i,
/\bnissan\b/i,
/\bford\b/i,
/\bchevrolet\b/i,
/\bchevy\b/i,
/\bdodge\b/i,
/\bram\b/i,
/\bgmc\b/i,
/\bbmw\b/i,
/\bmercedes\b/i,
/\baudi\b/i,
/\bvolkswagen\b/i,
/\bvw\b/i,
/\bhyundai\b/i,
/\bkia\b/i,
/\bmazda\b/i,
/\bsubaru\b/i,
/\bvolvo\b/i,
/\bchrysler\b/i,
/\bpeugeot\b/i,
/\brenault\b/i,
```

### Step 3: Improve Probe Caching Reliability

**File:** `supabase/functions/catalog-search/index.ts` (function `probeEbayVehicleCategory`)

Only cache probe results when the probe **succeeds** and items can be parsed:

```typescript
// Around lines 544-565, replace with:

// Cache probe result for 24 hours ONLY if probe succeeded
if (probeSuccess && vehiclesFound !== undefined) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const staleAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  
  supabase.from("catalog_cache").upsert({
    cache_key: probeKey,
    cache_type: "search",
    response: result,
    expires_at: expiresAt,
    stale_at: staleAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "cache_key" }).then(() => {
    console.log(JSON.stringify({
      event: "[VEHICLE_PROBE]",
      qNorm: query,
      ok: true,
      vehiclesFound,
      decision: vehicleMode ? "vehicle" : "non_vehicle",
      cached: true,
      requestId,
    }));
  });
} else {
  console.log(JSON.stringify({
    event: "[VEHICLE_PROBE]",
    qNorm: query,
    ok: false,
    vehiclesFound: 0,
    decision: "fallback_non_vehicle",
    cached: false,
    reason: "probe_failed_or_unparsed",
    requestId,
  }));
}
```

### Step 4: Add Toyota to Protected Terms (Canonicalizer)

**File:** `supabase/functions/_shared/queryCanonicalizer.ts`

Toyota is already in the file with typo corrections (line 45). This is correct - no changes needed. The existing entry already protects "toyota" from fuzzy matching to other terms.

### Step 5: Deploy Edge Function

Redeploy `catalog-search` after making the code changes.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_fix_toyota_cache.sql` | SQL migration to purge poisoned cache |
| `supabase/functions/catalog-search/index.ts` | Add mainstream brands to STANDALONE_VEHICLE_PATTERNS |
| `supabase/functions/catalog-search/index.ts` | Improve probe caching to only cache on success |

---

## Verification Tests

After implementation, verify in the app:

**Should Show Vehicles:**
- "toyota" → vehicles
- "honda" → vehicles  
- "nissan" → vehicles
- "ford" → vehicles
- "peugeot" → vehicles
- "toyota camry" → vehicles

**Should Show Accessories/Merch (NOT vehicles):**
- "toyota floor mats" → floor mats
- "toyota shirt" → clothing
- "toyota keychain" → keychains
- "honda phone case" → phone cases
- "ford hat" → hats

---

## Why This Approach Works

1. **Standalone patterns** trigger vehicle mode IMMEDIATELY for brand-only queries - no probe needed
2. **Accessory keywords still override** - checked FIRST in `isVehicleMakeModelQuery()`
3. **Cache purge** removes old poisoned entries
4. **Reliable probe caching** prevents future poisoning if probe fails
5. **No frontend changes** - all logic is backend-only
