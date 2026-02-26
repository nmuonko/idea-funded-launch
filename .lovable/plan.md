

## Fix: Crash When Filtering by Category

### Problem
`useQuery` returns `data: undefined` before the query executes. The code checks `categoryOnlyCount !== null`, but `undefined !== null` is `true`, so it tries to call `.toLocaleString()` on `undefined` -- crashing the component.

### Fix
In `src/pages/admin/CatalogCache.tsx` line 1002, change the strict null check to a type guard:

```typescript
// From:
{categoryOnlyCount !== null ? (
// To:
{typeof categoryOnlyCount === 'number' ? (
```

This ensures `.toLocaleString()` is only called on an actual number, guarding against both `undefined` and `null`.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/admin/CatalogCache.tsx` | Line 1002: change `categoryOnlyCount !== null` to `typeof categoryOnlyCount === 'number'` |

