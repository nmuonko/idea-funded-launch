
# Fix Product Display, Carousel, and Hero Title

This plan addresses three issues: (1) products not loading when clicked, (2) ugly carousel design, and (3) the hero title.

---

## Issue 1: Products Not Loading (Both Amazon and eBay)

### Root Cause
The product ID handling has a format mismatch:

1. **API returns**: 
   - `id: "ebay_v1|396933724901|0"` (with underscore separator)
   - `providerProductId: "v1|396933724901|0"` (clean item ID)

2. **ShopHome maps**: `product.id = item.provider_product_id || item.id`
   - If `provider_product_id` exists: Uses `v1|396933724901|0` 
   - If not: Uses `ebay_v1|...` (includes provider prefix)

3. **ProductCard links to**: `/shop/product/ebay/v1|396933724901|0`

4. **ProductDetails builds**: `ebay:v1|396933724901|0` → Works!

   But when IDs include the prefix: `/shop/product/ebay/ebay_v1|...`
   ProductDetails builds: `ebay:ebay_v1|...` → Double prefix, NOT found

### Fix: Clean ID handling in ProductDetails.tsx

Modify the fetch logic to detect and strip redundant prefixes:

```typescript
// In ProductDetails.tsx fetchProduct()
const productIdDecoded = decodeURIComponent(id);

// Strip redundant provider prefix if ID starts with "amazon_" or "ebay_" 
let cleanProductId = productIdDecoded;
if (provider === 'ebay' && productIdDecoded.startsWith('ebay_')) {
  cleanProductId = productIdDecoded.slice(5); // Remove "ebay_"
} else if (provider === 'rainforest' && productIdDecoded.startsWith('amazon_')) {
  cleanProductId = productIdDecoded.slice(7); // Remove "amazon_"
} else if (provider === 'rainforest' && productIdDecoded.startsWith('rainforest_')) {
  cleanProductId = productIdDecoded.slice(11); // Remove "rainforest_"
}

const fullId = `${provider}:${cleanProductId}`;
```

### Files to modify:
- `src/pages/shop/ProductDetails.tsx` - Add ID normalization

---

## Issue 2: Carousel Design Improvements

### Current Problems:
1. Carousel extends full width without container constraints
2. Product images are tiny (20x20 in corner)
3. Cards are visually cramped
4. Text is hard to read on gradient backgrounds

### Design Changes:

**Container width**: Add `container mx-auto` to constrain width

**Card redesign**:
- Larger card size: `w-56 h-44` (from `w-64 h-36`)
- Bigger product image: `w-28 h-28` centered or prominently placed
- Better text contrast with shadow
- Cleaner layout with price badge

**Updated FeaturedCarousel layout**:
```text
┌─────────────────────────────────────┐
│  ✨  iPhone 16 Pro Max              │
│      $39.99                         │
│                                     │
│                    [LARGE IMAGE]    │
│                                     │
└─────────────────────────────────────┘
```

### Files to modify:
- `src/components/shop/FeaturedCarousel.tsx` - Redesign card layout

---

## Issue 3: Hero Title

### Options:
The user said to fix or remove "Shop the U.S. Delivered to Africa"

**Recommended: Remove hero section entirely**

The FeaturedCarousel provides visual interest, and the category tabs provide navigation. The hero text is redundant with the overall AfriShop branding.

This simplifies the homepage and reduces visual clutter.

### Alternative: Make it minimal
If kept, reduce to just the description line "Browse millions of products from Amazon & eBay" without the large title.

### Files to modify:
- `src/pages/shop/ShopHome.tsx` - Remove or minimize hero section

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/shop/ProductDetails.tsx` | Add ID normalization to strip redundant provider prefixes |
| `src/components/shop/FeaturedCarousel.tsx` | Redesign cards: larger images, contained width, better visibility |
| `src/pages/shop/ShopHome.tsx` | Remove hero title section |

---

## Technical Implementation

### ProductDetails.tsx - ID Normalization

```typescript
const fetchProduct = async () => {
  if (!provider || !id) return;
  
  const productIdDecoded = decodeURIComponent(id);
  
  // Normalize: Strip redundant provider prefix from ID
  let cleanProductId = productIdDecoded;
  const lowerProvider = provider.toLowerCase();
  const lowerProductId = productIdDecoded.toLowerCase();
  
  if (lowerProvider === 'ebay' && lowerProductId.startsWith('ebay_')) {
    cleanProductId = productIdDecoded.slice(5);
  } else if (lowerProvider === 'ebay' && lowerProductId.startsWith('ebay:')) {
    cleanProductId = productIdDecoded.slice(5);
  } else if ((lowerProvider === 'rainforest' || lowerProvider === 'amazon') 
             && lowerProductId.startsWith('amazon_')) {
    cleanProductId = productIdDecoded.slice(7);
  } else if (lowerProvider === 'rainforest' && lowerProductId.startsWith('rainforest_')) {
    cleanProductId = productIdDecoded.slice(11);
  }
  
  const fullId = `${provider}:${cleanProductId}`;
  // ... rest of fetch
};
```

### FeaturedCarousel.tsx - New Card Design

```typescript
<motion.div
  className={`relative w-56 h-44 rounded-2xl bg-gradient-to-br ${product.gradient} p-5 overflow-hidden`}
>
  {/* Large centered product image */}
  <div className="absolute right-4 top-1/2 -translate-y-1/2 w-28 h-28">
    <img 
      src={product.imageUrl} 
      alt={product.title}
      className="w-full h-full object-contain drop-shadow-2xl"
    />
  </div>
  
  {/* Text content with shadow for readability */}
  <div className="relative z-10 h-full flex flex-col justify-between pr-28">
    <Sparkles className="h-5 w-5 text-white/80" />
    
    <div>
      <h3 className="text-lg font-bold text-white drop-shadow-lg line-clamp-2">
        {product.title.slice(0, 25)}...
      </h3>
      <p className="text-xl font-bold text-white mt-1">
        ${product.priceUsd.toFixed(2)}
      </p>
    </div>
  </div>
</motion.div>
```

### ShopHome.tsx - Remove Hero

Remove lines 74-97 (the hero section), keeping only the FeaturedCarousel and CategoryTabs.

---

## Expected Result

1. **Products load correctly** - Both Amazon and eBay products display when clicked
2. **Carousel looks polished** - Larger product images, contained width, clear pricing
3. **Cleaner homepage** - No redundant title text, straight into browsing
