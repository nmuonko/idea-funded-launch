

# Fix: `catalog-refresh-worker` "duplicateRatio is not defined" Error

## Problem
The variable `duplicateRatio` is declared with `const` inside an `else` block (line 908) but referenced outside it (line 928). This crashes the uniqueness gate on every builder source.

## Fix

### File: `supabase/functions/catalog-refresh-worker/index.ts`

**Line 888-908** -- Move `duplicateRatio` declaration before the `if/else` block:

Replace:
```typescript
const { error: upsertErr } = await supabase
  .from("catalog_items")
  .upsert(upsertRows, { onConflict: "provider,provider_product_id" });

if (upsertErr) {
  console.error(`[BUILDER] Upsert error source ${source.id}:`, upsertErr.message);
} else {
  // ...
  const duplicateRatio = productIds.length > 0 ? duplicateCount / productIds.length : 0;
```

With:
```typescript
const { error: upsertErr } = await supabase
  .from("catalog_items")
  .upsert(upsertRows, { onConflict: "provider,provider_product_id" });

let duplicateRatio = 0;

if (upsertErr) {
  console.error(`[BUILDER] Upsert error source ${source.id}:`, upsertErr.message);
} else {
  // ...
  duplicateRatio = productIds.length > 0 ? duplicateCount / productIds.length : 0;
```

Two changes:
1. Add `let duplicateRatio = 0;` before the `if (upsertErr)` block (after line 891)
2. Change line 908 from `const duplicateRatio = ...` to `duplicateRatio = ...`

### Deployment
Re-deploy `catalog-refresh-worker` after the fix.

