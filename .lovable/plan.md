

# Admin Portal Cleanup: Remove Noise and Unused Pages

## What Gets Removed

### 1. Search Relevancy page -- DELETE
- Route `/admin/search-relevancy`, lazy import, sidebar link, and `SearchRelevancy.tsx` file
- Not providing value; search tuning happens in code

### 2. Cars API page -- DELETE
- Route `/admin/cars-settings`, lazy import, sidebar link, and `CarsSettings.tsx` file
- Cars feature not needed

### 3. Catalog Builder page -- MERGE into Catalog Cache
- The Builder Sources table and Recent Runs table from `CatalogBuilder.tsx` will move into the Catalog Cache page as collapsible sections (below the existing Builder Controls)
- Delete `CatalogBuilder.tsx` and its route/sidebar entry
- This consolidates everything catalog-related into one page

## What Gets Fixed

### 4. Builder Controls: Add "desired items" input
- Add a simple number input field labeled "Items to fetch" directly in the Builder Controls card (next to "Run eBay Builder Now")
- This value gets passed to the builder run as `max_items_target`
- Default: 100

### 5. Thin Categories: Clean up the noisy display
- Remove the raw badge dump of 45+ category keys
- Replace with a clean summary: only show the 13 known named categories and their counts in a small table
- Filter out raw eBay numeric IDs (like `11450`, `6000`, `139971`) -- those are internal and meaningless to an admin
- If all named categories are above 2,000: show a green "All categories healthy" message instead

### 6. Home Curation stays (no change)
- The Home Recipes page controls what appears on homepage sections
- It remains in the sidebar under System as "Home Curation"

## Sidebar After Cleanup (System section)

```text
System
  Home Curation      (stays)
  Catalog Config     (stays)
  Catalog Cache      (stays -- now includes builder sources + runs)
  Auto-Learning      (stays)
  Health             (stays)
  Audit Log          (stays)
```

Removed from sidebar: Search Relevancy, Cars API, Catalog Builder (merged into Cache)

## Technical Details

### Files to delete
- `src/pages/admin/SearchRelevancy.tsx`
- `src/pages/admin/CarsSettings.tsx`
- `src/pages/admin/CatalogBuilder.tsx`

### Files to edit
- **`src/App.tsx`**: Remove 3 lazy imports (`SearchRelevancy`, `CarsSettings`, `CatalogBuilder`) and their routes
- **`src/components/layout/AdminLayout.tsx`**: Remove 3 sidebar entries (search-relevancy, cars-settings, catalog-builder)
- **`src/pages/admin/CatalogCache.tsx`**:
  - Add "Items to fetch" number input in `RunControls` component
  - Add collapsible "Builder Sources" section (moved from CatalogBuilder.tsx) with source table, add/toggle/reset functionality
  - Add collapsible "Recent Runs" section (moved from CatalogBuilder.tsx) with last 20 runs
  - Fix `SummaryCards` thin categories: filter to only named categories, hide numeric eBay IDs, show clean table instead of badge soup

