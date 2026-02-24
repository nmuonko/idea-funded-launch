

## Fix On-Demand Fetch: Quantity Limit, Duplicates, and Verification

### Problems Found

1. **Fetching 100 instead of 10**: The target check `totalUpsertedCQ >= target` on line 770 counts ALL upserted rows (including duplicates that got upserted via `ON CONFLICT UPDATE`). So it counts 100 upserted rows instead of stopping at 10 new unique items. Also, `BUILDER_ITEMS_PER_PAGE = 100` means a single eBay API call already fetches 100 items, overshooting the target on the very first page.

2. **42 duplicates still inserted**: The code detects duplicates for counting purposes but still upserts them (line 797-799). The upsert updates existing rows unnecessarily, and `totalUpsertedCQ` includes duplicate rows.

3. **No persistent way to verify fetched items**: "View Fetched Products" button only works right after fetching (state resets on page reload). No time-based filter to see recently on-demand-fetched items.

### Fixes

#### Backend (`catalog-refresh-worker/index.ts`)

- **Skip duplicate upserts entirely**: Only upsert truly new items (filter out rows whose `provider_product_id` already exists before calling `.upsert()`). This prevents unnecessary DB writes and keeps the count accurate.
- **Count only new unique items toward target**: Change `totalUpsertedCQ >= target` to track new unique items only, stopping precisely when the requested quantity of NEW items is reached.
- **Use smaller page size for small targets**: When target <= 50, request only `target` items per eBay API call instead of always 100.

#### Frontend (`CatalogCache.tsx`)

- **Add a persistent "Recently Fetched" filter**: Add a `date_preset` dropdown in the Items Table with options like "Last 1 hour", "Today", "Last 7 days" that filters by `created_at` (first_seen_at). This works across page reloads.
- **Move "View Fetched Products" into the Items Table toolbar**: Instead of a button that only shows after fetching, add a permanent date filter that auto-applies when coming from the fetch result.

### Technical Details

**Backend -- only upsert new items** (lines 786-804):

```text
// Before: upserts ALL items including duplicates
const { error: upsertErr } = await supabase
  .from("catalog_items")
  .upsert(upsertRows, { onConflict: "provider,provider_product_id" });
totalUpsertedCQ += upsertRows.length;

// After: filter to only new items, skip duplicates entirely
const newRows = upsertRows.filter((r: any) => !existingSet.has(r.provider_product_id));
if (newRows.length > 0) {
  // Trim to not exceed target
  const remaining = target - totalNewUniqueCQ;
  const toInsert = newRows.slice(0, remaining);
  await supabase.from("catalog_items")
    .upsert(toInsert, { onConflict: "provider,provider_product_id" });
  totalNewUniqueCQ += toInsert.length;
}
totalDupsCQ += existingSet.size;
```

**Backend -- use target-aware page size**:

```text
const pageSize = Math.min(BUILDER_ITEMS_PER_PAGE, Math.max(20, target));
```

**Backend -- stop on new unique target**:

```text
if (totalNewUniqueCQ >= target) {
  console.log(`[BUILDER] Custom query target reached: ${totalNewUniqueCQ} new unique >= ${target}`);
  break;
}
```

**Frontend -- permanent date filter in Items Table**: Add to the existing filters bar a "Date" dropdown with preset options (Last hour, Today, Last 7 days, Last 30 days) that maps to the existing `date_preset` filter parameter already supported by the backend.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/catalog-refresh-worker/index.ts` | Skip duplicate upserts, count only new uniques toward target, use smaller page size for small targets |
| `src/pages/admin/CatalogCache.tsx` | Add permanent date filter dropdown in ItemsTable filters, improve "View Fetched Products" to apply date filter |

### Expected Result

- Requesting 10 items will fetch and insert exactly 10 NEW unique items (or fewer if not enough exist)
- Duplicates are detected but NOT re-inserted into the database
- Items Table always shows a date filter dropdown to verify recently cached products
- Works identically on Live environment after publish

