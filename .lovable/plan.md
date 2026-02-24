

## Fix Data Sync to Successfully Import All Missing Items

### Problem
The current export/import flow sends items with their Test-generated `id` (UUID primary key). When upserting into Live, this can cause **primary key conflicts** that silently fail entire chunks. The upsert targets `provider,provider_product_id` for deduplication, but the `id` field creates a separate constraint violation.

### Solution

#### 1. Strip `id` and auto-generated fields before import (Edge Function)

In `supabase/functions/catalog-data-sync/index.ts`, before upserting each chunk, strip the `id`, `created_at`, and `updated_at` fields from every item. This lets the destination database generate its own primary keys while still deduplicating on `provider,provider_product_id`.

```typescript
// Before upsert, strip fields that should be auto-generated
const cleanedChunk = chunk.map(item => {
  const { id, created_at, updated_at, ...rest } = item;
  return rest;
});
```

#### 2. Reduce chunk size to 200 for reliability

Smaller chunks reduce the chance of timeouts and make error reporting more granular.

#### 3. Add error details to the response

Return the actual error messages so you can see what's failing instead of just incrementing an error counter.

#### 4. Workflow after fix

1. Publish the app (deploys the fixed edge function)
2. Go to the **Live** admin panel at `/admin/catalog-cache`
3. Click **"Import Items (JSON)"** and upload the same export file
4. The system will skip the ~19,477 existing items and insert the ~8,251 missing ones

### Files to modify
- `supabase/functions/catalog-data-sync/index.ts` — Strip `id`/timestamps from imports, reduce chunk size, improve error reporting
- `src/pages/admin/CatalogCache.tsx` — Reduce client chunk size to 200, show error details in toast

