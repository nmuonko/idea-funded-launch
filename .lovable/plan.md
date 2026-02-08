

# Fix: Slow Product Detail Loading + Broken Similar Products

## Problem 1: Slow Product Detail Page

When you click a search result, the detail page makes a **brand new API call** to `catalog-product` instead of using the data already loaded from search. The logs show these calls take **5-14 seconds** because:
- The product is not in `catalog_items` DB (cache miss)
- A live API call to Amazon/eBay is triggered
- This happens every time, even though the search results already have the product info

### Fix

Pass the search result data to the product detail page via React Router navigation state. When the detail page loads:
1. If navigation state has the product data, display it **instantly** (no loading spinner)
2. Still fetch full details (description, gallery images) in the **background** to enrich the view
3. If no navigation state (e.g. direct URL), fall back to the current API call behavior

**Files to modify:**
- `src/components/shop/ProductCard.tsx` -- pass product data via Link state
- `src/pages/shop/ProductDetails.tsx` -- read navigation state for instant display, then enrich in background

---

## Problem 2: Similar Products Show $0.00 and No Images

The similar products mapper in `ProductDetails.tsx` reads **snake_case** field names (`i.image_url`, `i.price_usd`), but the `catalog-search` API returns **camelCase** (`imageUrl`, `priceUsd`). This means every similar product gets:
- `imageUrl: undefined || ''` (empty string, no image)
- `priceUsd: undefined || 0` ($0.00)

### Fix

Update the similar products mapper to read both camelCase and snake_case variants:
```
imageUrl: i.imageUrl || i.image_url || i.mainImageUrl || ''
priceUsd: i.priceUsd || i.price_usd || 0
```

**File to modify:**
- `src/pages/shop/ProductDetails.tsx` (lines 133-141)

---

## Technical Details

### ProductCard.tsx changes

Add product data to the Link's `state` prop so it's available on the detail page without an API call:

```typescript
<Link
  to={`/product/${getProviderForUrl()}/${encodeURIComponent(getProductIdForUrl())}`}
  state={{ product: { id: product.id, provider: product.provider, title: product.title, imageUrl: product.imageUrl, priceUsd: product.priceUsd, rating: product.rating, productUrl: product.productUrl } }}
>
```

### ProductDetails.tsx changes

1. Read `location.state?.product` on mount
2. If present, immediately populate the product state (no loading spinner)
3. Still call `catalog-product` in background for full data (description, all gallery images, brand, stock status)
4. Fix the similar products field name mapping

### Expected Results

- Product detail pages load **instantly** when navigating from search/home (data is passed via router state)
- Direct URL access still works (falls back to API call)
- Similar products display correct images and prices
- No changes to backend/edge functions needed

