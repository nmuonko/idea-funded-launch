

## Fix: 4-Minute Load Time + Irrelevant Products in "Jeux Video"

There are two separate bugs causing the poor experience.

---

### Problem 1: 4-Minute Load (Frontend)

The current code fetches ALL 300 products in a sequential `while` loop and shows nothing until every request completes. With the backend returning ~50 items per request, that's 6+ sequential API calls — each taking 2-5 seconds — all happening before ANY product is displayed.

**Fix: Progressive rendering ("show first, load rest in background")**

Instead of accumulating 300 items in a hidden buffer, show the first batch (~50 items) immediately and load additional pages in the background while the user is already browsing.

Changes to `src/pages/shop/CategoryResultsPage.tsx`:
- Split the single `while` loop into two phases:
  - **Phase 1 (instant)**: Fetch one page, set `loading=false`, render products immediately.
  - **Phase 2 (background)**: Continue fetching remaining pages using `setTimeout` / async loop, appending to `products` state progressively. The user sees the product count grow in real time (e.g., "48... 96... 150... 250... 303") while browsing the first batch.
- Remove the `loadProgress` skeleton-only state entirely — users see real products within 2-3 seconds.

---

### Problem 2: Irrelevant Products (Backend)

The `gaming` category resolves to `electronics_gaming` which uses eBay category **1249** ("Video Games & Consoles"). This is a broad parent category that includes gaming laptops, monitors, mice, keyboards, and PC peripherals — hence the Alienware laptops and MSI monitors in the results.

According to the project's gaming console logic, it should use eBay category **139971** (Video Game Consoles) with stricter filtering.

**Fix: Update category registry to use the correct eBay category**

Change in `supabase/functions/_shared/categoryRegistry.ts`:
- Update the `electronics_gaming` entry's `ebayCategory` from `"1249"` to `"139971"` (Video Game Consoles).
- Add `minPrice: 20` to filter out cheap accessories that slip through.

This single change ensures the eBay Browse API only returns actual gaming consoles and controllers, not laptops or monitors.

---

### Technical Details

**File 1: `src/pages/shop/CategoryResultsPage.tsx`**

Replace the initial load `useEffect` with a two-phase approach:

```
Phase 1 (lines ~134-155):
  - Fetch first page (cursorRef = null)
  - setProducts(firstBatch)
  - setLoading(false)  // <-- products visible NOW

Phase 2 (continues in same effect, after setLoading):
  - while (accumulated < POOL_TARGET && !exhausted && requestCount < 10)
    - fetchPage(cursorRef.current)
    - setProducts(prev => [...prev, ...newItems])  // <-- appends live
    - requestCount++
  - No separate loading state needed
```

The user sees products in ~2 seconds. Background loading adds more items transparently.

**File 2: `supabase/functions/_shared/categoryRegistry.ts`**

```
Line 259:
BEFORE: electronics_gaming: { ..., ebayCategory: "1249", minPrice: 0, ... }
AFTER:  electronics_gaming: { ..., ebayCategory: "139971", minPrice: 20, ... }
```

---

### Expected Result

- Products appear in 2-3 seconds (first ~50 items)
- Remaining items load in background, visible count updates live
- Only gaming consoles and controllers appear (no laptops, monitors, mice)
- Total still reaches ~300 items if available

