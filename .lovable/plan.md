
# Fix Mobile Homepage Categories - Backend Hotfix

## Problem Identified
Mobile app shows "En vedette" (single section) instead of the 8 category sections (Téléphones, Véhicules, etc.) due to two critical backend issues:

### Issue 1: Bootstrap DB Query Failure (400 Error)
The `bootstrapFromDatabase()` function in both `catalog-home` and `catalog-home-v2` edge functions uses this query:
```
order=updated_at.desc.nullslast,created_at.desc
```
**Problem**: The `catalog_items` table does NOT have a `created_at` column, causing a 400 Bad Request.

### Issue 2: Cache Schema Version Mismatch
- Current cached rows have `schemaVersion = null` (or missing)
- Code requires `CACHE_SCHEMA_VERSION = 4`
- All cache is rejected → triggers bootstrap → bootstrap fails → empty sections

## Solution

### Step 1: Fix Bootstrap Query
**Files to modify:**
- `supabase/functions/catalog-home/index.ts` (line ~494)
- `supabase/functions/catalog-home-v2/index.ts` (line ~395)

Change from:
```typescript
order=updated_at.desc.nullslast,created_at.desc
```

To:
```typescript
order=updated_at.desc.nullslast
```

### Step 2: Regenerate Valid Cache
After fixing the bootstrap query:
1. The bootstrap will successfully fetch ~300 items from `catalog_items`
2. These will be used to build mobile sections (Phones, Electronics, Vehicles, etc.)
3. The cache will be saved with correct `schemaVersion: 4`

### Step 3: Deploy Edge Functions
Redeploy both functions:
- `catalog-home`
- `catalog-home-v2`

## Technical Details

### Current Bootstrap Query (Broken)
```
supabaseUrl/rest/v1/catalog_items?
  provider=in.(amazon,ebay)&
  price_usd=gt.0&
  image_url=neq.null&
  is_disallowed=eq.false&
  order=updated_at.desc.nullslast,created_at.desc&  ← FAILS: created_at doesn't exist
  limit=300
```

### Fixed Bootstrap Query
```
supabaseUrl/rest/v1/catalog_items?
  provider=in.(amazon,ebay)&
  price_usd=gt.0&
  image_url=neq.null&
  is_disallowed=eq.false&
  order=updated_at.desc.nullslast&  ← WORKS: only updated_at
  limit=300
```

### Database Verification
- `catalog_items` has 2,501 items available
- 2,500 have images, 2,501 have prices
- Query without `created_at` works correctly

## Files to Modify
1. `supabase/functions/catalog-home/index.ts` - Line 494
2. `supabase/functions/catalog-home-v2/index.ts` - Line 395

## Expected Outcome
After deployment:
1. Bootstrap query succeeds (no more 400 error)
2. Mobile gets 8 sections with proper titles (Téléphones, Véhicules, etc.)
3. Cache is regenerated with correct schema version
4. Web remains unchanged (single-feed behavior preserved)
