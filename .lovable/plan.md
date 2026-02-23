

# Fix Catalog Builder: Accurate Counting + Discovery Strategy

## Problem

The catalog builder runs every 10 minutes but reports `new_unique_items: 0` despite processing pages of items. Two root causes:

1. **Unreliable "new unique" measurement**: The current method queries `first_seen_at >= runStart` after upsert, which is timing-dependent and can miscount. This causes all downstream decisions (jump, exhaust, consecutive-zero tracking) to be based on bad data.

2. **Source starvation**: Alphabetical sorting + 45s time budget means category-based sources (the best discovery tool) rarely execute before the budget runs out.

## Changes

### 1. Replace unique counting with prefetch-existing-IDs method

**File:** `supabase/functions/catalog-refresh-worker/index.ts` (lines 893-931)

**Before:** Upsert first, then query `first_seen_at >= runStart` to count new items.

**After:** Before upserting, query which `provider_product_id` values already exist. Compute `newItems` from the set difference. Then upsert. This is deterministic and immune to timing issues.

```text
Current flow:  upsert -> query first_seen_at -> hope timing works
New flow:      query existing IDs -> compute diff -> upsert -> use real count
```

### 2. Prioritize category sources over seed queries

**File:** `supabase/functions/catalog-refresh-worker/index.ts` (lines 802-806)

**Before:** Sort all sources alphabetically by `category_key`.

**After:** Sort with `ebay_category` sources first, then seed queries, then by priority, with randomization within each group to avoid always hitting the same sources.

```text
Current:  all sources sorted alphabetically (category sources starved)
New:      category sources first -> seed queries -> shuffled within groups
```

### 3. Initialize 7 sources with NULL state

**Migration SQL:** Insert state rows for sources that have never been initialized, so they actually get picked up by the builder.

```sql
INSERT INTO catalog_builder_state (source_id, current_offset, exhausted, consecutive_zero_new_pages, sort_mode)
SELECT s.id, 0, false, 0, 'newlyListed'
FROM catalog_builder_sources s
LEFT JOIN catalog_builder_state st ON st.source_id = s.id
WHERE st.source_id IS NULL;
```

### 4. Safe offset jump guard

**File:** `supabase/functions/catalog-refresh-worker/index.ts` (line 958-959)

Add a guard so offset never jumps past `total`:

```text
currentOffset = Math.min(currentOffset + BUILDER_OFFSET_JUMP, Math.max(0, total - BUILDER_ITEMS_PER_PAGE))
```

### 5. Fix deploy timeout

The previous deployment timed out. The redeploy of the edge function with these changes should resolve it since no structural changes are needed (same file, same function name).

## Technical Details

### Prefetch pattern (replaces lines 900-931)

```typescript
// BEFORE upsert: check which IDs already exist
const productIds = upsertRows.map((r: any) => r.provider_product_id);

const { data: existingRows } = await supabase
  .from("catalog_items")
  .select("provider_product_id")
  .eq("provider", "ebay")
  .in("provider_product_id", productIds);

const existingSet = new Set((existingRows || []).map((r: any) => r.provider_product_id));
const newItems = productIds.filter((id: string) => !existingSet.has(id)).length;
const duplicateCount = productIds.length - newItems;
const duplicateRatio = productIds.length > 0 ? duplicateCount / productIds.length : 0;

// THEN upsert
const { error: upsertErr } = await supabase
  .from("catalog_items")
  .upsert(upsertRows, { onConflict: "provider,provider_product_id" });
```

### Source ordering (replaces lines 802-806)

```typescript
// Prioritize category sources, then shuffle within groups
const categorySources = activeSources.filter((s: any) => s.source_type === "ebay_category");
const seedSources = activeSources.filter((s: any) => s.source_type !== "ebay_category");

// Shuffle each group to avoid always processing the same ones first
const shuffle = (arr: any[]) => arr.sort(() => Math.random() - 0.5);
const shuffled = [...shuffle(categorySources), ...shuffle(seedSources)];
```

## Files Modified

| File | What Changes |
|------|-------------|
| `supabase/functions/catalog-refresh-worker/index.ts` | Prefetch IDs, source priority, safe jump guard |
| Database migration | Initialize NULL state rows for 7 sources |

## Expected Outcome

After 3 cron cycles (~30 min):
- `catalog_builder_runs` should show `new_unique_items > 0`
- Category sources should appear in logs as processed
- `total_ingested` should start incrementing
- Sources should not all exhaust on first page

## Verification SQL (run after 30 min)

```sql
-- Check recent builder runs show new items
SELECT started_at, new_unique_items, duplicates_skipped, sources_processed, duration_ms
FROM catalog_builder_runs
ORDER BY started_at DESC
LIMIT 5;

-- Check sources are progressing
SELECT s.category_key, s.source_type, st.current_offset, st.total_ingested, 
       st.exhausted, st.consecutive_zero_new_pages, st.sort_mode
FROM catalog_builder_sources s
JOIN catalog_builder_state st ON st.source_id = s.id
WHERE s.enabled = true
ORDER BY st.total_ingested DESC
LIMIT 20;
```

