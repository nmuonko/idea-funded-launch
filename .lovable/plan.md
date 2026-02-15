
# Fix: "talon" Corrupted to "tahoe" by Fuzzy Canonicalizer

## Root Cause

When searching "chaussure dame haut talon", the fuzzy canonicalizer at line 144 of `catalog-search/index.ts` runs **before** the French-to-English translation layer (line ~500). It fuzzy-matches "talon" (French for "heel") to "tahoe" (Chevy Tahoe) with Levenshtein distance 2, corrupting the query to "chaussure dame haut tahoe".

This causes two cascading failures:
1. Intent detection sees "tahoe" and classifies the query as `vehicle_listing`
2. Vehicle listing intent disables Amazon search
3. eBay also returns 0 results for the corrupted query
4. Result: "No products found"

The debug headers confirm this: `qCanon: "chaussure dame haut tahoe"`, `intentKey: "vehicle_listing"`, `amazonStatus: "disabled"`.

## Fix

Two changes in `supabase/functions/_shared/queryCanonicalizer.ts`:

### 1. Add common French fashion/body terms as protected tokens

Add these as empty-array entries in `CANONICAL_TERMS` (same pattern as existing protected terms like "rover", "tahoe") to prevent fuzzy corruption:

```
"talon": []     // French for "heel" - prevent "talon" -> "tahoe"
"salon": []     // French for "living room" - prevent fuzzy matches
"pantalon": []  // French for "pants" - prevent fuzzy matches
"manteau": []   // French for "coat" - prevent fuzzy matches
"collier": []   // French for "necklace" - prevent fuzzy matches
```

### 2. Tighten fuzzy matching for 5-char tokens

Currently the threshold is 2 for all tokens >= 4 chars. For short tokens (4-5 chars), Levenshtein distance 2 is too aggressive (40-50% of the word can change). Reduce the threshold to 1 for tokens with 5 or fewer characters:

```typescript
const effectiveThreshold = token.length <= 5 ? 1 : threshold;
```

This prevents "talon" -> "tahoe" (distance 2 > new threshold 1) while still allowing corrections for longer words like "playstaion" -> "playstation" (distance 1).

## Files Changed

- **Modified**: `supabase/functions/_shared/queryCanonicalizer.ts` -- add protected French terms + tighten short-token fuzzy threshold

## Deployment

Redeploy `catalog-search` (which imports the shared module).

## Verification

After deployment, search "chaussure dame haut talon" and confirm:
- `qCanon` does NOT contain "tahoe"
- `intentKey` is NOT `vehicle_listing`
- Results are returned (shoes/heels)
