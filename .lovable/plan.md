

# Fix: Toyota Prius (and all vehicle queries) returning empty results

## Root Cause

The AI query refiner (Gemini) cached a bad refinement:
- `"toyota prius"` was refined to `"toyota prius accessories"`
- This poisoned query gets sent to eBay Motors category 6001 (Cars and Trucks)
- Searching "toyota prius accessories" in Cars and Trucks returns 0 results
- Both providers return 0, so the user sees "No products found"

The same problem exists for other vehicle queries in the cache:
- `"2018 toyota prius"` was refined to `"2018 toyota prius accessories"`
- `"2017 toyota prius"` was refined to `"2017 toyota prius parts"`

## Fix (3 parts)

### 1. Update AI Refiner Prompt to Protect Vehicle Queries

**File: `supabase/functions/search-expand-query/index.ts`**

Add an explicit rule to the system prompt:
- "For vehicle queries (car brand + model like 'toyota prius', 'bmw x5', 'honda civic'), the refined query should be the vehicle name itself. Do NOT append 'accessories', 'parts', 'case', 'cover', or any product-type suffix. The user is searching for the vehicle."
- Add examples: `"toyota prius"` refined to `"toyota prius"`, `"2018 bmw x5"` refined to `"2018 bmw x5"`

### 2. Add Post-Refine Safety Check in catalog-search

**File: `supabase/functions/catalog-search/index.ts`**

After receiving the AI refined query (around line 496), add a safety check: if `isVehicleLikeQuery(originalQuery)` is true, strip any parts/accessories poison words from the refined query. If the refined query added words like "accessories", "parts", "case", "cover", "floor mats" etc., revert to the original query.

This prevents ANY future bad AI refinements from poisoning vehicle searches, regardless of prompt changes.

### 3. Flush Bad Cached Refinements

**File: `supabase/functions/catalog-search/index.ts`** (or via a one-time cache cleanup)

Delete the poisoned cache entries from `search_query_expansions` where the refined query contains parts/accessories terms for vehicle-like queries. This can be done by bumping the cache or adding a cleanup step.

Simplest approach: delete all rows from `search_query_expansions` where `expanded_terms[1]` contains "accessories" or "parts" and the query is a known vehicle brand. Or just flush all entries for vehicle-like queries to let them re-cache with the fixed prompt.

## Technical Details

### Safety Check (catalog-search/index.ts, after line 496)

```typescript
// Safety: if original query is vehicle-like, don't let AI add parts/accessories terms
const POISON_SUFFIXES = ["accessories", "parts", "floor mats", "car parts", 
  "case", "cover", "phone", "charger"];

if (isVehicleLikeQueryGuardrail(qOriginal)) {
  const refinedLower = aiRefineResult.refined.toLowerCase();
  const originalLower = qNorm.toLowerCase();
  const addedWords = refinedLower.replace(originalLower, "").trim();
  if (POISON_SUFFIXES.some(p => addedWords.includes(p))) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_refine_BLOCKED_vehicle_poison: "${aiRefineResult.refined}"`);
    // Revert to original, don't use poisoned refinement
    // skip the override
  } else {
    // safe to use
    qNorm = aiRefineResult.refined;
    searchMeta.rewrittenQuery = aiRefineResult.refined;
    searchMeta.rewriteApplied = true;
  }
}
```

### Prompt Update (search-expand-query/index.ts)

Add to RULES section:
```
- For vehicle brand+model queries (toyota prius, bmw x5, honda civic, etc.), 
  return the vehicle name as-is. Do NOT add "accessories", "parts", "case", 
  or any suffix. The user wants the vehicle itself.
```

Add to EXAMPLES:
```
- "toyota prius" -> refined: "toyota prius"
- "2018 bmw x5" -> refined: "2018 bmw x5"
- "honda civic" -> refined: "honda civic"
```

### Cache Flush

Run a database cleanup to delete poisoned entries:
```sql
DELETE FROM search_query_expansions 
WHERE expanded_terms[1] LIKE '%accessories%' 
   OR expanded_terms[1] LIKE '%parts%'
   OR expanded_terms[1] LIKE '%floor mat%';
```

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/search-expand-query/index.ts` | Add vehicle-protection rule and examples to AI prompt |
| `supabase/functions/catalog-search/index.ts` | Add post-refine safety check to block poisoned refinements for vehicle queries |
| Database | Flush poisoned cache entries from `search_query_expansions` |

## Expected Results

- "toyota prius" returns actual Toyota Prius vehicle listings
- "2018 bmw x5" returns BMW X5 listings, not accessories
- Non-vehicle queries (iphone, ps5, etc.) continue to benefit from AI refinement
- Future bad AI refinements for vehicle queries are automatically caught and blocked

