
# Fix: Homepage Not Updating After Home Curation Changes

## Root Cause Analysis

I've identified **5 critical issues** preventing the homepage from updating:

### Issue 1: Edge Functions Not Deployed
The edge functions are running **outdated cached code**. Error logs show:
- `admin-home-sections`: `logAdminAction` export not found (but the code now has it)
- `catalog-prewarm-worker`: `HOME_PREWARM_SECTIONS is not defined` (but the code now uses `loadSectionConfig`)

**Result**: All admin operations fail silently, no seeds are saved.

### Issue 2: Seeds Table is Empty
```sql
SELECT * FROM home_section_seeds; -- Returns 0 rows
```
Because the `admin-home-seeds` function fails to boot, no seeds are ever written.

### Issue 3: Prewarm Jobs Stuck in "pending"
```text
Job fe46048d: status=pending, sections_completed=0, started_at=NULL
```
The worker triggered but crashed immediately due to the undefined constant error.

### Issue 4: catalog-home Uses Hardcoded Sections
The endpoint reads from a **static array** instead of the database:

```typescript
// catalog-home/index.ts (lines 124-209)
const HOME_SECTIONS: HomeSectionConfig[] = [
  { key: "phones", seedQueries: ["iphone 15", "samsung galaxy", "tecno camon"], ... },
  { key: "vehicles", seedQueries: ["used car for sale", "toyota camry"], ... },
  // ... hardcoded, never reads from home_sections or home_section_seeds
];
```

Even if seeds were saved in the database, catalog-home wouldn't use them!

### Issue 5: Prewarm Cache is Empty
```sql
SELECT * FROM catalog_cache WHERE cache_key LIKE 'home:%'; -- Returns 0 rows
```
The prewarm job never completed successfully, so no cache entries exist.

---

## Solution

### Step 1: Redeploy Edge Functions (Critical)

Force redeploy these functions to push the corrected code:
- `admin-home-sections`
- `admin-home-seeds`
- `admin-home-seed-suggestions`
- `catalog-prewarm-worker`

### Step 2: Update catalog-home to Read from Database

Modify `catalog-home/index.ts` to:
1. Load enabled sections from `home_sections` table
2. Use the database configuration instead of hardcoded array
3. Fall back to hardcoded array only if database is empty

```typescript
// Load sections from database instead of hardcoded array
const { data: dbSections } = await supabase
  .from("home_sections")
  .select("*")
  .eq("enabled", true)
  .order("sort_order", { ascending: true });

const HOME_SECTIONS_DYNAMIC = dbSections?.length > 0
  ? dbSections.map(s => ({
      key: s.key,
      categoryKey: s.default_category_key || s.key,
      title: s.title_en, // or s.title_fr based on locale
      seedQueries: [], // Not used - prewarm handles fetching
      ebayCategory: s.ebay_category || "",
      // ... map other fields
    }))
  : HOME_SECTIONS; // Fall back to hardcoded
```

### Step 3: Clean Up Failed Jobs

Reset stuck pending jobs so new ones can be created:

```sql
UPDATE prewarm_jobs 
SET status = 'failed', 
    error_message = 'Reset due to deployment issues',
    completed_at = NOW()
WHERE status IN ('pending', 'processing') 
  AND started_at IS NULL;
```

### Step 4: Force Query Invalidation in Admin UI

After saving seeds, the admin UI should:
1. Call the API to save the seed
2. **Wait for confirmation**
3. **Immediately refetch** the seeds list

```typescript
// HomeCuration.tsx - After successful seed add
if (response.data?.ok) {
  // Force immediate refetch
  await fetchSeeds(selectedSection);
  await fetchSections(); // Refresh counts
  toast({ title: "Success", description: "Seed query added" });
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/catalog-home/index.ts` | Load sections from `home_sections` DB table instead of hardcoded array |
| `supabase/functions/admin-home-sections/index.ts` | (Redeploy only) |
| `supabase/functions/admin-home-seeds/index.ts` | (Redeploy only) |
| `supabase/functions/admin-home-seed-suggestions/index.ts` | (Redeploy only) |
| `supabase/functions/catalog-prewarm-worker/index.ts` | (Redeploy only) |

---

## Data Flow After Fix

```text
Admin opens Home Curation
       │
       ▼
admin-home-sections (GET) → Loads from home_sections table ✓
       │
       ▼
Admin adds seed "Toyota RAV4" for vehicles section
       │
       ▼
admin-home-seeds (POST) → Inserts into home_section_seeds ✓
       │
       ▼
Admin clicks "Publish Now"
       │
       ▼
catalog-prewarm-home → Creates job → Triggers worker
       │
       ▼
catalog-prewarm-worker:
  - Loads sections from home_sections ✓
  - Loads seeds from home_section_seeds ✓
  - Fetches Amazon + eBay items
  - Writes to catalog_cache with key "home:vehicles:2026-01-31-b1:mixed"
       │
       ▼
catalog-home (GET):
  - Loads sections from home_sections ✓ (NEW!)
  - Reads from catalog_cache using same key
  - Returns fresh content with "Toyota RAV4" results
```

---

## Testing Checklist

1. Verify edge functions boot without errors in logs
2. Add a seed query in Home Curation UI → Verify it appears in `home_section_seeds` table
3. Click "Publish Now" → Verify job completes (status = "completed")
4. Check `catalog_cache` for `home:*` entries
5. Load homepage → Verify new content appears

---

## Why This Wasn't Working Before

The plan was implemented but:
1. Edge function deployments silently failed or cached old code
2. `catalog-home` was never updated to read from the database
3. Both worker and home endpoint were using hardcoded sections
4. Without the database integration, the curated seed queries were never used
