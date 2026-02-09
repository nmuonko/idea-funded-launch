
# Simplify Cache Settings + Fix Similar Products + Rename Home Tab

## 1. Simplify Admin Cache Settings Page

**File:** `src/pages/admin/CacheSettings.tsx`

Replace the current 7-input form + 3 preset buttons with just 2 inputs:

- **Search Cache TTL (days)** -- single number input
- **Categories/Home Cache TTL (days)** -- single number input

Remove:
- `PRESETS` object and the presets card entirely
- All individual stale/expires/negative inputs
- The "Current Status" card showing 4 separate stats (replace with 2 stats showing the day values)
- The stale-vs-expires validation logic

Keep:
- Clear Search Cache button + confirmation dialog (unchanged)
- Save button

On save, compute all 7 DB fields from the 2 inputs:
```
search_expires_minutes = searchTtlDays * 1440
search_stale_minutes = floor(searchTtlDays * 1440 * 0.5)
home_expires_minutes = categoriesTtlDays * 1440
home_stale_minutes = floor(categoriesTtlDays * 1440 * 0.5)
offers_expires_minutes = home_expires_minutes
offers_stale_minutes = home_stale_minutes
negative_expires_seconds = 120 (fixed)
```

On load, reverse-compute the day values from existing DB data:
```
searchTtlDays = Math.round(search_expires_minutes / 1440)
categoriesTtlDays = Math.round(home_expires_minutes / 1440)
```

The form state becomes just `{ searchTtlDays: number; categoriesTtlDays: number }`.

---

## 2. Backend Cache: Query Normalization + cacheHit Flag

**Already implemented.** The codebase already has:
- `normalizeQuery()` in `catalogCache.ts` (lines 117-133): lowercases, removes accents/diacritics, strips punctuation, collapses whitespace
- `canonicalizeQuery()` via import from `queryCanonicalizer.ts`: corrects common typos
- Cache key built using the normalized+canonicalized query
- `_cacheHit: true` flag already returned on fresh cache hits (line 449) and stale hits (line 490)
- On cache hit, the function returns immediately without calling providers (lines 442-452)

**No backend changes needed** for items 2A and 2B -- they are already working.

---

## 3. Frontend: Skip Loading on Cache Hit

**File:** `src/pages/shop/SearchResults.tsx`

The backend already returns `_cacheHit: true`. The frontend client-side cache (`cachedCatalogFetch`) also returns cached results instantly. The loading spinner is already only shown on `pageNum === 1 && !append` (line 103-104).

Since `cachedCatalogFetch` has its own in-memory cache that returns instantly on repeat queries, and the backend returns fast on DB cache hits, no change is needed here. The perceived delay is already minimal on cache hits.

**No change needed.**

---

## 4. Fix Similar Products Image Merge Bug

**File:** `src/pages/shop/ProductDetails.tsx`

**Problem:** When clicking a similar product, React Router navigates to a new URL but the component doesn't reset state. The `setProduct` updater at line 125-150 merges images from old product with new product's images.

**Fix (3 changes):**

**4A) Add state reset on route param change:**
Add a `useEffect` before the fetch effect that resets all state when `provider` or `id` changes:
```typescript
useEffect(() => {
  const nav = (location.state as any)?.product;
  setProduct(nav ? {
    id: nav.id, provider: nav.provider, title: nav.title,
    description: undefined,
    images: nav.imageUrl ? [nav.imageUrl] : ['/placeholder.svg'],
    priceUsd: nav.priceUsd || 0, rating: nav.rating,
    reviewCount: undefined, inStock: true,
    productUrl: nav.productUrl, brand: undefined,
  } : null);
  setCurrentImageIndex(0);
  setSimilarProducts([]);
  setQuantity(1);
  setAdded(false);
  setLoading(!nav);
  setError(null);
}, [provider, id]);
```

**4B) Only merge images for same product:**
In the `setProduct` updater inside `fetchProduct` (line 125), add a guard:
```typescript
setProduct(prev => {
  // ...build newImages...
  // Only merge if same product (enrichment), otherwise replace
  let mergedImages = newImages;
  if (prev?.id && (prev.id === item.provider_product_id || prev.id === item.id)) {
    const existingSet = new Set(prev.images);
    const additional = newImages.filter((img: string) => !existingSet.has(img));
    mergedImages = [...prev.images, ...additional];
  }
  // ...rest unchanged...
});
```

---

## 5. Rename "Maison et Jardin" / "Home & Garden" Tab

**File:** `src/lib/i18n/translations.ts`

Change the `homeGarden` translation key values:
- EN: `"Living Room, Dining & Kitchen"` (line 264)
- FR: `"Salon, Salle à Manger & Cuisine"` (line 656)
- SW: `"Sebule, Meza ya Chakula & Jiko"` (line 1052)
- LN: `"Salon, Mesa ya Bilei & Cuisine"` (line 1448)

No change in `CategoryTabs.tsx` -- it already reads `shop.homeGarden`.

---

## 6. Update Default Queries for Home Tab

**File:** `src/pages/shop/SearchResults.tsx` (line 59)

Change default query for `home` category:
```typescript
home: 'living room furniture sofa dining table kitchen appliances',
```

**File:** `supabase/functions/catalog-category/index.ts` (line 134)

Change default query for `home_garden` category:
```typescript
home_garden: "living room furniture set dining room table kitchen appliances",
```

---

## Summary

| File | Change |
|------|--------|
| `src/pages/admin/CacheSettings.tsx` | Rewrite to 2 TTL inputs + Save + Clear Cache. Remove presets, stale/expires, negative inputs |
| `src/pages/shop/ProductDetails.tsx` | Reset state on param change; only merge images for same product ID |
| `src/lib/i18n/translations.ts` | Rename homeGarden in all 4 languages |
| `src/pages/shop/SearchResults.tsx` | Update home default query |
| `supabase/functions/catalog-category/index.ts` | Update home_garden default query |
