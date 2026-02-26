
### What I found
I traced both the admin UI and backend list endpoint used for the “Cached Products” filter/count badge.

- The database definitely has phone items (`3925` rows where `category_key='phones'` in this project), so this is logic/display mismatch, not missing data.
- The frontend fallback in `src/pages/admin/CatalogCache.tsx` was improved, but the **primary path** still goes through `admin-catalog-items` edge function first.
- In `supabase/functions/admin-catalog-items/index.ts` (`handleList`), category filtering still uses:
  - `query.eq("category_key", categoryKey)`
  - This does **not** include `unified_category` fallback.
- The edge function sets `filteredCount = 0` on count exceptions, which can show a misleading hard `0` instead of “unknown/unavailable.”
- The UI badge text says `X items in "phones"` but currently uses the full `filtered_count` (which may include other active filters), so label can be semantically misleading.

### Implementation approach
I’ll align the edge function and UI so the count is accurate and robust in all cases.

1. **Fix category filter parity in backend list endpoint**
   - File: `supabase/functions/admin-catalog-items/index.ts`
   - Update `applyFilters(query)` so category filtering matches either:
     - `category_key = <selected>`
     - `unified_category = <selected>`
   - Use this for both data query and count query (already shared, so one fix applies to both).

2. **Harden filtered count behavior**
   - File: `supabase/functions/admin-catalog-items/index.ts`
   - On count query failure, return `filtered_count: null` (not `0`) and optionally a lightweight flag (`filtered_count_error: true`) for diagnostics.
   - This avoids false “0 filtered” states from transient count errors.

3. **Improve UI count/badge semantics**
   - File: `src/pages/admin/CatalogCache.tsx`
   - Keep using `filtered_count` when available, but avoid showing a hard `0` if backend indicates count unavailable.
   - Update badge wording logic:
     - If only category filter is active: `X items in "phones"`
     - If category + other filters are active: `X matching items in "phones"`
   - This prevents confusion when date/provider/status filters are also applied.

4. **(Optional but recommended) Add dedicated category-only badge count**
   - File: `src/pages/admin/CatalogCache.tsx`
   - Add a small head-count query just for category/unified-category when `category_key` is selected.
   - Use this for the badge, while table header keeps filtered count.
   - This guarantees the badge always reflects true category inventory regardless of other active filters.

### Why this should fix your issue
Right now, you can still get inconsistent numbers because the backend list endpoint’s category logic is stricter than intended and count failures collapse to `0`. Updating the backend primary path (not just fallback) and tightening UI display rules removes the mismatch and misleading zero state.

### Validation checklist after implementation
1. Open `/admin/catalog-cache`, set Category = `phones`, click **Apply**:
   - Header filtered count should be non-zero.
   - Badge should show non-zero for phones.
2. Add Date preset (`today`) and Apply:
   - Header should drop to today-matching subset.
   - Badge wording should indicate “matching items” if other filters are active.
3. Toggle Provider between All / eBay and re-apply:
   - Counts should change consistently with visible rows.
4. Confirm on mobile admin view and published domain:
   - No `0 items in "phones"` when rows are visibly present.
5. Verify no regressions in pagination and sort behavior.

### Technical notes
- No database schema changes are required.
- No auth flow changes are required.
- This is strictly query/filter/count parity + UI semantics hardening.
