

# Audit & Harden: Web App Category Filters to Backend Recipe Mapping

## Current State (After Last Fix)

All 9 tab keys from `catalog-tabs` now correctly resolve to recipe keys:

```text
Tab Key (frontend sends)     -->  Recipe Key (DB _recipeKey)   Status
─────────────────────────────────────────────────────────────────────
electronics                  -->  electronics                  OK (identity)
vehicles                     -->  vehicles                     OK (identity)
home_garden                  -->  home_garden                  OK (identity)
clothing_shoes_accessories   -->  clothing                     OK (mapped)
toys                         -->  toys                         OK (identity)
sporting_goods               -->  sporting_goods               OK (identity)
jewelry_watches              -->  jewelry_watches              OK (identity)
refurbished                  -->  refurbished                  OK (identity)
parts_accessories            -->  parts_accessories            OK (identity)
```

The only mismatch was `clothing_shoes_accessories` which we fixed. Identity keys work because of the fallback: `TAB_TO_RECIPE[category] || category`.

## Problem: Fragile Hardcoded Map

The `TAB_TO_RECIPE` map in `catalog-home/index.ts` is hardcoded. If an admin:
- Renames a recipe key in the DB
- Adds a new category tab in `categoryMapper.ts`
- Changes a recipe key to not match the tab key

...the filter silently breaks and shows unrelated products (exactly the bug we just fixed).

## Fix: Auto-Derive Mapping + Add Missing Entries

### Change 1: Complete the TAB_TO_RECIPE with all aliases from categoryMapper

The `categoryMapper.ts` already defines `CATEGORY_ALIASES` (e.g., `clothing -> clothing_shoes_accessories`). But the `TAB_TO_RECIPE` in `catalog-home` does the **reverse** mapping (tab key -> recipe key). These should stay in sync.

Add all missing reverse aliases to `TAB_TO_RECIPE`:

```text
Current TAB_TO_RECIPE (11 entries):
  all, "", gaming, vehicles, home, fashion,
  clothing_shoes_accessories, toys, sporting_goods, watches, refurbished

Add these for completeness:
  electronics: "electronics"        (explicit identity - safety)
  home_garden: "home_garden"        (explicit identity - safety)
  jewelry_watches: "jewelry_watches" (explicit identity - safety)
  parts_accessories: "parts_accessories" (explicit identity)
  phones: "phones"                  (subcategory with its own recipe)
  business_industrial: "electronics" (no recipe exists, fallback)
```

### Change 2: Add a diagnostic log when a category has no matching recipe items

After the recipe filter runs, if zero items match, log a warning with the category and resolved recipe key. This makes future mismatches immediately visible in logs instead of silently showing wrong content.

### Change 3: Add fallback to `homepage` recipe when category filter returns zero items

Currently when a filter matches nothing, it falls through to the legacy 3-tier cache which may return stale/unrelated content. Instead, return the `homepage` mix with a header indicating the fallback, so the user sees curated content rather than random items.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/catalog-home/index.ts` | Expand TAB_TO_RECIPE with all explicit mappings; add zero-match diagnostic log; add homepage fallback |

## Technical Details

### Updated TAB_TO_RECIPE (complete map)

```typescript
const TAB_TO_RECIPE: Record<string, string> = {
  // Homepage
  all: "homepage",
  "": "homepage",
  // Exact recipe keys (explicit for safety)
  electronics: "electronics",
  vehicles: "vehicles",
  home_garden: "home_garden",
  toys: "toys",
  sporting_goods: "sporting_goods",
  jewelry_watches: "jewelry_watches",
  refurbished: "refurbished",
  parts_accessories: "parts_accessories",
  gaming: "gaming",
  phones: "phones",
  // Aliases (tab key differs from recipe key)
  clothing_shoes_accessories: "clothing",
  // Legacy aliases (old frontend keys)
  home: "home_garden",
  fashion: "clothing",
  watches: "jewelry_watches",
};
```

### Zero-Match Diagnostic

```typescript
if (allItems.length === 0) {
  console.warn(
    `[CATALOG_HOME] ZERO_MATCH category=${category} recipeKeyFilter=${recipeKeyFilter} ` +
    `totalRawItems=${rawItems.length} correlationId=${correlationId}`
  );
  // Fallback: serve homepage items instead of falling through to legacy cache
  const homepageItems = rawItems.filter(
    (item) => (item._recipeKey as string) === "homepage" || !item._recipeKey
  );
  if (homepageItems.length > 0) {
    // Use homepage items as fallback, with a header indicating fallback
    // ... (same pagination logic, add X-Category-Fallback: true header)
  }
}
```

This ensures:
1. Every possible category key the frontend can send is explicitly mapped
2. Mismatches are logged for fast debugging
3. Users never see completely unrelated content -- they get the curated homepage feed as a safe fallback

