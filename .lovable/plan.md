
# Fix: `catalog-refresh-worker` "duplicateRatio is not defined" Error

## Problem

The `catalog-refresh-worker` edge function is throwing `duplicateRatio is not defined` for every builder source. This happens because `duplicateRatio` is declared as a `const` inside an `else` block (line 908) but referenced outside that block (line 928). In JavaScript, `const` is block-scoped, so the variable simply doesn't exist at line 928.

This means the catalog builder's "uniqueness gate" (Guardrail 7) crashes on every source, preventing proper catalog refresh processing.

## Fix

Move the `duplicateRatio` variable declaration (and related variables) outside the `if/else` block so it's accessible at line 928. Initialize it with a default value of `0`.

### File: `supabase/functions/catalog-refresh-worker/index.ts`

**Before (broken scoping):**
```
if (upsertErr) {
  console.error(...);
} else {
  // ... counting logic ...
  const duplicateRatio = ...;  // <-- scoped inside else
}

// Line 928: duplicateRatio is NOT defined here
if (duplicateRatio > BUILDER_DUPLICATE_THRESHOLD) { ... }
```

**After (fixed):**
```
let duplicateRatio = 0;

if (upsertErr) {
  console.error(...);
} else {
  // ... counting logic ...
  duplicateRatio = ...;  // <-- now assigns to outer variable
}

// Line 928: duplicateRatio IS defined here
if (duplicateRatio > BUILDER_DUPLICATE_THRESHOLD) { ... }
```

Specifically, change lines 906-908 to use `let` declarations before the `if` block, then assign inside the `else`. The minimal change is:

1. Add `let duplicateRatio = 0;` before line 892 (before the `if (upsertErr)`)
2. Change line 908 from `const duplicateRatio = ...` to `duplicateRatio = ...` (remove `const`)

### Deployment
- Re-deploy `catalog-refresh-worker` after the fix

## Impact
This will restore the catalog builder's ability to process all 11+ sources without crashing, allowing new products to be ingested properly.
