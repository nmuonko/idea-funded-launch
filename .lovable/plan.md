

# Fix: Canonicalizer Bug + Provider Timeout Exceeding Budget

## Two Bugs Found

### Bug 1: "camon" corrupted to "camry" by fuzzy matcher

The `fuzzyMatch()` function in `queryCanonicalizer.ts` matches "camon" (Tecno phone model) to "camry" (Toyota car model) with Levenshtein distance 2 (threshold=2). This causes "tecno camon 20" to search for "tecno camry 20" -- returning 0 results.

**Fix**: Add "camon" (and other Tecno model names) to `CANONICAL_TERMS` as protected terms with empty arrays, just like "camry" is already protected. This prevents fuzzy matching from corrupting them.

```typescript
// In CANONICAL_TERMS, after the tecno entry:
"camon": [],     // Tecno Camon phone model - prevent fuzzy match to "camry"
"spark": [],     // Tecno Spark phone model
"pouvoir": [],   // Tecno Pouvoir phone model  
"phantom": [],   // Tecno Phantom phone model
```

### Bug 2: Provider timeout (5000ms) exceeds total budget (3500ms)

The `PROVIDER_TIMEOUT_MS` is set to 5000ms (line 695), but the total budget is only 3500ms. By the time providers start (after rewrite ~200ms), there's only ~3300ms left, yet providers are allowed 5000ms. The budget check only gates alt queries -- it never stops the primary provider fetch.

**Fix**: Calculate a dynamic provider timeout based on remaining budget:

```text
const elapsed = Date.now() - startTime;
const PROVIDER_TIMEOUT_MS = Math.min(
  isVehicleIntent ? 6000 : 4000,       // absolute max
  Math.max(2000, TOTAL_BUDGET_MS - elapsed - 200)  // remaining budget minus 200ms for post-processing
);
```

This ensures the provider fetch respects the overall 3500ms budget. For "cuisiniere 4 feux" with 200ms spent on rewrite, providers get ~3100ms instead of 5000ms.

## Technical Changes

### File 1: `supabase/functions/_shared/queryCanonicalizer.ts`

Add protected Tecno model names to `CANONICAL_TERMS` (around line 20, after the "tecno" entry):

```typescript
"camon": [],     // Tecno Camon - prevent "camon" -> "camry" fuzzy match
"spark": [],     // Tecno Spark model
"pouvoir": [],   // Tecno Pouvoir model
"phantom": [],   // Tecno Phantom model
```

### File 2: `supabase/functions/catalog-search/index.ts`

Replace the static `PROVIDER_TIMEOUT_MS` (lines 694-695) with a dynamic calculation:

```typescript
const elapsedBeforeProviders = Date.now() - startTime;
const PROVIDER_TIMEOUT_MS = Math.min(
  isVehicleIntent ? 6000 : 4000,
  Math.max(2000, TOTAL_BUDGET_MS - elapsedBeforeProviders - 200)
);
```

This ensures:
- "tecno camon 20" (fast path, ~200ms pre-work): providers get ~3100ms
- "cuisiniere 4 feux" (~300ms pre-work): providers get ~3000ms
- Vehicle queries: capped at 6000ms (vehicles need eBay Motors which is slower)
- Minimum 2000ms so providers always have a reasonable window

## Expected Results After Fix

| Query | Before | After |
|-------|--------|-------|
| "tecno camon 20" | 0 results (camon->camry bug) | Correct results, ~3s |
| "cuisiniere 4 feux" | 8s (provider timeout too high) | ~3.5s max |
| Same query (cache hit) | Instant | Instant (unchanged) |

## What Is NOT Changed

- No payment, checkout, or category logic
- Cache key format unchanged
- Alt query logic unchanged (already capped at 1)
- Fast path detection unchanged
- Timing headers unchanged (already working)

