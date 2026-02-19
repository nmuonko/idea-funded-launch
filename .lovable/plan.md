

# Amazon-Style Category Card Grid + Auto-Scroll Accueil

## What Changes

1. **Accueil section** keeps the current horizontal auto-scrolling row (unchanged)
2. **All other category sections** switch from horizontal scrolling rows to **Amazon-style card blocks** -- each category is a dark card containing a **2x2 grid of product images** with titles underneath, like in the Amazon screenshot
3. Category cards are arranged in a **responsive grid**: 1 column on mobile, 2 on tablet, 3-4 on desktop -- so multiple category blocks sit side by side

## Visual Layout

```text
+------------------------------------------+
| [Header + Search]                        |
| [Accueil] [Phones] [Electronique] [...]  |
+------------------------------------------+
| Delivery Banner                          |
+------------------------------------------+
| Accueil (auto-scrolling horizontal row)  |
| [====> products scroll ====>]            |
+------------------------------------------+
| +-- Telephones --+ +-- Electronique ---+ |
| | [img1] [img2]  | | [img1]   [img2]   | |
| | label   label  | | label    label    | |
| | [img3] [img4]  | | [img3]   [img4]   | |
| | label   label  | | label    label    | |
| | See more       | | See more          | |
| +----------------+ +-------------------+ |
| +-- Jeux Video --+ +-- Vehicules ------+ |
| | [img1] [img2]  | | [img1]   [img2]   | |
| | ...            | | ...               | |
| +----------------+ +-------------------+ |
+------------------------------------------+
```

## Technical Details

### 1. New Component: `CategoryCard.tsx`
A single Amazon-style category card block:
- Dark card background (`bg-white/[0.04] border border-white/[0.08] rounded-2xl`)
- Bold title at top
- 2x2 grid of products inside, each showing:
  - Square image (larger than current -- `aspect-square`, ~140-160px)
  - Short product title underneath (1 line, truncated)
  - No price/cart button in the grid view (clean, Amazon-style)
- "See more" link at bottom that scrolls to / navigates to the full category
- Shows exactly 4 products per card

### 2. Update `SectionBlock.tsx`
- Add a `mode` prop: `'scroll'` (horizontal auto-scroll, current behavior) or `'grid'` (Amazon card grid)
- Default to `'grid'` mode
- In `'grid'` mode, render the new `CategoryCard` layout instead of `HorizontalProductRow`

### 3. Update `ShopHome.tsx`
- Accueil section: pass `mode="scroll"` to keep auto-scrolling
- All category sections: render as a **responsive grid of `CategoryCard` components** instead of stacked `SectionBlock` rows
- Grid layout: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`

### 4. Product Image Sizing
- Inside category cards, images use `aspect-square` with `object-contain` on a light/neutral background (matching Amazon's white product image style)
- Images are larger than current compact cards -- roughly 140-160px squares
- Padding inside image container for clean product display

## Files

| File | Change |
|------|--------|
| `src/components/shop/CategoryCard.tsx` | **New** -- Amazon-style 2x2 product grid card |
| `src/components/shop/SectionBlock.tsx` | Add `mode` prop to toggle between scroll and grid |
| `src/pages/shop/ShopHome.tsx` | Accueil keeps scroll mode; categories render as grid of CategoryCards |

