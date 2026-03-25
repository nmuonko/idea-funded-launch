

# Fix Hot Product Pricing on Product Detail Page

## Problem

The "Commander" button in the **admin email preview** links to the product page WITHOUT the `?hot=1` parameter. This means when you click it, the product detail page shows regular pricing (Article + Markup + Shipping = $428.51) instead of the all-inclusive hot product price ($398.85).

The **actual sent email** already includes `?hot=1` correctly — this is only a preview bug. But to be safe, I'll also make the product detail page more resilient by always checking the hot products database even without the URL param.

## Plan

### 1. Fix admin preview links to include `?hot=1`

**File**: `src/pages/admin/HotProducts.tsx` — `buildPreviewHtml()` (line 663)

Change the "Commander" link from:
```html
<a href="${p.product_url}">
```
to:
```html
<a href="${p.product_url}${p.product_url.includes('?') ? '&' : '?'}hot=1">
```

### 2. Always check hot products DB on product detail load (belt-and-suspenders)

**File**: `src/pages/shop/ProductDetails.tsx` — hot product useEffect (line 524)

Currently the DB lookup only runs when `?hot=1` is in the URL or `location.state` is missing. Change it to **always** query `hot_products_showcase` for the current product. If found, set `hotProductPrice` and `isFixedPrice` becomes true automatically. This ensures even direct links without `?hot=1` show the correct all-inclusive price.

The query is a lightweight `maybeSingle()` call — negligible performance impact.

---

## Technical Details

- No backend/edge function changes needed
- The actual email campaign links are already correct
- This fixes both: preview clicks AND any direct product URL shares where `?hot=1` might be missing

