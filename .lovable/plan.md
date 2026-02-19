

# Vertical Category Sections with Horizontal Scrolling Rows

## What Changes

Transform the homepage into an Amazon/eBay-style layout where each **category** (Accueil, Phones, Jeux Video, Electronique, Vehicules, etc.) gets its own **vertical section** with a **horizontally scrolling product row**. When you scroll down, you see one category after another, each labeled and each auto-scrolling its products sideways.

The category tabs at the top remain and act as **anchor links** -- tapping "Phones" scrolls you down to the Phones section.

## Layout

```text
+------------------------------------------+
| [Header + Search]                        |
| [Accueil] [Phones] [Electronique] [...]  |  <-- tabs (scroll to section)
+------------------------------------------+
| Delivery Banner                          |
+------------------------------------------+
| Accueil (mix of all)                     |
| [====> auto-scrolling products ====>]    |
+------------------------------------------+
| Telephones                               |
| [====> auto-scrolling products ====>]    |
+------------------------------------------+
| Jeux Video                               |
| [====> auto-scrolling products ====>]    |
+------------------------------------------+
| Electronique                             |
| [====> auto-scrolling products ====>]    |
+------------------------------------------+
| ... more categories ...                  |
+------------------------------------------+
```

## Technical Details

### 1. Fetch Products Per Category
Update `ShopHome.tsx` to fetch the home feed **once** (as today), but also fire parallel requests for each major category (phones, electronics, gaming, vehicles, etc.) to populate dedicated sections. Use `cachedCatalogFetch` with the `category` param for each.

### 2. Render Vertical Stack of Category Sections
Replace the current single-section rendering with a loop over categories. Each renders a `SectionBlock` (dark card with title + `HorizontalProductRow` inside). The first "Accueil" section shows the mixed/all products from the main feed.

### 3. Category Tabs Become Anchor Links
When a tab is tapped, instead of filtering products, smooth-scroll to the matching section using `element.scrollIntoView()`. Each section gets an `id` attribute matching its category key.

### 4. Keep SectionBlock + HorizontalProductRow As-Is
No changes needed to these components -- they already handle the dark card wrapper and auto-scrolling horizontal row perfectly.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/shop/ShopHome.tsx` | Fetch per-category data, render vertical stack of SectionBlocks, wire tab clicks to scroll-to-section |
| `src/components/shop/CategoryTabs.tsx` | Add optional `scrollToSection` mode that scrolls to an anchor instead of filtering |

