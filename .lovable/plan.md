

# Ensure Full Images for All eBay and Amazon Items Across All Categories

## Current State Analysis

After investigation, I found the following:

**eBay (Working Well)**
- 181 items in media cache with average 6.59 images per item
- 403 of 427 catalog_items have multiple images
- The recent fixes for ID normalization and service role bypass are working

**Amazon/Rainforest (Needs Work)**
- Only 6 items in media cache, ALL with just 1 image
- No items in `catalog_items` with `provider = 'rainforest'` or `provider = 'amazon'`
- Amazon items aren't being properly cached after search/category browsing
- The `rainforestAdapter.ts` enhancements (image extraction) are in place but items aren't being upserted to DB

## Root Cause

The issue is that Amazon/Rainforest items returned from DB searches aren't being properly:
1. **Stored in catalog_items** - Search and category endpoints fetch from DB but don't upsert new Amazon results with full image data
2. **Enriched via media cache** - The `enrichItemsWithMediaCounts` function works, but it needs items in the DB first

## Technical Solution

### Step 1: Update `catalog-search` to Upsert Amazon Items

When Amazon items are fetched from the database, we need to ensure they have the `images` array populated. Additionally, when fetching via Rainforest API for product details, we should backfill the `catalog_items` table.

**File: `supabase/functions/catalog-search/index.ts`**

Add an upsert step after fetching Amazon items from DB to ensure any cached items are properly stored with their images array. Also add logic to trigger media cache enrichment for Amazon items that have low image counts.

### Step 2: Update `catalog-category` Similarly

Same changes for the category browsing endpoint to ensure Amazon items get their full image data cached.

**File: `supabase/functions/catalog-category/index.ts`**

### Step 3: Enhance Media Cache for Amazon Items

Update the `enrichItemsWithMediaCounts` function to be more aggressive about fetching fresh data for Amazon items, since they currently have poor cache coverage.

**File: `supabase/functions/_shared/mediaCache.ts`**

Add special handling for Amazon items with `image_count <= 1` to force a fresh fetch from `catalog-product`.

### Step 4: Ensure Rainforest Adapter Caches to catalog_items

When `catalog-product` fetches a product detail from Rainforest API, ensure it properly caches the full image gallery to `catalog_items.images`.

**File: `supabase/functions/catalog-product/index.ts`**

This is already partially implemented but needs verification that the `images` column is being populated correctly.

### Step 5: Clear Stale Cache and Force Re-enrichment

Run SQL to identify and clear poorly-cached entries:

```sql
-- Clear Amazon media cache entries with only 1 image (force re-fetch)
DELETE FROM catalog_item_media 
WHERE provider = 'amazon' 
  AND image_count <= 1;

-- Clear stale catalog_items Amazon entries with only 1 image
DELETE FROM catalog_items 
WHERE provider IN ('rainforest', 'amazon')
  AND jsonb_array_length(COALESCE(images, '[]'::jsonb)) <= 1;
```

### Step 6: Add Amazon-Specific Debug Logging

Add detailed logging to track Amazon image extraction throughout the pipeline.

## Files to Modify

1. **`supabase/functions/catalog-search/index.ts`**
   - Add force-refresh logic for Amazon items with low image counts
   - Ensure media enrichment runs for all providers

2. **`supabase/functions/catalog-category/index.ts`**
   - Same as above for category browsing

3. **`supabase/functions/_shared/mediaCache.ts`**
   - Add special handling to force re-fetch for Amazon items with image_count <= 1

4. **`supabase/functions/catalog-product/index.ts`**
   - Verify and fix the upsert to `catalog_items.images` for Rainforest products

5. **Database cleanup** - Clear stale entries

## Expected Outcome

After these changes:
- All eBay items across all categories will show full galleries (already working, just needs cache cleanup)
- All Amazon items will fetch and display full image galleries (5-15 images typical)
- The media cache will properly store all image URLs for both providers
- Product detail pages will show complete photo galleries
- List views will show accurate `imageCount` badges

## Technical Details

### How Image Flow Works

```text
List View (Home/Search/Category)
         │
         ▼
┌─────────────────────────────────────┐
│  1. Fetch items from DB or live API │
│  2. Each item has imageCount field  │
│  3. enrichItemsWithMediaCounts()    │
│     - Check catalog_item_media      │
│     - If missing, call catalog-product
│     - Cache full gallery            │
└─────────────────────────────────────┘
         │
         ▼
Product Detail View
         │
         ▼
┌─────────────────────────────────────┐
│  catalog-product endpoint           │
│  1. DB-first check catalog_items    │
│  2. If found, return item.imageUrls │
│  3. If not, fetch live from provider│
│     - eBay: getEbayItem (full)      │
│     - Amazon: fetchProductDetails   │
│  4. Cache to catalog_items          │
│  5. Return full imageUrls array     │
└─────────────────────────────────────┘
```

### Key Changes Summary

1. **mediaCache.ts**: Force re-fetch for Amazon items with `image_count <= 1`
2. **catalog-search/category**: Ensure media enrichment is always triggered
3. **catalog-product**: Verify full `images` array is cached for all providers
4. **Database**: Clear poorly-cached entries to force fresh data

