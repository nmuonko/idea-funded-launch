
# Integrate Amazon Autos for Vehicle Searches

## Discovery

You're right! Amazon does sell actual vehicles through **Amazon Autos** (https://www.amazon.com/Amazon-Autos/b?node=10677469011). This is a dedicated storefront where users can buy or lease new and used vehicles from local dealerships.

The current system skips Amazon entirely for vehicle searches because the general Amazon catalog only has parts and accessories. However, the Rainforest API **does support** category-specific searches via a `category_id` parameter, which means we can target the Amazon Autos category specifically.

### Amazon Autos Category IDs
| Category | Node ID |
|----------|---------|
| Amazon Autos (Primary) | `10677469011` |
| Vehicles (General) | `202278846011` |

---

## Solution Overview

Instead of skipping Amazon for vehicle searches, we'll **include Amazon but restrict it to the Amazon Autos category**. This way, vehicle searches will return:
1. **eBay Motors** listings (Cars & Trucks category 6001)
2. **Amazon Autos** listings (Node ID 10677469011)

Both sources will provide actual vehicle listings, not parts or accessories.

---

## Technical Implementation

### 1. Update Rainforest Adapter to Support Category ID

**File:** `supabase/functions/_shared/rainforestAdapter.ts`

Modify the `search()` method to accept an optional `categoryId` parameter:

```typescript
// Update SearchFilters interface or add to params
interface RainforestSearchParams {
  // ... existing params
  category_id?: string;  // Already defined at line 32
}

// In the search method, add category_id to params when provided
const params: RainforestSearchParams = {
  api_key: apiKey,
  type: "search",
  amazon_domain: amazonDomain,
  search_term: query,
  page,
  sort_by: "featured",
  category_id: filters?.amazonCategoryId,  // NEW: pass Amazon Autos category
};
```

### 2. Update SearchFilters Interface

**File:** `supabase/functions/_shared/catalogProviders.ts`

Add `amazonCategoryId` to the `SearchFilters` interface:

```typescript
export interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  brand?: string;
  inStockOnly?: boolean;
  amazonCategoryId?: string;  // NEW: For Amazon Autos integration
}
```

### 3. Update Catalog Search to Include Amazon Autos

**File:** `supabase/functions/catalog-search/index.ts`

Instead of skipping Amazon for vehicle searches, pass the Amazon Autos category ID:

```typescript
// Define Amazon Autos category constant
const AMAZON_AUTOS_CATEGORY_ID = "10677469011";

// In the vehicle search logic (around line 483):
// REMOVE: const skipAmazonForVehicles = isVehicle;
// REPLACE with:
const amazonVehicleFilter = isVehicle 
  ? { ...catalogFilters, amazonCategoryId: AMAZON_AUTOS_CATEGORY_ID } 
  : catalogFilters;

// Use amazonVehicleFilter when calling Rainforest for vehicle searches
// This ensures Amazon returns actual vehicles from Amazon Autos, not parts
```

### 4. Logging Updates

Add logging to track Amazon Autos usage:

```typescript
if (isVehicle) {
  console.log(`[SEARCH] requestId=${requestId} Vehicle query detected: "${qNorm}" - using eBay Motors + Amazon Autos (category=${AMAZON_AUTOS_CATEGORY_ID})`);
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/catalogProviders.ts` | Add `amazonCategoryId` to `SearchFilters` |
| `supabase/functions/_shared/rainforestAdapter.ts` | Pass `category_id` param when provided in filters |
| `supabase/functions/catalog-search/index.ts` | Remove Amazon skip, use Amazon Autos category for vehicles |

---

## Expected Results After Implementation

| Search Query | Before | After |
|--------------|--------|-------|
| "toyota rav4" | Only eBay results | eBay Motors + Amazon Autos |
| "tesla model 3" | Only eBay results | eBay Motors + Amazon Autos |
| "GM Yukon" | Only eBay results | eBay Motors + Amazon Autos |
| "iphone 15" | Amazon + eBay (normal) | Amazon + eBay (unchanged) |

---

## Benefits

1. **More inventory**: Users see vehicles from both Amazon Autos and eBay Motors
2. **Faster results**: Amazon Autos may return faster than eBay in some cases
3. **Better prices**: Competition between sources benefits users
4. **No parts pollution**: Amazon Autos category only contains actual vehicles, not accessories
