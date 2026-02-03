
# Admin "Clear Search Cache" Button Implementation

## Overview
Add a safe admin-only button that instantly clears search caches (`catalog_cache` WHERE `cache_type='search'` + `search_proxy_cache`) to remove poisoned cache entries without code deployment.

---

## Implementation Plan

### 1. Database: SQL RPC Function

Create a new SECURITY DEFINER function `public.admin_clear_search_cache()`:

```sql
CREATE OR REPLACE FUNCTION public.admin_clear_search_cache()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_catalog integer := 0;
  deleted_proxy integer := 0;
BEGIN
  -- Verify admin access
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Delete only search-type cache from catalog_cache
  DELETE FROM public.catalog_cache
  WHERE cache_type = 'search';
  GET DIAGNOSTICS deleted_catalog = ROW_COUNT;

  -- Delete all rows from search_proxy_cache
  DELETE FROM public.search_proxy_cache;
  GET DIAGNOSTICS deleted_proxy = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_catalog_cache', deleted_catalog,
    'deleted_search_proxy_cache', deleted_proxy,
    'cleared_at', now()
  );
END;
$$;

-- Revoke access from public, only authenticated users can call
REVOKE ALL ON FUNCTION public.admin_clear_search_cache() FROM PUBLIC;
```

---

### 2. Backend: Add Missing `clearDbCache` Function

Add to `supabase/functions/_shared/catalogCache.ts`:

```typescript
export interface ClearCacheParams {
  cacheType?: string;
  provider?: string;
  category?: string;
  query?: string;
  all?: boolean;
}

export interface ClearCacheResult {
  deleted: number;
  error?: string;
}

/**
 * Clear cache entries from catalog_cache based on filters
 */
export async function clearDbCache(
  supabase: SupabaseClient,
  params: ClearCacheParams,
  requestId: string
): Promise<ClearCacheResult> {
  try {
    let query = supabase.from("catalog_cache").delete();
    
    if (params.all) {
      // Delete all entries
      query = query.neq("cache_key", ""); // Match all
    } else {
      // Apply filters
      if (params.cacheType) {
        query = query.eq("cache_type", params.cacheType);
      }
      if (params.provider) {
        query = query.eq("provider", params.provider);
      }
      if (params.category) {
        query = query.eq("category", params.category);
      }
      if (params.query) {
        query = query.ilike("query", `%${params.query}%`);
      }
    }
    
    const { data, error, count } = await query.select("cache_key");
    
    if (error) {
      console.error(`[ADMIN_CACHE] requestId=${requestId} Clear failed:`, error.message);
      return { deleted: 0, error: error.message };
    }
    
    const deleted = data?.length || 0;
    console.log(JSON.stringify({
      event: "[ADMIN_CACHE] clear_cache",
      requestId,
      params,
      deleted,
    }));
    
    return { deleted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { deleted: 0, error: msg };
  }
}
```

---

### 3. Admin UI: Add Button to CacheSettings Page

Update `src/pages/admin/CacheSettings.tsx`:

**Changes:**
- Add AlertDialog for confirmation modal
- Add mutation to call RPC function
- Add "Clear Search Cache" button with confirmation
- Show success/error toast with deletion counts

**New UI Section (after Current Status card):**

```tsx
{/* Clear Search Cache Tool */}
<Card className="border-orange-200 bg-orange-50/50 dark:bg-orange-950/20">
  <CardHeader>
    <CardTitle className="text-lg flex items-center gap-2 text-orange-700 dark:text-orange-400">
      <Trash2 className="h-5 w-5" />
      {language === 'fr' ? 'Vider le Cache de Recherche' : 'Clear Search Cache'}
    </CardTitle>
    <CardDescription>
      {language === 'fr'
        ? 'Supprimez immédiatement tous les résultats de recherche en cache. Utilisez ceci pour corriger les résultats erronés.'
        : 'Immediately remove all cached search results. Use this to fix incorrect results.'}
    </CardDescription>
  </CardHeader>
  <CardContent>
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-100">
          {clearCacheMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          {language === 'fr' ? 'Vider le Cache' : 'Clear Search Cache'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {language === 'fr' ? 'Vider le cache de recherche ?' : 'Clear search cache?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {language === 'fr'
              ? 'Cela supprimera tous les résultats de recherche en cache. Les nouvelles recherches peuvent être plus lentes pendant quelques minutes.'
              : 'This will remove cached search results immediately. New searches may be slower for a few minutes.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {language === 'fr' ? 'Annuler' : 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleClearCache}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {language === 'fr' ? 'Vider le Cache' : 'Clear Cache'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </CardContent>
</Card>
```

**Mutation Logic:**

```typescript
const clearCacheMutation = useMutation({
  mutationFn: async () => {
    const { data, error } = await supabase.rpc('admin_clear_search_cache');
    if (error) throw error;
    return data;
  },
  onSuccess: (data) => {
    const result = data as { 
      ok: boolean; 
      deleted_catalog_cache: number; 
      deleted_search_proxy_cache: number 
    };
    
    console.log(JSON.stringify({
      event: "[ADMIN_CACHE] clear_cache",
      userId: session?.user?.id,
      result,
    }));
    
    toast({
      title: language === 'fr' ? 'Cache vidé' : 'Cache cleared',
      description: language === 'fr'
        ? `Supprimé: catalog=${result.deleted_catalog_cache}, proxy=${result.deleted_search_proxy_cache}`
        : `Cleared: catalog=${result.deleted_catalog_cache}, proxy=${result.deleted_search_proxy_cache}`,
    });
  },
  onError: (error) => {
    console.warn(JSON.stringify({
      event: "[ADMIN_CACHE] clear_cache_error",
      userId: session?.user?.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
    
    toast({
      title: language === 'fr' ? 'Erreur' : 'Error',
      description: error instanceof Error ? error.message : 'Unknown error',
      variant: 'destructive',
    });
  },
});

const handleClearCache = () => {
  clearCacheMutation.mutate();
};
```

---

## Files to Modify

| File | Changes |
|------|---------|
| Database Migration | Create `admin_clear_search_cache()` RPC function with admin-only security |
| `supabase/functions/_shared/catalogCache.ts` | Add `ClearCacheParams` interface and `clearDbCache` function |
| `src/pages/admin/CacheSettings.tsx` | Add Clear Search Cache button with confirmation dialog and toast feedback |

---

## Security

- **RPC Function**: Uses `SECURITY DEFINER` with admin role check via `user_roles` table
- **UI**: Button only visible on admin CacheSettings page (already protected by `AdminRouteGuard`)
- **Audit**: Action logged to console with structured JSON for debugging

---

## User Experience

1. Admin navigates to **Settings → Cache & Performance**
2. Sees new orange-tinted card: "Clear Search Cache"
3. Clicks **"Clear Search Cache"** button
4. Confirmation modal appears:
   - Title: "Clear search cache?"
   - Description: "This will remove cached search results immediately. New searches may be slower for a few minutes."
5. Admin clicks **"Clear Cache"**
6. Toast shows: "Cache cleared: catalog=1234, proxy=567"

---

## Logging

**Success:**
```json
{"event":"[ADMIN_CACHE] clear_cache","userId":"abc-123","result":{"ok":true,"deleted_catalog_cache":1234,"deleted_search_proxy_cache":567}}
```

**Error:**
```json
{"event":"[ADMIN_CACHE] clear_cache_error","userId":"abc-123","error":"not authorized"}
```
