

# Fix: Instant Store Filtering, All Stores Visible, Load More

## Problems Identified

1. **Dynamic store dropdown broken**: The query `SELECT provider FROM catalog_items ... LIMIT 1000` does NOT return distinct providers — it returns 1000 random rows and extracts providers client-side. If a store has few items and none land in those 1000 rows, it's invisible. This is why Walmart, Best Buy, etc. are missing.

2. **Store filter still slow**: Even with 200-item cap, each filter change triggers a full DB round-trip. The cache only helps on *re-selection*, not first selection.

3. **Only 200 products shown with no way to see more**: No "Load More" button was added despite the plan calling for one.

## Plan

### 1. Fix Dynamic Store Dropdown — Use SQL RPC for Distinct Providers
**Database migration**: Create a tiny RPC function:
```sql
CREATE OR REPLACE FUNCTION get_active_providers()
RETURNS TABLE(provider text, item_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT provider, COUNT(*) as item_count
  FROM catalog_items
  WHERE is_active = true AND is_disallowed = false AND price_usd > 0
  GROUP BY provider
  ORDER BY item_count DESC;
$$;
```

**File: `src/pages/shop/ShopHome.tsx`** — Replace the broken `useEffect` (lines 375-402) to call this RPC:
```typescript
const { data } = await supabase.rpc('get_active_providers');
```
This guarantees every provider with at least 1 active item appears, with counts.

### 2. Make Store Filtering Instant — Add "Load More" Pagination
**File: `src/pages/shop/ShopHome.tsx`**:
- Add `storeProductsPage` state (starts at 0)
- Keep the 200-item initial fetch (fast)
- Add a "Load More" button at the bottom that fetches the next 200 items and appends them
- Reset page to 0 when provider changes
- Cache includes all loaded pages, so switching back is instant
- Show count as "Showing X of Y products"

### 3. Use Provider Display Names Properly
The store title in the grid header (line 1125) currently shows raw provider key. Use the `PROVIDER_DISPLAY` map (already defined) to show proper names like "Amazon" instead of "amazon".

## Files Changed

| File | Change |
|------|--------|
| **Database migration** | Add `get_active_providers()` RPC |
| `src/pages/shop/ShopHome.tsx` | Use RPC for dropdown; add Load More button; fix display names |

