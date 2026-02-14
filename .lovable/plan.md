

# Fix: Instant Variant Selection + Translate Variant Labels

## Problem 1: Variant clicks take 7-15 seconds to show changes

Currently, clicking a variant (e.g., a different color) triggers `navigate()` to a new ASIN route. This causes:
1. The route change effect resets the product
2. A full `catalog-product` API fetch starts for the new ASIN
3. Nothing visibly changes until the fetch completes (7-15s on cache miss)

**Fix**: Instead of navigating, do an **optimistic local update**:
- Immediately update the product image to the variant's thumbnail
- Immediately mark the clicked variant as "current" (highlight it)
- Update the URL with `window.history.replaceState` (no React re-render/fetch)
- Fetch the new ASIN's full data in the background silently
- When the fetch completes, merge the new data (price, title, full images) smoothly

This eliminates the perceived delay entirely -- the user sees the color/image change instantly.

## Problem 2: "Color" and "Size" labels not translated

The variant group labels (Color, Size, Style) come raw from the Amazon API in English. They need to be mapped to translated strings.

**Fix**: Add a translation map for common variant dimension names and apply it in the variant selector rendering.

## Technical Plan

### File: `src/lib/i18n/translations.ts`

Add variant label translations to each language block inside `shop`:

| Key | EN | FR | SW | LN |
|-----|----|----|----|----|
| `variantColor` | Color | Couleur | Rangi | Langi |
| `variantSize` | Size | Taille | Ukubwa | Bonene |
| `variantStyle` | Style | Style | Mtindo | Lolenge |
| `variantStorage` | Storage | Stockage | Hifadhi | Esika |
| `variantPattern` | Pattern | Motif | Muundo | Elilingi |
| `variantMaterial` | Material | Materiau | Nyenzo | Biloko |

### File: `src/pages/shop/ProductDetails.tsx`

**Change 1: Optimistic variant selection (replace `handleVariantSelect`)**

Instead of navigating:

```typescript
const handleVariantSelect = useCallback((asin: string | undefined) => {
  if (!asin || asin === product?.id) return;

  // Find the clicked variant
  const clickedVariant = product?.variants?.find(v => v.asin === asin);
  if (!clickedVariant) return;

  // 1. Optimistic UI update - instant
  setProduct(prev => {
    if (!prev) return prev;
    const newImage = clickedVariant.image;
    const updatedVariants = prev.variants?.map(v => ({
      ...v,
      isCurrent: v.asin === asin,
    }));
    return {
      ...prev,
      id: asin,
      images: newImage ? [newImage] : prev.images,
      variants: updatedVariants,
    };
  });
  setCurrentImageIndex(0);

  // 2. Update URL without triggering navigation
  const displayProv = product?.provider?.toLowerCase() === 'rainforest'
    ? 'amazon' : (product?.provider || 'amazon');
  window.history.replaceState(null, '', `/product/${displayProv}/${asin}`);

  // 3. Background fetch for full product data
  const fetchVariantData = async () => {
    try {
      const apiUrl = new URL(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-product`
      );
      apiUrl.searchParams.set('provider', 'amazon');
      apiUrl.searchParams.set('id', asin);
      apiUrl.searchParams.set('amazon_domain', 'amazon.com');

      const resp = await fetch(apiUrl.toString(), {
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
      });
      const data = await resp.json();
      if (!data?.item) return;
      const item = data.item;

      setProduct(prev => {
        if (!prev || prev.id !== asin) return prev; // stale
        const newImages = item.images || item.imageUrls || 
          (item.image_url ? [item.image_url] : []);
        return {
          ...prev,
          title: item.title || prev.title,
          description: item.description || prev.description,
          images: newImages.length > 0 ? newImages : prev.images,
          priceUsd: item.price_usd || item.priceUsd || prev.priceUsd,
          rating: item.rating ?? prev.rating,
          reviewCount: item.review_count || prev.reviewCount,
          brand: item.brand || prev.brand,
          variants: item.variants || prev.variants,
        };
      });
    } catch (err) {
      console.warn('[ProductDetails] background variant fetch failed', err);
    }
  };

  fetchVariantData();
}, [product]);
```

**Change 2: Translate variant group labels**

Add a helper to map English dimension names to translations:

```typescript
const translateVariantLabel = useCallback((name: string) => {
  const key = name.toLowerCase();
  const map: Record<string, string> = {
    color: shop.variantColor || 'Color',
    colour: shop.variantColor || 'Color',
    size: shop.variantSize || 'Size',
    style: shop.variantStyle || 'Style',
    storage: shop.variantStorage || 'Storage',
    pattern: shop.variantPattern || 'Pattern',
    material: shop.variantMaterial || 'Material',
  };
  return map[key] || name;
}, [shop]);
```

Then in the rendering (line 548), change:
```typescript
// Before:
<h4 className="...">{group.name}</h4>

// After:
<h4 className="...">{translateVariantLabel(group.name)}</h4>
```

## Files Modified

- `src/lib/i18n/translations.ts` -- add 6 variant label keys to each of the 4 language blocks
- `src/pages/shop/ProductDetails.tsx` -- replace `handleVariantSelect` with optimistic update + add `translateVariantLabel` helper

## Expected Results

| Action | Before | After |
|--------|--------|-------|
| Click "Red" color | 7-15s wait, then image changes | Image changes instantly, details update in background |
| "Color" label in French | Shows "Color" (English) | Shows "Couleur" |
| "Size" label in Swahili | Shows "Size" (English) | Shows "Ukubwa" |
