

# Fix eBay Images - Enable Catalog for Internal Fetch Calls

## Problem Identified

The root cause of the persistent image issue has been found:

**The `production` environment in the database has `catalog_enabled = false`**

This means when `mediaCache.ts` makes internal calls to `catalog-product` (even with the `x-afrishop-environment: production` header), the request is immediately rejected with `CATALOG_DISABLED` before any eBay API call is made.

Evidence from logs:
```
[CATALOG_PRODUCT] id=v1|157299757552|458921765069 provider=ebay error=CATALOG_DISABLED
```

Current database state:
- `production`: `catalog_enabled = false`
- `staging`: `catalog_enabled = true`

## Solution Options

### Option A: Enable catalog for production (Recommended)
Update the `environments` table to enable catalog for production. This is likely the intended state since your app is actively using the catalog.

### Option B: Bypass catalog check for internal service calls
Modify `catalog-product` to skip the `CATALOG_DISABLED` check when the request is made with a service role key (internal call from mediaCache).

## Recommended Solution: Option A

We will:
1. **Update the database** to set `catalog_enabled = true` for the production environment
2. **Clear stale media cache entries** to force re-fetch with the working configuration
3. **Verify** by opening the specific eBay item

## Technical Changes

### Step 1: Database Migration
Update the `environments` table:
```sql
UPDATE environments 
SET catalog_enabled = true, updated_at = now() 
WHERE name = 'production';
```

### Step 2: Clear Stale Cache Entries
Delete media cache entries that were incorrectly cached with only 1-2 images:
```sql
DELETE FROM catalog_item_media 
WHERE provider = 'ebay' 
  AND image_count <= 2;
```

### Step 3: (Optional) Add Service Role Bypass
As a defensive measure, we can also update `catalog-product` to bypass the catalog check for internal service calls. This ensures the media enrichment continues to work even if catalog is disabled for end-user requests.

```typescript
// In catalog-product/index.ts
const authHeader = req.headers.get("authorization") || "";
const isServiceRoleCall = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

// Skip catalog enabled check for internal service calls
if (!isServiceRoleCall) {
  const envConfig = await getEnvironmentConfig(supabase, envName);
  if (!isCatalogEnabled(envConfig)) return errorResponse("CATALOG_DISABLED", "Catalog not enabled");
}
```

## Why Frontend Wasn't the Issue

The frontend code is correctly handling images:
- It displays whatever `imageUrls` array is returned from the API
- The issue was that the API was never successfully fetching from eBay - it was failing immediately with `CATALOG_DISABLED`

## Expected Outcome

After enabling catalog for production:
1. Internal media cache calls to `catalog-product` will succeed
2. eBay API will be called and return full image galleries (up to 12+ images)
3. Media cache will store all image URLs
4. Frontend will display the complete gallery

## Files to Modify

1. **Database**: Update `environments` table to enable catalog
2. **Database**: Clear stale `catalog_item_media` entries
3. **(Optional) `supabase/functions/catalog-product/index.ts`**: Add service role bypass

