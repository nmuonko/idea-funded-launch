

# Simplify the Auto-Learning Page

## Problem
The Auto-Learning admin page uses technical jargon (e.g., "catalog_seed_queries", "upserted into catalog_items", "eBay Seed Backfill", "RPC", "queue") and lacks visual progress indicators, making it hard to understand what's happening at a glance.

## Changes

### 1. Rewrite all labels and descriptions in plain English
- **Page title**: "Auto-Learning" -> "Smart Product Updates"
- **Subtitle**: "System learns from user searches and auto-caches popular queries" -> "Automatically finds and adds products based on what your customers search for"
- **eBay Seed Backfill section**: Rename to "Bulk Product Import" with description: "Import products for all your saved product categories from eBay. This runs in the background and may take a few minutes."
- Remove all code references like `catalog_seed_queries`, `catalog_items`
- "Run Promotion" -> "Find New Trends"
- "Queue & Catalog Status" -> "Import Progress"
- "Queued (eBay)" -> "Waiting to import"
- "Running" -> "Currently importing"
- "Active Items" -> "Products Available"
- "Inactive" -> "Hidden"
- "Provider Health" -> "Data Sources"
- "Searches (24h)" -> "Customer Searches Today"
- "Unique Queries" -> "Different Products Searched"
- "Live API Hits" -> "External Lookups"
- "Auto-Promoted" -> "Auto-Added"
- "Popular Searches (24h)" tab -> "Trending Searches"
- "Promotions" tab -> "Auto-Added Products"
- "Avg DB Results" -> "Saved Results"
- "Avg Live Results" -> "Found Online"
- "Seeded" -> "Added"
- "Needs caching" -> "Needs products"
- Table column "Query" -> "What customers searched"

### 2. Add progress bars to the category table
- Add a progress bar (using the existing `Progress` component) next to each category showing how full it is relative to the largest category
- Color-code: green for categories with 2000+ items, yellow for 500-1999, red for under 500

### 3. Add a progress bar for the backfill process
- When backfill is running, show an animated progress bar
- Show "Waiting to import: X" and "Currently importing: X" with visual bars instead of just numbers

### 4. Simplify the backfill result display
- "Enqueued" -> "Queued"
- "Processed" -> "Checked"
- "Upserted" -> "Products Added"
- "Errors" -> "Failed"

## Technical Details

**Files to modify:**
- `src/pages/admin/AutoLearning.tsx` -- All UI text changes, add Progress component import, add progress bars to category table and backfill status section

**No backend changes needed** -- this is purely a UI/UX improvement.
