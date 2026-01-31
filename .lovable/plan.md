

# Fix: Amazon Products Not Appearing in Search Results

## Problem Identified
Amazon products are not appearing in the frontend because:

1. **Database is empty of Amazon data** - The `catalog_items` table contains only 463 eBay items and zero Amazon/Rainforest items
2. **The catalog-refresh function was never executed** - No logs exist for this function
3. **No Amazon seeds exist** - The `admin-bootstrap-catalog` DEFAULT_SEEDS array only contains eBay seeds (all have `provider: "ebay"`)

Your admin settings are correct:
- `amazon_enabled: true`
- `catalog_provider_mode: mixed`
- `mixed_amazon_first_count: 60`
- `RAINFOREST_API_KEY` is configured

**But the system was designed to fetch Amazon data from the database (cached), not live API.** Since no Amazon data was ever seeded, searches return nothing from Amazon.

---

## Solution: Two-Part Fix

### Part 1: Add Amazon Seeds to Bootstrap (Permanent Fix)

Add Amazon/Rainforest seeds to the `DEFAULT_SEEDS` array in `admin-bootstrap-catalog/index.ts`:

```typescript
// ============ AMAZON SEEDS (via Rainforest API) ============
{ category: "electronics", provider: "rainforest", seed_key: "amazon_iphone", query: "iphone unlocked" },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_samsung", query: "samsung galaxy unlocked" },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_airpods", query: "airpods pro" },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_laptop", query: "laptop" },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_gaming", query: "gaming console" },
// ... more categories
```

### Part 2: Execute catalog-refresh to Populate Database (Immediate Fix)

Call the `catalog-refresh` edge function to fetch Amazon bestsellers from Rainforest API and insert them into `catalog_items`:

```bash
POST /catalog-refresh
Headers: x-cron-secret: <CRON_SECRET>
```

This will:
- Call Rainforest API for Amazon bestsellers (phones, tablets, computers, gaming, etc.)
- Insert products into `catalog_items` with `provider: "rainforest"`
- Make Amazon products immediately available in search

---

## Implementation Steps

### File Changes

**File: `supabase/functions/admin-bootstrap-catalog/index.ts`**

Add Amazon seeds at the end of the DEFAULT_SEEDS array (after the refurbished items):

```typescript
// ============ AMAZON/RAINFOREST SEEDS ============
// Phones
{ category: "electronics", provider: "rainforest", seed_key: "amazon_iphone_15", query: "iphone 15 unlocked", filters: { unifiedSubcategory: "phones" } },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_iphone_14", query: "iphone 14 unlocked", filters: { unifiedSubcategory: "phones" } },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_samsung_s24", query: "samsung galaxy s24", filters: { unifiedSubcategory: "phones" } },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_pixel", query: "google pixel unlocked", filters: { unifiedSubcategory: "phones" } },
// Gaming
{ category: "electronics", provider: "rainforest", seed_key: "amazon_ps5", query: "playstation 5 console", filters: { unifiedSubcategory: "gaming" } },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_xbox", query: "xbox series x", filters: { unifiedSubcategory: "gaming" } },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_nintendo", query: "nintendo switch", filters: { unifiedSubcategory: "gaming" } },
// Computers
{ category: "electronics", provider: "rainforest", seed_key: "amazon_macbook", query: "macbook pro", filters: { unifiedSubcategory: "computers" } },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_laptop", query: "laptop computer", filters: { unifiedSubcategory: "computers" } },
// Audio
{ category: "electronics", provider: "rainforest", seed_key: "amazon_airpods", query: "airpods pro", filters: { unifiedSubcategory: "audio" } },
{ category: "electronics", provider: "rainforest", seed_key: "amazon_headphones", query: "wireless headphones", filters: { unifiedSubcategory: "audio" } },
// Home
{ category: "home_garden", provider: "rainforest", seed_key: "amazon_vacuum", query: "robot vacuum" },
{ category: "home_garden", provider: "rainforest", seed_key: "amazon_airfryer", query: "air fryer" },
// Clothing
{ category: "clothing_shoes_accessories", provider: "rainforest", seed_key: "amazon_sneakers", query: "sneakers" },
{ category: "clothing_shoes_accessories", provider: "rainforest", seed_key: "amazon_running", query: "running shoes" },
```

### After Deployment

Trigger the catalog refresh manually to populate the database immediately:

```bash
POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/catalog-refresh
Headers:
  x-cron-secret: <your CRON_SECRET value>
```

---

## Technical Details

| Current State | After Fix |
|---------------|-----------|
| Amazon items in DB: 0 | Amazon items in DB: 100+ |
| Search shows: eBay only | Search shows: Amazon + eBay mixed |
| catalog-refresh runs: never | catalog-refresh: scheduled or manual |

### Why Amazon Uses DB-Only (Not Live API)

The Rainforest API costs ~$0.02 per request. To control costs:
- Amazon products are cached in `catalog_items` 
- The `catalog-refresh` function populates the cache periodically
- Live searches query the DB, not the API
- This is controlled by `liveEnabled: false` for Rainforest in provider policies

### Recommended: Schedule catalog-refresh

After the fix, set up a daily cron job to refresh Amazon data:
- This keeps Amazon products fresh
- Automatically populates new bestsellers
- Controlled by the existing budget settings

