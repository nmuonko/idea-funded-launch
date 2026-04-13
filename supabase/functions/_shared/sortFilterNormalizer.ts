/**
 * Sort/Filter Normalizer
 * Standardized sort and filter types with provider-specific mappings
 */

// ─── SORT OPTIONS ─────────────────────────────────────────────────────────────

export const VALID_SORTS = ['smart', 'relevance', 'price_asc', 'price_desc', 'newest', 'rating'] as const;
export type SortOption = typeof VALID_SORTS[number];

// eBay Browse API sort mappings
// https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
export const EBAY_SORT_MAP: Record<SortOption, string | null> = {
  'smart': 'price',   // Fetch by price, re-rank client-side with composite score
  'relevance': null,  // Default (Best Match)
  'price_asc': 'price',
  'price_desc': '-price',
  'newest': 'newlyListed',
  'rating': null,  // eBay doesn't support rating sort, use post-filter
};

// Rainforest API sort mappings
// https://www.rainforestapi.com/docs/product-data-api/parameters/search
export const RAINFOREST_SORT_MAP: Record<SortOption, string> = {
  'smart': 'price_low_to_high', // Fetch by price, re-rank with composite score
  'relevance': 'featured',
  'price_asc': 'price_low_to_high',
  'price_desc': 'price_high_to_low',
  'newest': 'most_recent',
  'rating': 'average_review',
};

// Supabase DB order mappings for catalog_items
export const DB_SORT_MAP: Record<SortOption, { column: string; ascending: boolean }> = {
  'smart': { column: 'price_usd', ascending: true }, // Fetch cheapest, re-rank with composite
  'relevance': { column: 'rating', ascending: false },
  'price_asc': { column: 'price_usd', ascending: true },
  'price_desc': { column: 'price_usd', ascending: false },
  'newest': { column: 'updated_at', ascending: false },
  'rating': { column: 'rating', ascending: false },
};

/**
 * Validate and normalize sort parameter
 */
export function validateSort(sort: string | null): SortOption {
  if (sort && VALID_SORTS.includes(sort as SortOption)) {
    return sort as SortOption;
  }
  return 'relevance';
}

/**
 * Get eBay sort parameter (or null for default)
 */
export function getEbaySort(sort: SortOption): string | null {
  return EBAY_SORT_MAP[sort];
}

/**
 * Get Rainforest sort parameter
 */
export function getRainforestSort(sort: SortOption): string {
  return RAINFOREST_SORT_MAP[sort];
}

/**
 * Get Supabase order config
 */
export function getDbSort(sort: SortOption): { column: string; ascending: boolean } {
  return DB_SORT_MAP[sort];
}

// ─── FILTER OPTIONS ───────────────────────────────────────────────────────────

export interface CatalogFilters {
  minPrice?: number;
  maxPrice?: number;
  brand?: string[];
  condition?: 'new' | 'used' | 'refurbished' | 'any';
  rating?: number; // minimum rating (1-5)
  freeShipping?: boolean;
}

// eBay condition ID mappings
const EBAY_CONDITION_MAP: Record<string, string> = {
  'new': 'NEW',
  'used': 'USED',
  'refurbished': 'MANUFACTURER_REFURBISHED',
};

/**
 * Parse filters from JSON query param
 */
export function parseFilters(filtersParam: string | null): CatalogFilters {
  if (!filtersParam) return {};
  try {
    const parsed = JSON.parse(filtersParam);
    // Validate and sanitize
    const filters: CatalogFilters = {};
    
    if (typeof parsed.minPrice === 'number' && parsed.minPrice >= 0) {
      filters.minPrice = parsed.minPrice;
    }
    if (typeof parsed.maxPrice === 'number' && parsed.maxPrice > 0) {
      filters.maxPrice = parsed.maxPrice;
    }
    if (Array.isArray(parsed.brand)) {
      filters.brand = parsed.brand.filter((b: unknown) => typeof b === 'string' && b.length > 0);
      if (filters.brand.length === 0) delete filters.brand;
    }
    if (['new', 'used', 'refurbished', 'any'].includes(parsed.condition)) {
      filters.condition = parsed.condition;
    }
    if (typeof parsed.rating === 'number' && parsed.rating >= 1 && parsed.rating <= 5) {
      filters.rating = parsed.rating;
    }
    if (typeof parsed.freeShipping === 'boolean') {
      filters.freeShipping = parsed.freeShipping;
    }
    
    return filters;
  } catch {
    return {};
  }
}

/**
 * Build eBay filter string parts for Browse API
 */
export function buildEbayFilters(filters: CatalogFilters, existingFilters: string[] = []): string[] {
  const parts = [...existingFilters];
  
  // Price range
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const min = filters.minPrice || 0;
    const max = filters.maxPrice !== undefined ? filters.maxPrice : '';
    parts.push(`price:[${min}..${max}],priceCurrency:USD`);
  }
  
  // Condition
  if (filters.condition && filters.condition !== 'any') {
    const ebayCondition = EBAY_CONDITION_MAP[filters.condition];
    if (ebayCondition) {
      parts.push(`conditions:{${ebayCondition}}`);
    }
  }
  
  // Free shipping
  if (filters.freeShipping) {
    parts.push('maxDeliveryCost:0');
  }
  
  return parts;
}

/**
 * Apply filters to Supabase query for catalog_items
 * Returns a modified query builder
 */
export function applyDbFilters<T extends { gte: Function; lte: Function; or: Function }>(
  query: T,
  filters: CatalogFilters
): T {
  if (filters.minPrice !== undefined) {
    query = query.gte('price_usd', filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte('price_usd', filters.maxPrice);
  }
  if (filters.brand && filters.brand.length > 0) {
    // Use ilike for brand matching
    const brandFilters = filters.brand.map(b => `brand.ilike.%${b}%`);
    query = query.or(brandFilters.join(','));
  }
  if (filters.rating !== undefined) {
    query = query.gte('rating', filters.rating);
  }
  // Note: condition and freeShipping require metadata fields not always available in DB
  
  return query;
}

/**
 * Post-filter items array for filters not supported by API
 * (e.g., brand filtering when API doesn't support it, rating sort for eBay)
 */
export function postFilterItems<T extends { 
  priceUsd?: number | null; 
  price_usd?: number | null;
  brand?: string | null; 
  rating?: number | null;
}>(
  items: T[],
  filters: CatalogFilters
): T[] {
  let filtered = items;
  
  if (filters.minPrice !== undefined) {
    filtered = filtered.filter(item => {
      const price = item.priceUsd ?? item.price_usd ?? 0;
      return price >= (filters.minPrice || 0);
    });
  }
  
  if (filters.maxPrice !== undefined) {
    filtered = filtered.filter(item => {
      const price = item.priceUsd ?? item.price_usd ?? 0;
      return price <= (filters.maxPrice || Infinity);
    });
  }
  
  if (filters.brand && filters.brand.length > 0) {
    const lowerBrands = filters.brand.map(b => b.toLowerCase());
    filtered = filtered.filter(item => {
      if (!item.brand) return false;
      return lowerBrands.some(b => item.brand!.toLowerCase().includes(b));
    });
  }
  
  if (filters.rating !== undefined) {
    filtered = filtered.filter(item => (item.rating ?? 0) >= (filters.rating || 0));
  }
  
  return filtered;
}

/**
 * Post-sort items array (for sorts not supported by API, e.g., eBay rating)
 * 
 * "smart" sort: composite score blending relevance + price competitiveness + rating
 *   Formula: 0.50 * relevance_norm + 0.35 * price_score + 0.15 * rating_norm
 *   - relevance_norm: existing _score normalized to 0-100
 *   - price_score: percentile rank inverted (cheapest = 100, most expensive = 0)
 *   - rating_norm: rating/5 * 100
 */
export function postSortItems<T extends { 
  priceUsd?: number | null;
  price_usd?: number | null;
  rating?: number | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  _score?: number;
}>(
  items: T[],
  sort: SortOption
): T[] {
  const sorted = [...items];
  
  switch (sort) {
    case 'smart': {
      if (sorted.length === 0) return sorted;

      // Gather numeric ranges for normalization
      const prices = sorted.map(i => i.priceUsd ?? i.price_usd ?? 0).filter(p => p > 0);
      const scores = sorted.map(i => (i as any)._score ?? 0);
      const minPrice = Math.min(...prices, 1);
      const maxPrice = Math.max(...prices, 1);
      const maxScore = Math.max(...scores, 1);
      const priceRange = maxPrice - minPrice || 1;

      // Compute composite smart score for each item
      const withSmartScore = sorted.map(item => {
        const price = item.priceUsd ?? item.price_usd ?? 0;
        const relevance = (item as any)._score ?? 0;
        const rating = item.rating ?? 0;

        // Normalize relevance: 0-100 based on max score in result set
        const relevanceNorm = maxScore > 0 ? (relevance / maxScore) * 100 : 50;

        // Price competitiveness: cheapest = 100, most expensive = 0
        const priceScore = price > 0
          ? (1 - (price - minPrice) / priceRange) * 100
          : 0;

        // Rating normalized: 0-100
        const ratingNorm = (rating / 5) * 100;

        // Weighted composite: relevance-heavy but rewards low price
        const smartScore = 0.50 * relevanceNorm + 0.35 * priceScore + 0.15 * ratingNorm;

        return { item, smartScore };
      });

      // Sort descending by smart score
      withSmartScore.sort((a, b) => b.smartScore - a.smartScore);
      return withSmartScore.map(s => s.item);
    }
    case 'price_asc':
      return sorted.sort((a, b) => {
        const priceA = a.priceUsd ?? a.price_usd ?? 0;
        const priceB = b.priceUsd ?? b.price_usd ?? 0;
        return priceA - priceB;
      });
    case 'price_desc':
      return sorted.sort((a, b) => {
        const priceA = a.priceUsd ?? a.price_usd ?? 0;
        const priceB = b.priceUsd ?? b.price_usd ?? 0;
        return priceB - priceA;
      });
    case 'rating':
      return sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    case 'newest':
      return sorted.sort((a, b) => {
        const dateA = a.updatedAt ?? a.updated_at ?? '';
        const dateB = b.updatedAt ?? b.updated_at ?? '';
        return dateB.localeCompare(dateA);
      });
    default:
      return sorted;
  }
}

// ─── RESPONSE HELPERS ─────────────────────────────────────────────────────────

export interface AppliedSortFilter {
  sort: {
    field: SortOption;
    applied: boolean;
  };
  filters: CatalogFilters;
}

/**
 * Build applied sort/filter info for response
 */
export function buildAppliedSortFilter(
  sort: SortOption,
  filters: CatalogFilters,
  sortApplied: boolean = true
): AppliedSortFilter {
  return {
    sort: {
      field: sort,
      applied: sortApplied,
    },
    filters,
  };
}
