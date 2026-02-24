

## Daily Catalog Notifications, DB-First Search Priority, More Results, and Client Cache Behavior

### Problem Summary

1. **No daily notification** of catalog health (items added, total value, active count)
2. **Users may be hitting live providers unnecessarily** when items exist in the 75K+ cached catalog -- need to verify and prioritize DB-first results
3. **Search shows too few items** -- users see under 100 products when there could be many more from the cached catalog
4. **Unclear what happens when users clear browser cache** -- need to verify the impact and ensure graceful recovery

### What the Investigation Found

**Search Flow Analysis:**
- The `catalog-search` backend already implements a "DB-First" strategy via `searchDbFirst()` -- it queries `catalog_items` before hitting live providers. However, `DB_MIN_RESULTS = 5` means it only returns DB results if it finds 5+, and the DB query limit is capped at `100`.
- The DB-first results are then **merged** with live provider results (eBay + Amazon), but DB items only fill gaps -- they don't dominate.
- `PAGE_SIZE = 100` on the frontend and `DEFAULT_LIMIT = 100` on the backend, with `MAX_PAGES = 5` (up to 500 items total). But auto-pagination/broadening doesn't always kick in aggressively enough.

**Client Cache Behavior:**
- `localStorage` stores search results with 1-hour TTL (from server `ttlSeconds`). Clearing browser data removes this, causing fresh network requests. The in-memory LRU cache (100 entries) is also lost on page reload. This is **normal and expected** -- the next search just fetches fresh data from the server-side cache (7-day TTL) which responds in under 200ms on cache hit.

---

### Plan

#### 1. Daily Catalog Health Notification (New Edge Function + Cron)

Create a new `catalog-daily-report` edge function that:
- Queries total active items, inactive items, dead links (fail_count >= 3), items added in last 24h
- Calculates total value (SUM of price_usd for active items)
- Sends an email to the admin using the existing `sendEmail` helper
- Triggered daily at 8 AM via pg_cron

**New file**: `supabase/functions/catalog-daily-report/index.ts`

```text
// Queries catalog_items for:
// - Total active count
// - Total inactive count
// - Dead links (fail_count >= 3)
// - Items added in last 24h
// - Total value (SUM price_usd WHERE is_active = true)
// Sends formatted HTML email via sendEmail() to admin
```

**Cron setup**: pg_cron job calling the function daily at 8 AM UTC

#### 2. Maximize DB-First Results -- Show More Cached Products

The DB-first search (`searchDbFirst.ts`) currently has `TARGET_RESULTS = 100` and a tight 800ms budget. Since we have 75K+ items, the DB should be the primary source for common queries.

**Changes to `supabase/functions/_shared/searchDbFirst.ts`:**
- Increase `TARGET_RESULTS` from 100 to 200 to pull more from the cached catalog
- Increase Tier A limit from `limit` (100) to `Math.max(limit, 200)` for richer DB results
- The DB query is already fast (<100ms for indexed ilike searches), so this won't impact latency

**Changes to `supabase/functions/catalog-search/index.ts`:**
- When DB returns sufficient results (>= 50 items), skip live provider calls entirely to deliver sub-second responses. Currently, live providers are ALWAYS called even when DB has plenty of results.
- Add a `DB_SUFFICIENT_THRESHOLD = 50`: if DB-first returns >= 50 items AND it's page 0, return immediately without waiting for providers. This ensures < 1 second responses for cached queries.
- Still fire a background cache refresh (fire-and-forget) to keep the cache fresh.

#### 3. Show More Products Per Search (Frontend)

**Changes to `src/pages/shop/SearchResults.tsx`:**
- Lower `BROADEN_THRESHOLD` from 30 to 50 (trigger broadening more often to find more related items)
- Increase `BROADEN_TARGET` from 200 to 300 (collect more related products before stopping)
- These changes mean the frontend will more aggressively seek similar products when initial results are sparse

#### 4. Client Cache Clearing -- Add Documentation Comment (No Code Change Needed)

When a user clears their browser cache/localStorage:
- The in-memory LRU cache and localStorage entries are wiped
- The very next search fetches from the **server-side** 7-day search cache, which responds in <200ms for previously searched queries
- The backend `catalog_items` DB (75K+ items) provides instant results via DB-first even for new queries
- **No code change needed** -- the system already handles this gracefully. The server cache is independent of the client.

### Technical Details

**Daily Report Edge Function:**

```text
import { sendEmail, ADMIN_EMAIL } from "../_shared/email.ts";
import { createAdminPostgrestClient } from "../_shared/postgrest.ts";

// Run 5 parallel count queries (same pattern as SummaryCards frontend)
const [activeRes, inactiveRes, deadRes, added24hRes, valueRes] = await Promise.all([
  supabase.from("catalog_items").select("*", { count: "exact", head: true }).eq("is_active", true),
  supabase.from("catalog_items").select("*", { count: "exact", head: true }).eq("is_active", false),
  supabase.from("catalog_items").select("*", { count: "exact", head: true }).gte("fail_count", 3),
  supabase.from("catalog_items").select("*", { count: "exact", head: true }).eq("is_active", true).gte("first_seen_at", twentyFourHoursAgo),
  supabase.from("catalog_items").select("price_usd").eq("is_active", true),
]);

// Format and send via sendEmail()
```

**DB-Sufficient Fast Path (catalog-search):**

```text
// After DB-first returns, check if we have enough
if (dbFallbackItems && dbFallbackItems.length >= DB_SUFFICIENT_THRESHOLD && !cursor) {
  // Return DB results immediately -- sub-second response
  // Fire background provider refresh (fire-and-forget)
  return Response with dbFallbackItems;
}
```

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/catalog-daily-report/index.ts` | NEW -- daily catalog health email |
| `supabase/functions/_shared/searchDbFirst.ts` | Increase TARGET_RESULTS to 200, increase Tier A limit |
| `supabase/functions/catalog-search/index.ts` | Add DB-sufficient fast path (skip providers when DB has 50+ items) |
| `src/pages/shop/SearchResults.tsx` | Increase BROADEN_TARGET to 300, lower BROADEN_THRESHOLD to 50 |
| `supabase/config.toml` | Register catalog-daily-report function |

### Expected Results

- Admin receives daily email: "75,501 active items | $112.6M total value | 1,234 added today | 0 dead links"
- Users searching for cached items (e.g., "iphone 12") get results in < 1 second from DB
- Live provider calls only happen when DB has fewer than 50 matching items
- Search results show 200-300+ products for popular queries instead of < 100
- Clearing browser cache has zero impact -- server cache delivers instant results on next search

