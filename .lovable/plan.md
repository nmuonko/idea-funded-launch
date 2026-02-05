
# Fix: Homepage Sections Showing Irrelevant Items

## Problem Summary

The homepage category sections display irrelevant items:
- **Phones** shows very old phone models
- **Video Games** shows unrelated items like screwdrivers
- **Computers**, **Vehicles**, **Fashion** also show mixed/irrelevant results

## Root Cause Analysis

The `catalog-home` and `catalog-home-v2` edge functions search eBay using **keyword-only queries without category filtering**. This causes eBay to return any item matching any word in the query:

```
Current: q="ps5 xbox nintendo switch console"
Problem: "switch" matches network switches, light switches, screwdrivers labeled as "switch repair tools"
```

The only category that uses a filter is **Vehicles** (`category_ids=6000`). All other sections perform unfiltered broad searches.

---

## Solution Overview

Add eBay category IDs to each section to restrict search results to the correct product type:

| Section | Seed Query | eBay Category ID | Category Name |
|---------|------------|------------------|---------------|
| phones | iphone samsung smartphone unlocked | `9355` | Cell Phones & Smartphones |
| video_games | ps5 xbox nintendo switch console | `1249` | Video Games & Consoles |
| computers | laptop macbook dell hp notebook | `58058` | Computers/Tablets & Networking |
| vehicles | toyota honda rav4 camry car | `6000` | Motors (already implemented) |
| fashion | shoes sneakers nike adidas clothing | `63889` | Shoes |

---

## Technical Changes

### 1. Database Schema Update

Add `ebay_category_id` column to `catalog_sections` table:

```sql
ALTER TABLE catalog_sections 
ADD COLUMN ebay_category_id TEXT DEFAULT NULL;

UPDATE catalog_sections SET ebay_category_id = '9355' WHERE key = 'phones';
UPDATE catalog_sections SET ebay_category_id = '1249' WHERE key = 'video_games';
UPDATE catalog_sections SET ebay_category_id = '58058' WHERE key = 'computers';
UPDATE catalog_sections SET ebay_category_id = '6000' WHERE key = 'vehicles';
UPDATE catalog_sections SET ebay_category_id = '63889' WHERE key = 'fashion';
```

### 2. Update FALLBACK_SECTIONS in Both Edge Functions

**Files:** `supabase/functions/catalog-home/index.ts` and `supabase/functions/catalog-home-v2/index.ts`

Update the hardcoded fallback sections to include `ebay_category_id`:

```typescript
const FALLBACK_SECTIONS = [
  { key: "phones", title_fr: "Téléphones", title_en: "Phones", 
    seed_query: "iphone samsung smartphone unlocked", mode: "general", ebay_category_id: "9355" },
  { key: "video_games", title_fr: "Jeux Vidéo", title_en: "Video Games", 
    seed_query: "ps5 xbox nintendo switch console", mode: "general", ebay_category_id: "1249" },
  { key: "computers", title_fr: "Ordinateurs", title_en: "Computers", 
    seed_query: "laptop macbook dell hp notebook", mode: "general", ebay_category_id: "58058" },
  { key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", 
    seed_query: "toyota honda rav4 camry car", mode: "vehicle", ebay_category_id: "6000" },
  { key: "fashion", title_fr: "Vêtements et Mode", title_en: "Fashion", 
    seed_query: "shoes sneakers nike adidas clothing", mode: "general", ebay_category_id: "63889" },
];
```

### 3. Update SectionConfig Interface

Add `ebay_category_id` to the TypeScript interface:

```typescript
interface SectionConfig {
  key: string;
  title_fr: string;
  title_en: string;
  seed_query: string;
  mode: string;
  ebay_category_id?: string;  // NEW
}
```

### 4. Update fetchSectionItems Function

Modify the search URL construction to include `category_ids` for ALL sections (not just vehicles):

```typescript
// In fetchSectionItems function
const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
searchUrl.searchParams.set("q", seed_query);
searchUrl.searchParams.set("limit", String(limit));

// Apply category filter for ALL sections that have one
if (sectionConfig.ebay_category_id) {
  searchUrl.searchParams.set("category_ids", sectionConfig.ebay_category_id);
}
```

### 5. Update Database Query to Fetch ebay_category_id

In `loadSectionsFromDb()`, update the SELECT to include the new column:

```typescript
const response = await fetch(
  `${supabaseUrl}/rest/v1/catalog_sections?is_active=eq.true&order=sort_order.asc&select=key,title_fr,title_en,seed_query,mode,ebay_category_id`,
  // ...
);
```

### 6. Bump Cache Version

Increment the frontend cache version to force fresh data:

```typescript
// src/lib/catalogCache.ts
const CACHE_PREFIX = 'afrishop_cache:v4:';
```

---

## Files to Modify

1. **Database Migration** - Add `ebay_category_id` column and populate values
2. **`supabase/functions/catalog-home/index.ts`** - Update interface, fallbacks, fetch logic, and DB query
3. **`supabase/functions/catalog-home-v2/index.ts`** - Same updates
4. **`src/lib/catalogCache.ts`** - Bump cache version to v4

---

## Expected Results

After implementation:
- **Phones** shows only smartphones (iPhones, Samsung Galaxy, etc.)
- **Video Games** shows only gaming consoles and games (PS5, Xbox, Nintendo)
- **Computers** shows only laptops and computers (MacBooks, Dell, HP)
- **Vehicles** continues to show cars (already working)
- **Fashion** shows shoes and clothing items

Each section will be constrained to its proper eBay category, eliminating irrelevant items like screwdrivers appearing in Video Games.
