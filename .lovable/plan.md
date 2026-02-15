
# Fix: "Effacer la recherche" + Stale Search Cache

## Problem 1: "Effacer la recherche" Shows Random Items

When you click "Effacer la recherche" (Clear Search), the app clears the URL parameters but stays on the `/search` page. With an empty query, the search falls back to `"popular"`, which shows random products like bras instead of returning you to the homepage.

**Fix**: Change the button to navigate to `/` (homepage) instead of just clearing search params.

## Problem 2: "chaussure dame haut talon" Shows No Results

The backend now works correctly (confirmed: returns shoes/heels results). However, the frontend has **stale cached data** from previous failed searches stored in the browser (localStorage + in-memory cache). These old "0 results" entries are being served instantly, preventing the app from fetching fresh results from the fixed backend.

**Fix**: Increment the cache version prefix so all old cache entries are automatically ignored on the next page load.

---

## Technical Details

### File 1: `src/pages/shop/SearchResults.tsx`

**Line 383**: Change `onClick={() => setSearchParams({})}` to `onClick={() => navigate('/')}` so the clear button navigates to the homepage instead of staying on the search page with a fallback query.

### File 2: `src/lib/catalogCache.ts`

**Cache prefix version bump**: Increment the `CACHE_PREFIX` constant (e.g., from `"afrishop_cache_v"` to a new version number) to invalidate all stale localStorage entries from before the backend fix. This is a one-line change that forces fresh network fetches for all queries.

---

## Files Changed

- `src/pages/shop/SearchResults.tsx` -- navigate to homepage on clear
- `src/lib/catalogCache.ts` -- bump cache version to bust stale entries
