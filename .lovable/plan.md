

## Fix: Export Pagination Stops After First Page

### Root Cause
The edge function uses `.select("*", { count: "exact" })` to get the total row count, but the Supabase client running inside the edge function (via `esm.sh`) returns `count: null`. This causes the response to contain `totalPages: 0`. 

On the client side, `totalPages` starts at `1`, so the first page fetches successfully. But then `totalPages` gets set to `0` from the response, making the condition `page < totalPages` (i.e. `1 < 0`) false, and the loop stops after exactly 1,000 items.

### Solution
Remove the dependency on `count` entirely. Instead, use a "fetch until done" approach: keep paginating until the edge function returns fewer items than the requested page size. This is simpler and more reliable.

### Changes

#### 1. Edge Function (`supabase/functions/catalog-data-sync/index.ts`)
- Remove `{ count: "exact" }` from the query (not needed)
- Remove `total` and `totalPages` from the response
- Just return `page`, `pageSize`, `itemCount`, and `items`

#### 2. Client (`src/pages/admin/CatalogCache.tsx`)
- Change the `while` loop from `page < totalPages` to a `do...while` that stops when `itemCount < pageSize`
- Remove the `totalPages` variable

### Technical Details

**Edge function export section (simplified):**
```typescript
if (mode === "export") {
  const page = parseInt(String(body.page ?? 0));
  const pageSize = Math.min(parseInt(String(body.pageSize ?? 1000)), 1000);

  const { data: items, error } = await supabase
    .from("catalog_items")
    .select("*")
    .order("id")
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (error) { /* return 500 */ }

  return Response(JSON.stringify({
    page,
    pageSize,
    itemCount: items?.length ?? 0,
    items: items ?? [],
  }));
}
```

**Client export loop (simplified):**
```typescript
let page = 0;
let keepGoing = true;
while (keepGoing) {
  setExportProgress(`Fetching page ${page + 1}...`);
  const { data, error } = await supabase.functions.invoke('catalog-data-sync', {
    method: 'POST',
    body: { mode: 'export', page, pageSize: 1000 },
  });
  if (error) throw error;
  const items = data.items || [];
  allItems.push(...items);
  setExportProgress(`Fetched ${allItems.length} items so far...`);
  keepGoing = items.length === 1000; // full page means there may be more
  page++;
}
```

### Files to Modify
- `supabase/functions/catalog-data-sync/index.ts` -- Remove count/totalPages from export response
- `src/pages/admin/CatalogCache.tsx` -- Change loop to "fetch until short page" pattern

### Expected Result
The export will keep fetching 1,000-item pages until a page returns fewer than 1,000 items (the last page), then stop and download the full ~27,728 item JSON file.
