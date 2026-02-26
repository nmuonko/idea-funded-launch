

## Fix Price Filter and Sort Visibility on Search Results

### Problem
1. The "No limit" / "Illimite" text displays when the price slider is at max -- this should be removed
2. The sort dropdown (Relevance, Price: Low to High, etc.) is partially hidden/clipped on desktop, appearing to overlap with the price filter area

### Changes

**File: `src/pages/shop/SearchResults.tsx`**

1. **Remove "No limit" text from price filter** (line 649-651): Change the price display so it always shows the dollar amount (`$500,000`) instead of "No limit" when at max value. This makes the filter clearer.

2. **Ensure sort dropdown is fully visible** (lines 622-640): The sort `SelectContent` dropdown may be getting clipped by a parent container. Add `z-50` to the `SelectContent` and ensure the parent flex container doesn't have overflow constraints cutting it off. Move the sort dropdown to sit alongside the price filter row so both are always visible together, rather than being in a header section that can get cramped.

### Specific Edits

**Edit 1** -- Remove "No limit" conditional (lines 649-651):
Replace the conditional text with always showing the dollar value:
```tsx
<span className="text-sm font-medium text-white">
  ${maxPrice.toLocaleString()}
</span>
```

**Edit 2** -- Fix sort dropdown visibility (lines 628):
Add proper z-index to ensure the dropdown renders above other content:
```tsx
<SelectContent className="bg-black/95 border-white/10 z-50">
```

This ensures the sort dropdown menu always renders on top when opened, and the price filter consistently shows numeric values without confusing "No limit" text.

