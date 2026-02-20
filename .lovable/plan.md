

## Fix: Slow Loading + Only 67 Products

### Root Cause

Two issues causing only 67 products and slow loading:

**1. False exhaustion after dedup filtering (line 116)**
The code marks the pool as exhausted when `items.length === 0` -- but this checks items AFTER dedup filtering. If a page returns items that overlap with previously seen items (common with eBay), all get filtered out, `items.length === 0`, and the loop stops prematurely even though `hasMore=true` and `nextCursor` exists.

**2. Backend caps at ~50 items per request**
The backend returns 46-50 items per call regardless of `pageSize=100`. To reach 300, we need ~6 requests. Currently the loop stops early due to the false exhaustion bug above.

### Fix (single file: `src/pages/shop/CategoryResultsPage.tsx`)

**1. Separate "no raw items" from "no new items after dedup"**
- Only set `exhaustedRef.current = true` when:
  - `hasMore === false`, OR
  - `!nextCursor`, OR  
  - `rawItems.length === 0` (backend returned nothing)
- Do NOT exhaust when filtered/deduped items is 0 but raw items existed -- this just means overlap, not end of catalog.

**2. Add an empty-page counter to prevent infinite loops**
- Track consecutive pages that yield 0 new items after dedup.
- If 3 consecutive pages return 0 new items, then mark exhausted (safety valve).
- Reset the counter whenever new items are found.

**3. Show a progress indicator during initial load**
- Replace the static skeleton with a progress message showing how many items have loaded so far (e.g., "Loading... 150 products found").
- This gives users feedback during the ~6 sequential requests.

### Technical Details

```
Line 116: Change exhaustion condition
  BEFORE: if (!cursorRef.current || data?.hasMore === false || items.length === 0)
  AFTER:  if (!cursorRef.current || data?.hasMore === false || rawItems.length === 0)

Lines 133-141: Add empty-page safety counter
  let emptyStreak = 0;
  while (accumulated.length < POOL_TARGET && !exhaustedRef.current && requestCount < 10) {
    const items = await fetchPage(cursorRef.current);
    if (items.length === 0) { emptyStreak++; if (emptyStreak >= 3) break; }
    else { emptyStreak = 0; }
    accumulated.push(...items);
    requestCount++;
  }

Lines 193-201: Add loading progress
  Show accumulated count during loading: "{count} products found..."
```

### Expected Result
- Loop continues past dedup-empty pages, correctly using cursor pagination
- Reaches 300 items in ~6 requests (at ~50 items/request from backend)
- Progress feedback keeps users informed during the 5-10 second load
- Safety valve (3 empty streaks) prevents infinite loops

### No changes to
- Backend / edge functions
- ShopHome.tsx / grids
- catalogCache.ts

