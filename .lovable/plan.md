

# Fix Product Gallery: Missing Interface Fields Crash the Backend

## Root Cause

The `catalog-product` backend function **crashes on startup** due to a TypeScript compilation error. The logs show only "shutdown" messages -- the function never processes a single request.

**The bug:** When we added `categoryKey` and `vehiclesSubkey` to the response in `mapDbItemToResponse()`, we forgot to add these fields to the `CatalogItem` TypeScript interface. Deno's strict TypeScript rejects object literals with extra properties from a function with an explicit return type, causing a compile-time crash.

```text
mapDbItemToResponse() returns { ..., categoryKey, vehiclesSubkey }
                                      ^^^^^^^^^   ^^^^^^^^^^^^^^^
                    These fields don't exist in the CatalogItem interface (lines 222-250)
                    = TypeScript compile error = function won't start
```

This is why **every product** shows only one image -- the API call fails entirely, so the frontend falls back to the single search thumbnail passed via navigation state.

## Fix

Add the two missing fields to the `CatalogItem` interface:

**File:** `supabase/functions/catalog-product/index.ts` (lines 222-250)

Add after the existing `category` field:
```typescript
categoryKey?: string | null;
vehiclesSubkey?: string | null;
```

That's it. One interface update fixes everything -- the function will compile, boot, and return full gallery data again.

## Technical Details

| File | Change |
|------|--------|
| `supabase/functions/catalog-product/index.ts` | Add `categoryKey` and `vehiclesSubkey` to `CatalogItem` interface (2 lines) |

No frontend changes needed -- the frontend already handles these fields correctly (lines 294-295 in ProductDetails.tsx).

