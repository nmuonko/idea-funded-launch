

# Fix: Flush Remaining Poisoned Cache Entries

## Root Cause

The code fix (POISON_SUFFIXES safety check) is working correctly for **new** queries. However, **18 poisoned entries still exist** in `search_query_expansions` and at least 1 in `catalog_cache` from before the fix was deployed. The second account is hitting these stale cached entries.

Specific examples found:
- `"tesla model 3"` cached as `"tesla model 3 accessories"`
- `"2017 toyota prius"` cached as `"2017 toyota prius parts"`
- `"ford car"` cached as `"ford car accessories"`
- `"toyota"` cached as `"toyota car accessories"`
- A `catalog_cache` entry for `query: "toyota prius accessories"` still exists with a future expiry

## Fix (Data Cleanup Only, No Code Changes)

### Step 1: Delete all poisoned `search_query_expansions` entries

Delete all 18 rows where any expanded term contains "accessories", "parts", or "floor mat":

```sql
DELETE FROM search_query_expansions 
WHERE expanded_terms::text ILIKE '%accessories%' 
   OR expanded_terms::text ILIKE '%parts%'
   OR expanded_terms::text ILIKE '%floor mat%';
```

### Step 2: Delete stale `catalog_cache` entries for vehicle queries

Delete old catalog cache entries where the stored query contains poison suffixes:

```sql
DELETE FROM catalog_cache 
WHERE query ILIKE '%accessories%' 
   OR query ILIKE '%parts%'
   OR query ILIKE '%floor mat%';
```

### Step 3: Verify

After flushing, both accounts should get fresh (non-poisoned) results on next search.

## Why This is Safe

- The POISON_SUFFIXES safety check in `catalog-search/index.ts` prevents new poisoned entries from being created
- The updated AI refiner prompt also instructs Gemini not to add suffixes to vehicle queries
- Deleting these cache rows just forces a fresh fetch, which will now produce correct results
- No code changes needed -- the fix is purely data cleanup

