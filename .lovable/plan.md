
# Fix: Product Page 404 Error - Route Mismatch

## Problem Summary

When clicking any product from the home page or search results, the app shows a **404 "Page not found"** error.

**URL shown in screenshot:** `/shop/product/ebay/v1%7C1471367119951%7C0`

This URL should work, but the app's router doesn't recognize it.

---

## Root Cause

There's a path mismatch between where product links point and where the router expects them:

| Component | Current Link Path | Router Expected Path |
|-----------|------------------|---------------------|
| ProductCard.tsx | `/shop/product/:provider/:id` | `/product/:provider/:id` |

The ProductCard component generates URLs with `/shop/product/...` but the router only has a route for `/product/...` (without the `/shop` prefix).

---

## Solution

Two changes are needed:

### 1. Fix ProductCard Link (Primary Fix)

Update the link generation to use the correct path format.

**File:** `src/components/shop/ProductCard.tsx`

**Line 97 - Change:**
```tsx
// Before (broken)
to={`/shop/product/${product.provider}/${encodeURIComponent(product.id)}`}

// After (fixed)
to={`/product/${product.provider}/${encodeURIComponent(product.id)}`}
```

### 2. Add Redirect for Legacy URLs (Compatibility)

Add a redirect route to catch any existing bookmarks or shared links that use the old `/shop/product/` path.

**File:** `src/App.tsx`

Add new redirect in the "Legacy /shop redirects" section (around line 180):
```tsx
<Route 
  path="/shop/product/:provider/:id" 
  element={<Navigate to="/product/:provider/:id" replace />} 
/>
```

**Note:** Since React Router Navigate doesn't automatically pass route params, we need a small wrapper component:

```tsx
// Add a ShopProductRedirect component that extracts params and redirects
function ShopProductRedirect() {
  const { provider, id } = useParams();
  return <Navigate to={`/product/${provider}/${id}`} replace />;
}

// Then use it in routing:
<Route path="/shop/product/:provider/:id" element={<ShopProductRedirect />} />
```

---

## Files to Modify

1. **`src/components/shop/ProductCard.tsx`** - Fix line 97 to remove `/shop` prefix
2. **`src/App.tsx`** - Add redirect route for `/shop/product/*` → `/product/*`

---

## Expected Result

After these changes:
- Clicking any product card will navigate to `/product/ebay/v1|1471367...` (correct path)
- Any existing bookmarks to `/shop/product/...` will automatically redirect
- Product details page will load correctly showing full product information
