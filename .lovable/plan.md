

# Fix Category Relevance, Trending Variety, and Grid Padding

## Problems Identified
1. **Electronics tab shows sofas/furniture** -- The `electronics` keyword list includes overly broad terms like `'smart'` (matches "smart sofa"), `'hp'` (matches non-electronics), and `'apple'` (could match non-tech). There are NO exclude keywords to reject furniture items that slip through.
2. **Tendances lacks variety** -- Currently just takes the first 16 items from `accueilProducts` sequentially, which may all be from one or two categories. Needs round-robin mixing across categories (phones, cars, electronics, clothing, etc.).
3. **Last grid row duplicates existing categories** -- The padding logic fills empty slots by re-using `promoPreviews` (Phones, Electronics, Gaming, Vehicles), which are already displayed above. User wants NEW categories like music instruments, etc.

## Solution

### 1. Add exclude keywords to electronics filter
**File: `src/pages/shop/ShopHome.tsx`**

Add a `CATEGORY_EXCLUDE_KEYWORDS` map and update `isRelevantToCategory` to reject items matching exclude patterns. For `electronics`, exclude furniture terms like `sofa`, `couch`, `table`, `chair`, `bed`, `mattress`, `rug`, `curtain`, `furniture`, `garden`, `pillow`, `décor`.

Also remove overly broad include keywords from electronics: remove `'smart'`, `'hp'`, and `'apple'` (keep `'macbook'`, `'ipad'` which are specific enough).

```typescript
const CATEGORY_EXCLUDE_KEYWORDS: Record<string, string[]> = {
  electronics: ['sofa', 'couch', 'table', 'chair', 'bed', 'mattress', 'rug', 'curtain', 'furniture', 'garden', 'pillow', 'décor', 'decor', 'dress', 'shirt', 'pants', 'shoes', 'sneakers', 'toy', 'doll', 'lego'],
  gaming: ['charger', 'case', 'screen protector', 'sofa', 'chair', 'desk', 'table'],
  phones: ['case', 'screen protector', 'charger', 'sofa', 'furniture'],
};

function isRelevantToCategory(product: Product, categoryKey: string): boolean {
  if (categoryKey === 'all') return true;
  const keywords = CATEGORY_KEYWORDS[categoryKey];
  if (!keywords) return true;
  const titleLower = (product.title || '').toLowerCase();
  const matches = keywords.some(kw => titleLower.includes(kw));
  if (!matches) return false;
  // Check excludes
  const excludes = CATEGORY_EXCLUDE_KEYWORDS[categoryKey];
  if (excludes && excludes.some(ex => titleLower.includes(ex))) return false;
  return true;
}
```

### 2. Make Tendances feed use round-robin mixing
**File: `src/pages/shop/ShopHome.tsx`**

Replace the simple `accueilProducts.slice(0, 20)` with a round-robin builder that picks 2 items from each category section (phones, electronics, gaming, vehicles, clothing, home_garden, jewelry_watches, sporting_goods) to create a diverse 16-item feed. This ensures the trending grid shows luxury phones, cars, watches, fashion, etc.

```typescript
const trendingFeed = useMemo(() => {
  const categoryOrder = ['phones', 'vehicles', 'electronics', 'clothing', 'jewelry_watches', 'gaming', 'sporting_goods', 'home_garden'];
  const seen = new Set<string>();
  const result: Product[] = [];
  // Round-robin: pick 2 from each category
  for (const cat of categoryOrder) {
    const items = categorySections[cat] || [];
    let count = 0;
    for (const p of items) {
      if (count >= 2) break;
      if (!seen.has(p.id)) {
        result.push(p);
        seen.add(p.id);
        count++;
      }
    }
  }
  // If still under 16, fill from accueilProducts
  for (const p of accueilProducts) {
    if (result.length >= 16) break;
    if (!seen.has(p.id)) {
      result.push(p);
      seen.add(p.id);
    }
  }
  return result.slice(0, 16);
}, [categorySections, accueilProducts]);
```

### 3. Replace padding with NEW unique categories
**File: `src/pages/shop/ShopHome.tsx`**

Add new categories to `CATEGORY_TITLE_MAP` and `CATEGORY_KEYWORDS`:
- `music_instruments` -- Guitars, pianos, drums, DJ equipment
- `beauty_health` -- Perfume, skincare, makeup, grooming
- `collectibles` -- Coins, stamps, trading cards, vintage items

Extend `MORE_CATEGORIES` to include these new keys so the grid naturally has enough entries to fill rows of 4 (10 total = 2.5 rows, pad to 12 = 3 full rows). Replace the padding logic: instead of reusing `promoPreviews`, calculate how many slots remain and fill from a `PADDING_CATEGORIES` list that excludes already-shown categories.

```typescript
const CATEGORY_TITLE_MAP = {
  // ... existing 11 ...
  music_instruments: { fr: 'Instruments de Musique', en: 'Music Instruments' },
  beauty_health: { fr: 'Beauté & Santé', en: 'Beauty & Health' },
  collectibles: { fr: 'Collections', en: 'Collectibles' },
};

const CATEGORY_KEYWORDS = {
  // ... existing ...
  music_instruments: ['guitar', 'piano', 'keyboard', 'drum', 'violin', 'saxophone', 'trumpet', 'ukulele', 'microphone', 'amplifier', 'dj', 'mixer', 'synthesizer', 'bass guitar', 'flute', 'harmonica'],
  beauty_health: ['perfume', 'cologne', 'skincare', 'makeup', 'lipstick', 'foundation', 'serum', 'moisturizer', 'shampoo', 'hair', 'grooming', 'razor', 'fragrance', 'lotion', 'beauty'],
  collectibles: ['coin', 'stamp', 'trading card', 'pokemon', 'vintage', 'antique', 'collectible', 'memorabilia', 'comic', 'figurine', 'medal', 'rare'],
};
```

Remove the padding IIFE that reuses `promoPreviews` -- with 10 categories in MORE, the grid will fill more naturally. If still not a multiple of 4, pad from the new categories only (never from PROMO).

## Files to Modify
- **`src/pages/shop/ShopHome.tsx`** -- All 3 changes (exclude keywords, trending round-robin, new categories, padding fix)

