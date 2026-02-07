

# Backend-Only: True Search Proxy with AI Refine + 100/Page + Unified Feed

## Overview

Transform the search backend into a true proxy that always calls both Amazon and eBay for every query, uses AI only for query cleanup (no intent-based provider gating), and supports page-based pagination up to 300 items. No frontend changes.

## Changes

### 1. Add explicit `page` query param support

**File: `supabase/functions/catalog-search/index.ts`**

Currently, pagination uses cursor-based logic (`cursor` param decoded via `decodeMixerCursor`). Add explicit `page` param parsing:

```
const pageParam = Math.min(3, Math.max(1, parseInt(url.searchParams.get("page") || "1", 10)));
```

If `page > 3`, return empty items with `hasMore: false` immediately (enforce 300-item cap).

Use `pageParam` to compute the eBay offset and Amazon page directly, replacing the cursor-derived page. Keep cursor support for backward compatibility (if cursor is provided, derive page from it as today; otherwise use `pageParam`).

### 2. Remove intent-based Amazon skip

**File: `supabase/functions/catalog-search/index.ts`**

Currently at line 598: `const skipAmazon = effectiveIntent.intentKey === "gaming";`

Change to: `const skipAmazon = false;`

This ensures both providers are always called for every search, including gaming queries. The AI refiner + provider native relevance will handle returning appropriate results.

### 3. Remove vehicle-intent minPrice gating

**File: `supabase/functions/catalog-search/index.ts`**

Currently at lines 156-161, vehicle buying intent forces `catalogFilters.minPrice = 500`. Remove this block entirely so searches are not artificially price-filtered based on intent classification.

Also remove the vehicle maxPrice removal logic at lines 122-126.

Keep intent classification running for cache key separation and scoring (it still helps rank results), but it must NOT gate providers or force price filters.

### 4. Ensure AI refiner is always used (already working)

**File: `supabase/functions/_shared/searchAiExpand.ts`** and **`supabase/functions/search-expand-query/index.ts`**

These already work correctly:
- `refineQueryWithAi()` checks DB cache, then calls Lovable AI with 2s timeout
- `search-expand-query` uses Gemini to fix typos, translate FR to EN, normalize brands
- Returns `refined` + `alt` queries
- Falls back to original on any failure

No changes needed here.

### 5. Remove intent-based AI refine skip

**File: `supabase/functions/catalog-search/index.ts`**

Currently at line 503: `const skipAiExpand = isHeavyEquipment || effectiveIntent.intentKey === "gaming";`

Change to: `const skipAiExpand = false;`

AI refinement should always run -- it only cleans queries, it does not classify intent.

### 6. Bump cache version + simplify cache key

**File: `supabase/functions/_shared/catalogCache.ts`**

- Bump `AMAZON_CACHE_VERSION` from `v12` to `v14`
- This invalidates all old cache entries that may contain intent-gated or price-filtered results

### 7. Ensure page is in cache key (already done)

The cache key builder at line 224 already includes `pg=${params.page || 1}` and `sz=${params.pageSize || 20}`. Since we now pass `pageParam` correctly, different pages will get separate cache entries automatically.

### 8. Add `page`, `qRefined`, `sourcesUsed`, `partial` to response

**File: `supabase/functions/catalog-search/index.ts`**

Add these optional fields to the response JSON (non-breaking additions):

```typescript
{
  ...existingFields,
  page: pageParam,
  qRefined: searchMeta.rewriteApplied ? searchMeta.rewrittenQuery : undefined,
  sourcesUsed: sourceServed,  // already computed
  partial: providerTimedOut,
}
```

The frontend already ignores unknown fields, so this is safe.

### 9. Alt-query fallback threshold

The existing fallback logic (lines 686-757) triggers when `totalProviderItems < 60`. This stays as-is -- it searches alt queries from the AI refiner and the canonical form to fill the page. No changes needed.

### 10. "No products found" rule

The existing logic already handles this correctly:
- DB fallback at line 934 returns DB items if providers returned 0
- Related-DB fallback at line 956 for tractor-specific queries
- Line 997-1003: no generic "popular" fallback (prevents contamination)

No changes needed here.

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/catalog-search/index.ts` | Add `page` query param (default 1, max 3). Remove `skipAmazon` (set to `false`). Remove vehicle minPrice/maxPrice gating. Remove `skipAiExpand` (set to `false`). Add `page`/`qRefined`/`sourcesUsed`/`partial` to response. |
| `supabase/functions/_shared/catalogCache.ts` | Bump `AMAZON_CACHE_VERSION` to `v14` |

## What is NOT changed

- No frontend files touched
- Intent classification still runs (for cache separation and scoring/ranking)
- AI refiner (search-expand-query) stays as-is
- Provider mixer stays as-is (interleave Amazon+eBay)
- Response shape is backward-compatible (new fields are additive)
- DB-first search stays as-is
- Content blocker stays as-is
- Rate limiting stays as-is

## Expected Results

- "google pixel" -- both Amazon+eBay searched, returns phone results (no vehicle misclassification gating)
- "toyota camry" -- both providers searched, no $500 minPrice filter, returns vehicles AND accessories naturally
- "ps5" -- both providers searched (Amazon no longer skipped for gaming), returns consoles from both
- "ecouteurs bluetooth" -- AI refines to "bluetooth earbuds", both providers return results
- "toytoa" -- AI refines to "toyota", both providers return results
- Page 1 returns first 100 items, page 2 next 100, page 3 next 100
- Cached queries load instantly, no cross-page cache collisions
