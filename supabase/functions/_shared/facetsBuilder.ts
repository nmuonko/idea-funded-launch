/**
 * Facets Builder
 * 
 * Generates Amazon-style facets/refinements for category and search results.
 * Supports caching to reduce costs.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ─── FACET TYPES ────────────────────────────────────────────────────────────────

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface FacetGroup {
  key: string;
  label: string;
  type: "single" | "multi" | "range" | "toggle" | "min";
  options?: FacetOption[];
  min?: number;
  max?: number;
}

export interface AppliedFilters {
  [key: string]: string | string[] | number | boolean;
}

// ─── DEFAULT FACETS BY CATEGORY ─────────────────────────────────────────────────

const ELECTRONICS_FACETS: FacetGroup[] = [
  {
    key: "brand",
    label: "Brand",
    type: "multi",
    options: [
      { value: "apple", label: "Apple" },
      { value: "samsung", label: "Samsung" },
      { value: "sony", label: "Sony" },
      { value: "lg", label: "LG" },
      { value: "google", label: "Google" },
      { value: "microsoft", label: "Microsoft" },
      { value: "dell", label: "Dell" },
      { value: "hp", label: "HP" },
      { value: "lenovo", label: "Lenovo" },
      { value: "asus", label: "ASUS" },
    ],
  },
  {
    key: "price",
    label: "Price",
    type: "range",
    min: 0,
    max: 5000,
  },
  {
    key: "condition",
    label: "Condition",
    type: "multi",
    options: [
      { value: "new", label: "New" },
      { value: "refurbished", label: "Refurbished" },
      { value: "used", label: "Used" },
    ],
  },
  {
    key: "rating",
    label: "Customer Rating",
    type: "min",
    options: [
      { value: "4", label: "4★ & Up" },
      { value: "3", label: "3★ & Up" },
      { value: "2", label: "2★ & Up" },
    ],
  },
  {
    key: "shipping",
    label: "Shipping",
    type: "multi",
    options: [
      { value: "free", label: "Free Shipping" },
      { value: "fast", label: "Fast & Free" },
    ],
  },
];

const VEHICLE_FACETS: FacetGroup[] = [
  {
    key: "make",
    label: "Make",
    type: "multi",
    options: [
      { value: "toyota", label: "Toyota" },
      { value: "honda", label: "Honda" },
      { value: "ford", label: "Ford" },
      { value: "chevrolet", label: "Chevrolet" },
      { value: "nissan", label: "Nissan" },
      { value: "bmw", label: "BMW" },
      { value: "mercedes", label: "Mercedes-Benz" },
      { value: "jeep", label: "Jeep" },
      { value: "ram", label: "Ram" },
      { value: "gmc", label: "GMC" },
    ],
  },
  {
    key: "price",
    label: "Price",
    type: "range",
    min: 1500,
    max: 100000,
  },
  {
    key: "year",
    label: "Year",
    type: "range",
    min: 2000,
    max: 2025,
  },
  {
    key: "mileage",
    label: "Mileage",
    type: "range",
    min: 0,
    max: 200000,
  },
  {
    key: "condition",
    label: "Condition",
    type: "multi",
    options: [
      { value: "new", label: "New" },
      { value: "certified", label: "Certified Pre-Owned" },
      { value: "used", label: "Used" },
    ],
  },
  {
    key: "transmission",
    label: "Transmission",
    type: "multi",
    options: [
      { value: "automatic", label: "Automatic" },
      { value: "manual", label: "Manual" },
    ],
  },
  {
    key: "fuel_type",
    label: "Fuel Type",
    type: "multi",
    options: [
      { value: "gasoline", label: "Gasoline" },
      { value: "diesel", label: "Diesel" },
      { value: "hybrid", label: "Hybrid" },
      { value: "electric", label: "Electric" },
    ],
  },
];

const CLOTHING_FACETS: FacetGroup[] = [
  {
    key: "brand",
    label: "Brand",
    type: "multi",
    options: [
      { value: "nike", label: "Nike" },
      { value: "adidas", label: "Adidas" },
      { value: "puma", label: "Puma" },
      { value: "levis", label: "Levi's" },
      { value: "zara", label: "Zara" },
      { value: "hm", label: "H&M" },
      { value: "gucci", label: "Gucci" },
      { value: "louis_vuitton", label: "Louis Vuitton" },
    ],
  },
  {
    key: "price",
    label: "Price",
    type: "range",
    min: 0,
    max: 1000,
  },
  {
    key: "size",
    label: "Size",
    type: "multi",
    options: [
      { value: "xs", label: "XS" },
      { value: "s", label: "S" },
      { value: "m", label: "M" },
      { value: "l", label: "L" },
      { value: "xl", label: "XL" },
      { value: "xxl", label: "XXL" },
    ],
  },
  {
    key: "condition",
    label: "Condition",
    type: "multi",
    options: [
      { value: "new_with_tags", label: "New with tags" },
      { value: "new_without_tags", label: "New without tags" },
      { value: "pre_owned", label: "Pre-owned" },
    ],
  },
  {
    key: "color",
    label: "Color",
    type: "multi",
    options: [
      { value: "black", label: "Black" },
      { value: "white", label: "White" },
      { value: "blue", label: "Blue" },
      { value: "red", label: "Red" },
      { value: "green", label: "Green" },
      { value: "gray", label: "Gray" },
    ],
  },
];

const HOME_GARDEN_FACETS: FacetGroup[] = [
  {
    key: "brand",
    label: "Brand",
    type: "multi",
    options: [
      { value: "dyson", label: "Dyson" },
      { value: "shark", label: "Shark" },
      { value: "kitchenaid", label: "KitchenAid" },
      { value: "cuisinart", label: "Cuisinart" },
      { value: "ninja", label: "Ninja" },
      { value: "dewalt", label: "DeWalt" },
      { value: "black_decker", label: "Black & Decker" },
    ],
  },
  {
    key: "price",
    label: "Price",
    type: "range",
    min: 0,
    max: 2000,
  },
  {
    key: "condition",
    label: "Condition",
    type: "multi",
    options: [
      { value: "new", label: "New" },
      { value: "refurbished", label: "Refurbished" },
      { value: "used", label: "Used" },
    ],
  },
];

const PARTS_FACETS: FacetGroup[] = [
  {
    key: "brand",
    label: "Brand",
    type: "multi",
    options: [
      { value: "oem", label: "OEM" },
      { value: "aftermarket", label: "Aftermarket" },
      { value: "bosch", label: "Bosch" },
      { value: "denso", label: "Denso" },
      { value: "acdelco", label: "ACDelco" },
      { value: "motorcraft", label: "Motorcraft" },
    ],
  },
  {
    key: "price",
    label: "Price",
    type: "range",
    min: 0,
    max: 500,
  },
  {
    key: "condition",
    label: "Condition",
    type: "multi",
    options: [
      { value: "new", label: "New" },
      { value: "remanufactured", label: "Remanufactured" },
      { value: "used", label: "Used" },
    ],
  },
  {
    key: "compatibility",
    label: "Compatibility",
    type: "toggle",
    options: [
      { value: "universal", label: "Universal Fit" },
    ],
  },
];

const DEFAULT_FACETS: FacetGroup[] = [
  {
    key: "price",
    label: "Price",
    type: "range",
    min: 0,
    max: 10000,
  },
  {
    key: "condition",
    label: "Condition",
    type: "multi",
    options: [
      { value: "new", label: "New" },
      { value: "refurbished", label: "Refurbished" },
      { value: "used", label: "Used" },
    ],
  },
  {
    key: "shipping",
    label: "Shipping",
    type: "multi",
    options: [
      { value: "free", label: "Free Shipping" },
    ],
  },
];

// ─── FACET MAPPING BY CATEGORY ──────────────────────────────────────────────────

const CATEGORY_FACETS: Record<string, FacetGroup[]> = {
  // Electronics
  electronics: ELECTRONICS_FACETS,
  electronics_phones: ELECTRONICS_FACETS,
  electronics_computers: ELECTRONICS_FACETS,
  electronics_gaming: ELECTRONICS_FACETS,
  electronics_cameras: ELECTRONICS_FACETS,
  electronics_audio: ELECTRONICS_FACETS,
  
  // Vehicles
  vehicles: VEHICLE_FACETS,
  vehicles_all: VEHICLE_FACETS,
  vehicles_cars_trucks: VEHICLE_FACETS,
  vehicles_motorcycles: VEHICLE_FACETS,
  vehicles_powersports: VEHICLE_FACETS,
  vehicles_boats: VEHICLE_FACETS,
  vehicles_rvs_campers: VEHICLE_FACETS,
  vehicles_trailers_other: VEHICLE_FACETS,
  vehicles_classic_cars: VEHICLE_FACETS,
  vehicles_parts_accessories: PARTS_FACETS,
  
  // Clothing
  clothing_shoes_accessories: CLOTHING_FACETS,
  clothing_men: CLOTHING_FACETS,
  clothing_women: CLOTHING_FACETS,
  clothing_shoes: CLOTHING_FACETS,
  clothing_bags: CLOTHING_FACETS,
  
  // Home & Garden
  home_garden: HOME_GARDEN_FACETS,
  
  // Parts
  parts_accessories: PARTS_FACETS,
};

// ─── PUBLIC API ─────────────────────────────────────────────────────────────────

/**
 * Get facets for a resolved category key
 */
export function getFacetsForCategory(resolvedKey: string): FacetGroup[] {
  return CATEGORY_FACETS[resolvedKey] || DEFAULT_FACETS;
}

/**
 * Get cached facets or generate new ones
 */
export async function getCachedOrBuildFacets(
  supabase: SupabaseClient,
  provider: string,
  resolvedKey: string,
  query: string | null,
  requestId: string
): Promise<FacetGroup[]> {
  const cacheKey = `${provider}:${resolvedKey}:${query || "_no_query_"}`;
  
  // Try cache first
  try {
    const { data: cached, error } = await supabase
      .from("catalog_facets_cache")
      .select("facets, expires_at")
      .eq("cache_key", cacheKey)
      .single();
    
    if (!error && cached && new Date(cached.expires_at) > new Date()) {
      console.log(`[CATALOG_FACETS] requestId=${requestId} cache HIT key=${cacheKey}`);
      return cached.facets as FacetGroup[];
    }
  } catch (e) {
    // Cache miss or error
  }
  
  // Generate facets
  const facets = getFacetsForCategory(resolvedKey);
  console.log(`[CATALOG_FACETS] requestId=${requestId} cache MISS key=${cacheKey} generated=${facets.length} groups`);
  
  // Store in cache (async, don't wait)
  supabase
    .from("catalog_facets_cache")
    .upsert({
      cache_key: cacheKey,
      provider,
      resolved_key: resolvedKey,
      query,
      facets,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
    }, { onConflict: "cache_key" })
    .then(() => {})
    .catch((err) => console.error(`[CATALOG_FACETS] cache upsert error:`, err));
  
  return facets;
}

/**
 * Apply filters to items (client-side filtering for demo purposes)
 * In production, this would be done via provider API or DB query
 */
export function applyFiltersToItems<T extends { priceUsd?: number | null; brand?: string | null }>(
  items: T[],
  filters: AppliedFilters
): T[] {
  return items.filter(item => {
    // Price filter
    if (filters.minPrice !== undefined && item.priceUsd !== null && item.priceUsd !== undefined) {
      if (item.priceUsd < (filters.minPrice as number)) return false;
    }
    if (filters.maxPrice !== undefined && item.priceUsd !== null && item.priceUsd !== undefined) {
      if (item.priceUsd > (filters.maxPrice as number)) return false;
    }
    
    // Brand filter
    if (filters.brand && item.brand) {
      const brandFilters = Array.isArray(filters.brand) ? filters.brand : [filters.brand];
      const itemBrand = item.brand.toLowerCase();
      if (!brandFilters.some(b => itemBrand.includes(b.toLowerCase()))) {
        return false;
      }
    }
    
    return true;
  });
}
