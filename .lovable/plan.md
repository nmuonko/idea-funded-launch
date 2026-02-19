

# Amazon-Style Sectioned Product Layout (Dark Theme)

## What Changes

Instead of dumping all products into one flat grid, each backend section will render as its own **dark card block** with:
- A **section title** (e.g. "Popular Electronics", "Trending Fashion") in bold white text
- A **2x2 grid on mobile / 4-column row on desktop** of product cards inside the card
- A dark card background (`bg-white/[0.04]` with `border-white/[0.08]`) -- subtle, not bright like Amazon's white cards
- Rounded corners and slight padding, stacked vertically

## Visual Reference

Like Amazon's homepage blocks (the image you shared), but adapted to your dark theme: dark card backgrounds, white text titles, same product cards you already have inside each block.

## Technical Details

### 1. New Component: `SectionBlock.tsx`
A reusable wrapper that takes a title and list of products, rendering them in a contained card:

```
+--------------------------------------+
| Section Title                        |
| +--------+ +--------+ +--------+    |
| | Prod 1 | | Prod 2 | | Prod 3 |   |
| +--------+ +--------+ +--------+    |
| +--------+ +--------+ +--------+    |
| | Prod 4 | | Prod 5 | | Prod 6 |   |
| +--------+ +--------+ +--------+    |
+--------------------------------------+
```

- Background: `bg-white/[0.04] border border-white/[0.08] rounded-2xl`
- Title: `text-lg font-semibold text-white` with left padding
- Inner grid: 2 cols mobile, 3 tablet, 4 desktop (fewer columns than current since they're inside a card)
- Each section shows up to 8 products (keeps the blocks digestible)

### 2. Update `ShopHome.tsx`
- Instead of flattening `data.sections[0].items`, store the full `sections` array in state
- Render each section as a `SectionBlock` stacked vertically with `space-y-4`
- Sections with `hideTitle: true` render without the title bar
- Keep the existing "Load More" and search CTA at the bottom

### 3. Keep Fallback
- If backend returns only 1 section (or no titles), fall back to the current flat grid layout so nothing breaks

## Files

| File | Change |
|------|--------|
| `src/components/shop/SectionBlock.tsx` | **New** -- section card wrapper |
| `src/pages/shop/ShopHome.tsx` | Store sections array, render SectionBlock per section |

No backend changes needed -- the sections data is already in the API response.
