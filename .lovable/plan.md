

## Fix Export to Download All 27,728 Items

### Problem
The export only downloads 1,000 items because `supabase.functions.invoke()` may not reliably pass query parameters when they're appended to the function name string. This means the edge function likely receives `page=0` on every call, or `totalPages` resolves to 1, so the pagination loop only runs once.

### Solution
Switch the export to use POST with a JSON body (instead of GET with query params) so parameters are reliably passed through `supabase.functions.invoke()`.

### Changes

#### 1. Edge Function (`supabase/functions/catalog-data-sync/index.ts`)
- Read `mode`, `page`, and `pageSize` from the **request body** (POST) instead of URL search params
- Both export and import will use POST method
- Keep the same pagination logic (1,000 rows per page, ordered by `id`)

#### 2. Admin UI (`src/pages/admin/CatalogCache.tsx`)
- Change the export call from GET to POST, sending `{ mode: "export", page, pageSize: 1000 }` in the body
- Change the import call similarly to send `{ mode: "import", items: chunk }` in the body
- This ensures all parameters are reliably received by the edge function

### Technical Details

**Edge function change:**
```typescript
// Parse mode from body instead of URL params
const body = await req.json();
const mode = body.mode || "export";

if (mode === "export") {
  const page = body.page || 0;
  const pageSize = Math.min(body.pageSize || 1000, 1000);
  // ... same pagination logic
}
```

**Client export call change:**
```typescript
const { data, error } = await supabase.functions.invoke(
  'catalog-data-sync',
  { method: 'POST', body: { mode: 'export', page, pageSize: 1000 } }
);
```

**Client import call change:**
```typescript
const { data, error } = await supabase.functions.invoke(
  'catalog-data-sync',
  { method: 'POST', body: { mode: 'import', items: chunk } }
);
```

### Expected Result
The export will properly paginate through all 28 pages (1,000 items each) and download a complete JSON file with all 27,728 items. The import flow remains unchanged in behavior.

### Files to modify
- `supabase/functions/catalog-data-sync/index.ts` -- Read params from body instead of URL
- `src/pages/admin/CatalogCache.tsx` -- Send export/import params via POST body

