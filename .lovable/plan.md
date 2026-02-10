

# Auto-Clear Client Cache on Rebuild and Publish

## Problem

When you click **Rebuild** or **Publish** in the admin panel, the backend DB cache is updated correctly. However, the **client-side localStorage cache** (used by `cachedCatalogFetch`) is NOT cleared. This means users (and your own browser) continue seeing stale cached data until the old TTL naturally expires -- defeating the purpose of rebuilding.

## Solution

After a successful Rebuild or Publish action, clear all `catalog-home` entries from `localStorage` so the next page load fetches fresh data from the updated backend cache.

## Changes

### 1. Add `clearCatalogHomeCache()` helper to `src/lib/catalogCache.ts`

Add a new exported function that removes all localStorage entries matching the `catalog-home` endpoint prefix. This is targeted -- it only clears home feed cache, not search cache or other cached data.

```
clearCatalogHomeCache()
  -> loops through localStorage keys starting with "afrishop_cache:v8:catalog-home:"
  -> removes all matching entries
  -> logs how many were cleared
```

### 2. Call it after Rebuild success in `src/pages/admin/HomeRecipes.tsx`

In the `rebuild()` function (around line 262), after a successful response, call `clearCatalogHomeCache()` so the admin's own browser gets fresh data on next visit.

### 3. Call it after Publish success in `src/pages/admin/HomeRecipes.tsx`

In `handlePublishNow()` (around line 151), after a successful response, call `clearCatalogHomeCache()` for the same reason.

## Technical Details

### File: `src/lib/catalogCache.ts`

Add new function:
```typescript
export function clearCatalogHomeCache(): number {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${CACHE_PREFIX}catalog-home:`)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  console.log('[CACHE] cleared', keysToRemove.length, 'catalog-home entries (admin action)');
  return keysToRemove.length;
}
```

### File: `src/pages/admin/HomeRecipes.tsx`

- Import `clearCatalogHomeCache` from `@/lib/catalogCache`
- In `rebuild()`: after the success toast (line 268), add `clearCatalogHomeCache();`
- In `handlePublishNow()`: after the success toast (line 157), add `clearCatalogHomeCache();`

## Important Note

This clears the cache on the **admin's browser**. Other users' browsers will still serve from their own localStorage until TTL expires naturally. This is expected behavior -- the backend DB cache is already updated, so when any user's local cache expires, they'll get the fresh data. The admin TTL settings control how long that takes.

## Files Modified

- `src/lib/catalogCache.ts` -- add `clearCatalogHomeCache()` function
- `src/pages/admin/HomeRecipes.tsx` -- call it after Rebuild and Publish success
