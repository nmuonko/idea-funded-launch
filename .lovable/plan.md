

## Problem Analysis

Two issues with category filtering on the homepage:

### Root Cause 1: Wrong category sent to backend
In `ShopHome.tsx` line 537, when user selects "Ordinateurs/Laptops" (`computers`), the frontend remaps it to `electronics`:
```ts
const endpointCategory = catKey === 'computers' ? 'electronics' : catKey;
```
This sends the broad `electronics` category to `catalog-category`, which returns phones, cables, HDMI adapters, etc. Then `isRelevantToCategory` filters client-side with computer keywords, dropping most items → **only 9 survive out of 200 fetched**.

The backend **already supports** `computers` as an alias for `electronics_computers` (in `categoryRegistry.ts` line 107). So the fix is to stop remapping and send `computers` directly.

### Root Cause 2: Inflated total count
The backend's `total` reflects the full `electronics` category (~10,000 items), but only 9 pass the client-side keyword filter. The UI shows "Affichage 9 sur 10,000 produits" which is misleading.

The DB count query (line 793-800) counts items where `unified_category = canonicalKey`. If `canonicalKey` resolves to `electronics_computers`, the count should be accurate. The frontend should use the post-filter count, not the raw backend total.

---

## Plan

### 1. Fix category mapping in `ShopHome.tsx`
- **Remove** the `computers → electronics` remapping on line 537. Send `catKey` directly to the backend for all categories. The backend's category registry handles alias resolution.
- Also check for any other similar remappings that bypass the backend's resolver.

### 2. Remove redundant client-side keyword filtering on backend results
- Line 556: `.filter(p => isRelevantToCategory(p, catKey))` — this aggressively filters backend results using title keywords. Since the backend already resolves to the correct subcategory and queries the DB/eBay accordingly, this double-filtering causes data loss.
- **Remove** the `isRelevantToCategory` filter on `catalog-category` results. Keep it only for fallback search results where relevance isn't guaranteed.

### 3. Fix total count display
- After removing the keyword filter, the backend's `total` should be accurate since it now queries `electronics_computers` (not broad `electronics`).
- Update `setCategoryTotalCount` to use the count of actually displayed items when it's clearly lower than backend total, to prevent the "9 sur 10,000" mismatch.

### Files changed
- `src/pages/shop/ShopHome.tsx` — lines 537 and 556

