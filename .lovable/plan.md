
# Show Specific Console Models in Gaming Tab

## Problem
The current gaming query `"video game console xbox ps5 nintendo switch"` is too generic and returns irrelevant results. The user wants the Gaming tab to show exactly these consoles:
- PlayStation 5 Slim
- Xbox One X
- Xbox One S
- PlayStation 5
- Xbox One
- Nintendo Switch 2
- Xbox Series S
- Xbox 360

## Change (1 file)

### `src/pages/shop/SearchResults.tsx` (line 58)

Replace the generic gaming query with a specific console-focused query:

```
Before: 'video game console xbox ps5 nintendo switch'
After:  'PlayStation 5 Xbox One Nintendo Switch Xbox Series S Xbox 360'
```

This directly targets the exact console models the user wants. The backend gaming intent scorer will still filter out any accessories or junk that slip through.

### `supabase/functions/_shared/searchIntentScorer.ts`

Update the `GAMING_SIGNALS` list to include the specific model names so they pass the relevance gate:

- Add: `"playstation 5 slim"`, `"xbox one x"`, `"xbox one s"`, `"xbox one"`, `"nintendo switch 2"`, `"xbox series s"`, `"xbox 360"`, `"playstation 5"`

Also raise the price cap from $2,000 to $3,000 to accommodate premium console bundles.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/shop/SearchResults.tsx` | Use specific console model names as the gaming query |
| `supabase/functions/_shared/searchIntentScorer.ts` | Add specific model names to GAMING_SIGNALS list |
