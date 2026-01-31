
# Backend Sort/Filter Enhancement Plan

## Problem Summary

The backend API **parses** sort and filter parameters but **does not use them**:
- `catalog-category` and `catalog-search` accept `sort` and `filters` URL params but ignore them
- Provider adapters (eBay, Rainforest) have hardcoded sort orders
- No admin endpoints support sort/filter parameters

---

## Implementation Overview

This plan adds full sort/filter support to catalog and admin endpoints.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        SORT/FILTER FLOW                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Mobile/Web App                                                          │
│       │                                                                  │
│       ▼                                                                  │
│  ?sort=price_asc&filters={"brand":["apple"],"minPrice":100}             │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  catalog-category / catalog-search                               │    │
│  │  ┌─────────────────────┐  ┌─────────────────────┐               │    │
│  │  │ Parse sort param    │  │ Parse filters JSON  │               │    │
│  │  │ ┌─────────────────┐ │  │ ┌─────────────────┐ │               │    │
│  │  │ │ relevance       │ │  │ │ brand           │ │               │    │
│  │  │ │ price_asc       │ │  │ │ minPrice        │ │               │    │
│  │  │ │ price_desc      │ │  │ │ maxPrice        │ │               │    │
│  │  │ │ newest          │ │  │ │ condition       │ │               │    │
│  │  │ │ rating          │ │  │ │ rating          │ │               │    │
│  │  │ └─────────────────┘ │  │ └─────────────────┘ │               │    │
│  │  └─────────────────────┘  └─────────────────────┘               │    │
│  │              │                       │                           │    │
│  │              ▼                       ▼                           │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │ Pass to Provider Adapters                                │    │    │
│  │  │ ┌─────────────────┐  ┌─────────────────────────────┐    │    │    │
│  │  │ │ eBay Browse API │  │ Rainforest (Amazon) API     │    │    │    │
│  │  │ │ sort=price      │  │ sort_by=price_low_to_high   │    │    │    │
│  │  │ │ filter=price:[] │  │ filters via search_term     │    │    │    │
│  │  │ └─────────────────┘  └─────────────────────────────┘    │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                  │
│       ▼                                                                  │
│  Merged & filtered results returned                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Catalog Sort Support

### 1.1 Define Standard Sort Options

Create a new shared module for sort/filter normalization:

| Sort Key | Display Label | eBay API Value | Rainforest Value |
|----------|---------------|----------------|------------------|
| `relevance` | Best Match | (default) | `featured` |
| `price_asc` | Price: Low to High | `price` | `price_low_to_high` |
| `price_desc` | Price: High to Low | `-price` | `price_high_to_low` |
| `newest` | Newly Listed | `newlyListed` | `most_recent` |
| `rating` | Top Rated | (post-filter) | `average_review` |

### 1.2 Update eBay Adapter

Modify `ebayBrowseSearch.ts` to accept and apply sort:

```typescript
// Add to EbaySearchParams
export interface EbaySearchParams {
  // ... existing
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest';
}

// Map to eBay API sort values
const EBAY_SORT_MAP: Record<string, string> = {
  'price_asc': 'price',
  'price_desc': '-price',
  'newest': 'newlyListed',
  // 'relevance' = no sort param (default)
};
```

### 1.3 Update Rainforest Adapter

Modify `rainforestAdapter.ts` to use dynamic sort:

```typescript
const RAINFOREST_SORT_MAP: Record<string, string> = {
  'relevance': 'featured',
  'price_asc': 'price_low_to_high',
  'price_desc': 'price_high_to_low',
  'newest': 'most_recent',
  'rating': 'average_review',
};
```

### 1.4 Update catalog-category

Wire the `sort` param through to provider calls:

```typescript
// Line ~304: Already parsing sort
const sort = url.searchParams.get("sort") || "relevance";

// NEW: Pass to eBay search
const searchResult = await searchEbayWithFallback(
  supabase,
  {
    // ... existing params
    sort: sort as EbaySortOption,
  },
  fallbackQueries,
  requestId
);

// NEW: Apply sort to DB query for Amazon cached items
if (sort === 'price_asc') {
  query = query.order("price_usd", { ascending: true, nullsFirst: false });
} else if (sort === 'price_desc') {
  query = query.order("price_usd", { ascending: false, nullsFirst: false });
} else {
  query = query.order("rating", { ascending: false, nullsFirst: false });
}
```

---

## Phase 2: Catalog Filter Support

### 2.1 Parse Filters Parameter

Both endpoints already accept `filters` as a JSON-encoded query param:

```
?filters={"brand":["apple","samsung"],"minPrice":100,"maxPrice":1000,"condition":"new"}
```

### 2.2 Apply Filters to eBay API

eBay Browse API supports filters in the `filter` param:

```typescript
// Add filter building in ebayBrowseSearch.ts
function buildFiltersForEbay(filters: AppliedFilters): string[] {
  const parts: string[] = [];
  
  // Price range
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const min = filters.minPrice || 0;
    const max = filters.maxPrice || '';
    parts.push(`price:[${min}..${max}],priceCurrency:USD`);
  }
  
  // Condition
  if (filters.condition) {
    const conditionMap: Record<string, string> = {
      'new': 'NEW',
      'used': 'USED',
      'refurbished': 'MANUFACTURER_REFURBISHED',
    };
    parts.push(`conditions:{${conditionMap[filters.condition as string]}}`);
  }
  
  return parts;
}
```

### 2.3 Apply Filters to DB Queries (Amazon cached)

For DB-cached Amazon items, apply filters in the Supabase query:

```typescript
// In catalog-category
if (filters?.minPrice) {
  query = query.gte('price_usd', filters.minPrice);
}
if (filters?.maxPrice) {
  query = query.lte('price_usd', filters.maxPrice);
}
if (filters?.brand && Array.isArray(filters.brand)) {
  // Use ilike for brand matching
  const brandFilters = filters.brand.map(b => `brand.ilike.%${b}%`);
  query = query.or(brandFilters.join(','));
}
```

### 2.4 Return Applied Filters in Response

Already supported in the response type:

```typescript
interface SearchResponse {
  // ... existing
  appliedFilters?: Record<string, unknown>;
}
```

---

## Phase 3: Admin Endpoints Sort/Filter

### 3.1 Enhance admin-get-carts

Add query params for admin cart management:

```typescript
// Parse params
const sortBy = url.searchParams.get("sortBy") || "updated_at";
const sortOrder = url.searchParams.get("sortOrder") || "desc";
const status = url.searchParams.get("status"); // DRAFT, PENDING_PAYMENT, or null for all
const minTotal = url.searchParams.get("minTotal");
const userName = url.searchParams.get("userName");

// Apply to query
let query = supabase
  .from('orders')
  .select(`...`)
  .in('status', statusList);

if (minTotal) {
  query = query.gte('total_usd', parseFloat(minTotal));
}

query = query.order(sortBy, { ascending: sortOrder === 'asc' });
```

### 3.2 Add Sorting Headers to Admin UI

Update `ActiveCartsContent.tsx` to allow column sorting:

```typescript
const [sortField, setSortField] = useState<'updated_at' | 'total_usd' | 'item_count'>('updated_at');
const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

// Pass to API call
const { data } = await supabase.functions.invoke('admin-get-carts', {
  body: { sortBy: sortField, sortOrder }
});
```

---

## Phase 4: Response Consistency

### 4.1 Standard Sort Info in Response

All endpoints should return applied sort in the response:

```typescript
{
  "status": "success",
  "items": [...],
  "sort": {
    "field": "price_asc",
    "applied": true
  },
  "appliedFilters": {
    "minPrice": 100,
    "brand": ["apple"]
  }
}
```

---

## Files to Create/Modify

### New Files
1. `supabase/functions/_shared/sortFilterNormalizer.ts` - Standard sort/filter type definitions and mapping

### Modified Files
1. `supabase/functions/_shared/ebayBrowseSearch.ts` - Add sort param support
2. `supabase/functions/_shared/rainforestAdapter.ts` - Use dynamic sort_by
3. `supabase/functions/catalog-category/index.ts` - Wire sort/filter through
4. `supabase/functions/catalog-search/index.ts` - Wire sort/filter through
5. `supabase/functions/admin-get-carts/index.ts` - Add sort/filter params

### Frontend Updates (optional, for admin)
1. `src/pages/admin/ActiveCartsContent.tsx` - Add sortable column headers

---

## Technical Details

### Sort Parameter Validation

```typescript
const VALID_SORTS = ['relevance', 'price_asc', 'price_desc', 'newest', 'rating'] as const;
type SortOption = typeof VALID_SORTS[number];

function validateSort(sort: string | null): SortOption {
  if (sort && VALID_SORTS.includes(sort as SortOption)) {
    return sort as SortOption;
  }
  return 'relevance';
}
```

### Filter Parameter Schema

```typescript
interface CatalogFilters {
  minPrice?: number;
  maxPrice?: number;
  brand?: string[];
  condition?: 'new' | 'used' | 'refurbished';
  rating?: number; // minimum rating (1-5)
  freeShipping?: boolean;
}

function parseFilters(filtersParam: string | null): CatalogFilters {
  if (!filtersParam) return {};
  try {
    return JSON.parse(filtersParam);
  } catch {
    return {};
  }
}
```

---

## Rollback Plan

Each phase is independent:

**Phase 1 (Sort)**: Revert changes to adapters, endpoints continue to work with default sort

**Phase 2 (Filters)**: Remove filter application, filters param is ignored (current behavior)

**Phase 3 (Admin)**: Revert admin-get-carts, continue using hardcoded sort

---

## Expected Outcomes

| Feature | Before | After |
|---------|--------|-------|
| Catalog sort options | 1 (hardcoded) | 5 (user-selectable) |
| Filter application | Client-side only | Server-side (faster) |
| Admin cart sorting | Fixed (updated_at) | Flexible (any column) |
| API response clarity | Missing sort info | Explicit sort/filter in response |
