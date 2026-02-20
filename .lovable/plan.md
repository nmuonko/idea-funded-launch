

## Make Search Return More Results (eBay-Style Broadening)

### Problem
When you search "2024 tesla model x", only 7 results come back because:
1. The query contains a digit and a known model token ("tesla"), so the system classifies it as a **"direct query"** and takes the **fast path**
2. The fast path skips the AI query refiner, DB-first search, and synonym fallbacks
3. Both providers (eBay + Amazon) return only exact matches for that very specific query
4. No broadening happens -- if providers return 7 items, you get 7 items

eBay.com does better because it shows exact matches first, then automatically broadens to related items (other years, similar models).

### Solution: Auto-Broadening for Low-Result Direct Queries

Add a new "query broadening" step in the backend search pipeline. When the primary query returns fewer than ~30 items, the system will automatically generate broader fallback queries and fetch additional results to fill the page.

### How It Works

For a query like "2024 tesla model x":

1. **Primary fetch** runs as-is -- returns 7 exact matches (these stay at the top)
2. **Broadening kicks in** because 7 < 30 threshold
3. System generates broadened queries by progressively relaxing the original:
   - Remove the year: "tesla model x" (catches 2023, 2025, etc.)
   - Shorten to brand + line: "tesla model" (catches Model S, Model Y, etc.)
4. Each broadened query fetches from both providers, deduplicating against already-seen items
5. Results are appended after the exact matches, giving you 50-100 items total

### Changes

**File: `supabase/functions/catalog-search/index.ts`**

After the existing alt-queries block (around line 970) and before the synonym fallback block, add a new "direct query broadening" section:

1. Check if the query was classified as `directQuery` AND total provider items are below a threshold (30)
2. Generate broadened queries by:
   - Stripping year patterns (4-digit numbers like 2024, 2023)
   - Stripping trailing qualifier words (e.g., "plaid", "used", "new")
   - Taking progressively shorter token prefixes
3. Run each broadened query against both providers (with a per-query timeout budget)
4. Deduplicate new results against existing items
5. Stop once we reach 80+ total items or exhaust the broadened queries

The broadening logic is guarded by a time budget (max 3 seconds on page 0, 4 seconds on page > 0) so it never causes timeouts.

```text
// Pseudocode for the broadening step:

const BROADEN_THRESHOLD = 30;
const totalAfterPrimary = amazonItems.length + ebayItems.length;

if (directQuery && totalAfterPrimary < BROADEN_THRESHOLD && !providerTimedOut) {
  const broadenedQueries = generateBroadenedQueries(providerQuery);
  // e.g. "2024 tesla model x" -> ["tesla model x", "tesla model"]
  
  const existingIds = new Set([...amazonItems, ...ebayItems].map(i => i.id));
  
  for (const bq of broadenedQueries) {
    if (amazonItems.length + ebayItems.length >= 80) break;
    if (Date.now() - startTime > budgetLimit) break;
    
    // Fetch from both providers with the broader query
    const [amzResult, ebayResult] = await Promise.allSettled([
      fetchAmazonItems({...params, query: bq}),
      fetchEbayItems({...params, query: bq}),
    ]);
    
    // Append only new (unseen) items
    // ...deduplication logic...
  }
}
```

**Helper function `generateBroadenedQueries`** (added to the same file or a shared module):
- Strips 4-digit year numbers from the query
- Progressively shortens remaining tokens
- Returns 2-3 broadened variants, ordered from most specific to broadest
- Example: "2024 tesla model x plaid" -> ["tesla model x plaid", "tesla model x", "tesla model"]

### What Won't Change
- The fast path is still fast -- broadening only runs when results are low
- Exact matches always appear first (they come from the primary fetch)
- Pagination, caching, and all other search behaviors are untouched
- The "Voir plus" / infinite scroll still works normally
- No database changes needed
