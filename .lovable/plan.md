

# Catalog Cache Page Redesign: Clear, Usable, and Informative

## Problems You Identified

1. **Thin Categories list at the top is confusing and useless** -- it's just a wall of category names with numbers, no context on what to do about it
2. **Builder Sources vs Builder Controls is unclear** -- two separate sections with no obvious relationship
3. **"Items to fetch" only next to eBay** -- can't set different quantities per provider or per category
4. **No way to say "fetch 10k phones"** -- the builder has no category + quantity targeting
5. **No total item count visible** -- pagination just says "Showing 50 items" with no total
6. **Recent Runs shows nothing** -- empty and unhelpful
7. **Running a builder gives a tiny toast** -- no visible progress, no success banner, no count update

## Redesigned Page Layout (Top to Bottom)

```text
+-----------------------------------------------------------+
| Catalog Cache                                              |
| Browse and manage cached catalog items                     |
+-----------------------------------------------------------+
| [Total: 25,431] [Active: 23,100] [Inactive: 2,331]       |
| [Added 24h: 142] [Stale Price: 89] [Dead: 12]            |
+-----------------------------------------------------------+
| FETCH PRODUCTS (replaces Builder Controls)                 |
| ┌─────────────────────────────────────────────────────┐   |
| │ Category: [All / phones / electronics / ...]         │   |
| │ Provider: [eBay / Amazon]                            │   |
| │ Quantity: [___100___]                                │   |
| │                                                      │   |
| │ [>>> Start Fetching]                                 │   |
| │                                                      │   |
| │ ┌─ PROGRESS (visible when running) ───────────────┐ │   |
| │ │ Fetching phones from eBay...                     │ │   |
| │ │ [=========>          ] 47 / 100 items            │ │   |
| │ │ New unique: 32 | Duplicates: 15                  │ │   |
| │ └─────────────────────────────────────────────────┘ │   |
| │                                                      │   |
| │ Provider Health: eBay [Healthy] Amazon [Healthy]     │   |
| └─────────────────────────────────────────────────────┘   |
+-----------------------------------------------------------+
| [Automate Window Run] button (opens campaign dialog)       |
+-----------------------------------------------------------+
| > Search Insights (collapsible, stays as-is)               |
+-----------------------------------------------------------+
| CACHED PRODUCTS                                            |
| [Filters: Category | Provider | Status | Sort | Search]    |
| ┌──────────────────────────────────────────────────────┐  |
| │ Product table with images...                          │  |
| ├──────────────────────────────────────────────────────┤  |
| │ Showing 50 of ~25,431 items  |  Page 1  [< Prev][Next >]│
| └──────────────────────────────────────────────────────┘  |
+-----------------------------------------------------------+
| > Recent Fetch History (collapsible, replaces Recent Runs) |
| > Builder Sources (collapsible, for advanced users)        |
+-----------------------------------------------------------+
```

## What Changes

### 1. Remove Thin Categories section entirely
- The summary cards already show a "Thin (<2k)" count
- The table of categories with counts adds no actionable value -- admins can't do anything with it from here
- If a category is thin, the fix is to run the builder for that category, which the new "Fetch Products" section handles

### 2. Merge "Builder Controls" into a clear "Fetch Products" card
- **Category dropdown**: pick a specific category (e.g., "phones") or "All"
- **Provider dropdown**: eBay or Amazon
- **Quantity input**: how many items to fetch (default 100, range 10-10000)
- One clear button: "Start Fetching"
- This answers "how do I fetch 10k phones?" -- select phones, set 10000, click start

### 3. Add live progress panel (replaces tiny toast)
- When a fetch is running, show a visible progress card:
  - What's being fetched ("Fetching phones from eBay...")
  - Progress bar with count ("47 / 100 items")
  - New unique vs duplicates
- Poll builder-status every 5 seconds while active
- On completion: show a green success banner with final counts
- Auto-refresh the summary cards so total count updates

### 4. Show total count in the items table footer
- Change "Showing 50 items" to "Showing 50 of ~25,431 items"
- The total comes from the summary cards data (already fetched, no extra query)
- Show page number: "Page 1", "Page 2", etc.

### 5. Move "Automate Window Run" to a separate subtle button
- Keep the campaign dialog but make it a secondary action below Fetch Products
- It's for automated multi-day runs, not the primary action

### 6. Move Builder Sources and Recent Runs to bottom
- They're advanced/diagnostic -- keep them collapsible at the bottom
- Rename "Recent Runs" to "Recent Fetch History" for clarity

## Technical Details

### Files to edit

**`src/pages/admin/CatalogCache.tsx`**:
- Delete the Thin Categories table from `SummaryCards` (keep the summary card count badge only)
- Redesign `RunControls` into a `FetchProducts` component with category, provider, quantity fields
- Add polling-based progress display that shows a progress bar, item counts, and completion state
- Pass `category_key` and `max_items_target` to the `run-builder` action
- Update `ItemsTable` footer to show total from summary data and page number
- Reorder sections: Summary -> FetchProducts -> SearchInsights -> ItemsTable -> RecentRuns -> BuilderSources

**`supabase/functions/admin-catalog-items/index.ts`**:
- Update `run-builder` action to accept and forward `category_key` and `max_items_target` to the worker
- Update `handleBuilderStatus` to return active run progress (items fetched so far, target, provider, category)

