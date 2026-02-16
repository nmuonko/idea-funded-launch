

# Fix: Products Not Loading Beyond 100

## Root Cause

There are **two competing pagination systems** in `SearchResults.tsx` that both try to advance pages simultaneously:

1. **`autoFillToCap`** -- an async loop that manually increments `pageRef.current` and calls `fetchProducts`
2. **Sentinel re-check** -- a `useEffect` that calls `handleLoadMore` when loading finishes and the sentinel is still visible

Both systems race to set `pageRef.current`, causing:
- Page skips (autoFill sets page to 2 while sentinel tries page 1)
- The `lastRequestedPageRef` guard blocking legitimate requests
- The `loadingMoreRef` staying stale because React's `useEffect` sync hasn't fired by the time autoFill checks it

## Solution

**Remove `autoFillToCap` entirely** and rely solely on the sentinel re-check pattern, which is simpler and self-correcting. The re-check already chains correctly:

```text
Page 0 loads -> re-check fires -> handleLoadMore(page 1)
Page 1 loads -> re-check fires -> handleLoadMore(page 2)
Page 2 loads -> re-check fires -> handleLoadMore(page 3)
...until hasMore=false or MAX_PAGES reached
```

The sentinel has `rootMargin: '800px'`, meaning it's "visible" immediately after products render, so no scrolling is needed.

## Changes (single file: `src/pages/shop/SearchResults.tsx`)

### 1. Remove autoFill state and refs
Delete:
- `autoFillRunning` state
- `autoFillAbortRef` ref
- `productsRef` ref and its sync effect
- `autoFillToCap` function
- Auto-trigger `useEffect` (lines 473-482)

### 2. Remove autoFill UI elements
Delete:
- "Chargement automatique..." spinner text
- "Charger plus automatiquement" button
- "Stop" button
- `showAutoLoadDebug` and `showProviderDebug` state (already removed from UI but still declared)

### 3. Ensure re-check works reliably
The existing re-check pattern is correct. Just verify:
- Sentinel is always rendered (already done: `<div ref={sentinelRef} style={{ height: 1 }} />`)
- Re-check fires on every `loading`/`loadingMore` state change (already done)
- `handleLoadMore` uses refs for all guards (already done)
- `lastRequestedPageRef` resets on new search (already done)

### 4. Clean up unused state declarations
Remove `showProviderDebug`, `showAutoLoadDebug`, `autoFillRunning` declarations since their UI was already removed.

## Expected Behavior

- Search "iphone 11": Page 0 loads ~100 items, then pages 1-4 auto-chain via re-check, reaching ~500
- No user interaction needed -- sentinel with 800px rootMargin triggers immediately
- "Load More" button remains as manual fallback
- Clean console logs show `[SENTINEL_RECHECK]` firing for each page

## Technical Detail

The re-check `useEffect` depends on `[loading, loadingMore, hasMore, handleLoadMore]`. Each page fetch toggles `loadingMore` (true then false), which triggers the effect. The 150ms setTimeout ensures refs are synced before calling `handleLoadMore`. The `lastRequestedPageRef` guard prevents duplicate requests within the same cycle.

