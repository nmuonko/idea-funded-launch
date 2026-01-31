
# Fix: Homepage Not Updating After Adding Seeds

## Root Cause

The `catalog_cache` table has a **CHECK constraint** that only allows these values for `cache_type`:

```sql
CHECK ((cache_type = ANY (ARRAY['home', 'search', 'product', 'offers'])))
```

The `catalog-prewarm-worker` is trying to insert cache entries with these cache types:
- `home_amazon`
- `home_ebay`
- `home_mixed`

**These are all rejected by the constraint**, causing the upserts to silently fail (the code doesn't check the result). This is why:
- Jobs appear as "completed" in the dashboard
- The worker logs show sections being processed with hundreds of items
- But the `catalog_cache` table has zero `home:` entries

---

## Solution

### Option A: Update the CHECK Constraint (Recommended)

Add the new cache types to the allowed values:

```sql
ALTER TABLE public.catalog_cache 
DROP CONSTRAINT catalog_cache_cache_type_check;

ALTER TABLE public.catalog_cache 
ADD CONSTRAINT catalog_cache_cache_type_check 
CHECK ((cache_type = ANY (ARRAY[
  'home', 'search', 'product', 'offers',
  'home_amazon', 'home_ebay', 'home_mixed'
])));
```

### Option B: Worker uses existing 'home' type

Change the worker to use `cache_type: "home"` instead of granular types. However, this loses the ability to query cached items by provider type separately.

---

## Additional Fix: Add Error Handling to Worker

The worker should check upsert results and log errors:

```typescript
// Current (silent failure)
await supabase.from("catalog_cache").upsert({...}, { onConflict: "cache_key" });

// Fixed (with error logging)
const { error } = await supabase.from("catalog_cache").upsert({...}, { onConflict: "cache_key" });
if (error) {
  console.error(`[WORKER] Cache upsert failed for ${section.key}:`, error);
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| Database Migration | Add new cache types to CHECK constraint |
| `supabase/functions/catalog-prewarm-worker/index.ts` | Add error checking for cache upserts |

---

## Testing After Fix

1. Run the database migration to update the constraint
2. Redeploy `catalog-prewarm-worker` with error logging
3. Click "Publish Now" in Home Curation
4. Wait for job to complete
5. Verify cache entries exist: `SELECT * FROM catalog_cache WHERE cache_key LIKE 'home:%'`
6. Load homepage → Should now show curated content

---

## Why This Wasn't Caught Earlier

1. The worker completed successfully because it didn't check upsert errors
2. The job status showed "completed" based on item counts, not cache writes
3. The `catalog-home` endpoint fell back to live eBay queries gracefully
4. No error logs were generated because the constraint violation wasn't caught
