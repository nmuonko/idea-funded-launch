

# Fix Homepage Category Relevance, No Empty Slots, Luxury Mix, and Tendances Variety

## Problems Found

From the screenshot and code analysis:

1. **Tendances** shows yoga mats, sofas, and non-diverse items instead of a luxury variety mix
2. **Jeux Video** shows "USB-C Car Charger for ASUS ROG Ally", "S Racer Gaming Chair", "Replacement Internal Cooling Fan" -- accessories, not actual games/consoles
3. **Telephones** shows "SP CONNECT Phone Case" -- a case, not a phone
4. **Vehicles** shows GPS/stereo accessories alongside actual cars
5. **globalDedup** is a `useMemo(() => new Set(), [deps])` that gets mutated during render -- fragile React anti-pattern that can cause inconsistent dedup
6. Some category grids show fewer than 4 items with empty space

## Root Causes

- **Keywords too broad**: `gaming` matches "gaming chair", `keyboard` in electronics matches instrument keyboards, `game` matches anything
- **Exclude lists incomplete**: phones don't exclude "case", "protector", "cable"; gaming doesn't exclude "charger", "fan", "cooling", "chair"; vehicles don't exclude "gps", "stereo", "carplay"
- **globalDedup mutated during render**: a Set created in useMemo gets `.add()` calls during the same render cycle across multiple useMemo hooks -- works by accident but is fragile
- **pageSize: 30** for category fetches may not yield 4 relevant items after filtering

## Changes (all in `src/pages/shop/ShopHome.tsx`)

### 1. Tighten CATEGORY_KEYWORDS

Remove overly broad terms:
- **electronics**: remove `keyboard` (conflicts with music), keep `mechanical keyboard`
- **gaming**: remove bare `game`, `gamer`; keep specific console/brand terms; add `video game`
- **phones**: remove generic `phone` (matches "phone case"); keep `smartphone`, brand names, `iphone`, `galaxy`
- **vehicles**: keep car brands but remove `gps`, `dash` (those are accessories)

### 2. Expand CATEGORY_EXCLUDE_KEYWORDS significantly

- **phones**: add `case`, `protector`, `screen protector`, `cable`, `charger`, `mount`, `holder`, `stand`, `tempered glass`, `cover`, `wallet`, `strap`, `armband`
- **gaming**: add `charger`, `cable`, `fan`, `cooling`, `chair`, `desk`, `case`, `skin`, `decal`, `stand`, `mount`, `replacement`
- **electronics**: add `yoga`, `exercise`, `workout`, `sport`, `clothing`, `fashion`
- **vehicles**: add `phone`, `charger`, `cable`, `stereo`, `gps`, `carplay`, `android auto`, `dash cam` (keep only real vehicles)
- All categories: ensure cross-contamination exclusions are comprehensive

### 3. Fix globalDedup pattern

Replace the fragile mutated-Set-in-useMemo pattern with a single `useMemo` that computes ALL sections at once (trending, promo, more, extra) in one pass. This ensures deterministic dedup order and no React anti-pattern.

```text
const allSections = useMemo(() => {
  const dedup = new Set<string>();
  // 1. Build trendingFeed (16 items, round-robin, luxury bias)
  // 2. Build promoPreviews (top 4 cats, 4 items each)
  // 3. Build bottomGridPreviews (remaining cats + extras, 4 items each)
  return { trendingFeed, promoPreviews, bottomGridPreviews };
}, [categorySections, accueilProducts]);
```

### 4. Increase category fetch pageSize from 30 to 60

This gives more candidates to filter, reducing the chance of ending up with fewer than 4 relevant items per category.

### 5. Trending feed composition (luxury-biased round-robin)

Keep the existing round-robin logic but inside the unified `useMemo`. Pick 2 items per category from: phones, vehicles, electronics, clothing, jewelry_watches, gaming, sporting_goods, home_garden. Prioritize items with luxury keywords and higher prices. Fill remaining slots from accueilProducts.

### 6. No UI changes needed for empty slots

The `CategoryCard` already renders only available items (`items.slice(0, 4)`) and returns `null` if empty. The fix is to ensure the data layer provides enough relevant items (via larger fetch + better filtering).

## Files to Modify

- **`src/pages/shop/ShopHome.tsx`** -- All changes: tighten keywords, expand excludes, fix dedup pattern, increase pageSize, unify section building logic

## What Will NOT Change

- `CategoryCard.tsx` -- already correct (no placeholders)
- `SectionBlock.tsx` -- already correct (16 items for static-grid)
- Backend edge functions -- the filtering is applied client-side after fetch, which is the right approach given the data comes from multiple providers
- "Voir plus" routing -- already works via `/category/{categoryKey}`

