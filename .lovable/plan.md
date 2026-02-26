
## Fix: Admin Cached Products Filter Counts

### Problem
Three bugs cause the filtered count to be inaccurate when filtering by category (e.g., "phones"):

1. **DB fallback missing filters**: When the edge function fails, the DB fallback query only applies `category_key`, `provider`, `is_active`, and `q` -- it completely ignores `date_preset`, `stale_price_days`, and `not_seen_days`. So if any of those are also set, items and counts won't match.

2. **`sort_by` treated as a filter**: The `hasActiveFilters` check includes `sort_by`, which is just ordering, not a filter. If you pick any sort option, the UI switches to "filtered" display mode and tries to show a filtered count, but the edge function doesn't consider `sort_by` a filter either, so `filteredCount` may be null -- resulting in a misleading "0 filtered" or falling back to total count.

3. **DB fallback count missing filters**: The count query inside the DB fallback also skips `date_preset`, `stale_price_days`, and `not_seen_days`, so the badge showing "X items in phones" is wrong when those filters are active.

**Verified**: The database has 3,925 items with `category_key = 'phones'`, so the data exists -- it's a filter/count logic bug, not a data issue.

### Solution

#### 1. Remove `sort_by` from `hasActiveFilters`
Sorting is not a filter -- it should not trigger filtered count display mode.

#### 2. Add missing filters to DB fallback data query
Apply `date_preset`, `stale_price_days`, `not_seen_days`, and `sort_by` (for ordering) to the DB fallback query so it matches the edge function behavior.

#### 3. Add missing filters to DB fallback count query
Expand `hasAnyFilter` to include `date_preset`, `stale_price_days`, and `not_seen_days`, and apply those filters to the count query so the badge is accurate.

#### 4. Also filter on `unified_category` as fallback
Some items have `category_key` set to non-standard values (e.g., `electronics_phones`) but may have `unified_category = 'phones'`. Add an `.or()` clause to match either `category_key` or `unified_category` for broader category filtering.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/admin/CatalogCache.tsx` | Fix `hasActiveFilters` to exclude `sort_by`; add missing date/stale/not-seen filters to DB fallback data + count queries; add `unified_category` OR matching |

### Technical Details

**hasActiveFilters fix** (line 868-872):
```typescript
const hasActiveFilters = !!(
  appliedFilters.category_key || appliedFilters.provider || appliedFilters.is_active ||
  appliedFilters.q || appliedFilters.stale_price_days || appliedFilters.not_seen_days ||
  appliedFilters.date_preset
);
// sort_by removed -- it's ordering, not filtering
```

**DB fallback filter helper**: Extract a shared `applyFallbackFilters(query)` function that applies all filters (category via OR on `category_key`/`unified_category`, provider, is_active, q, date_preset, stale_price_days, not_seen_days) to both the data query and the count query, ensuring consistency.

**Category OR matching**:
```typescript
if (appliedFilters.category_key) {
  query = query.or(`category_key.eq.${appliedFilters.category_key},unified_category.eq.${appliedFilters.category_key}`);
}
```
