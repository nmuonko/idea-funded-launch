/**
 * catalog-filters
 * Returns normalized filter groups (Amazon-style refinements) for a category
 * 
 * GET /catalog-filters?category=electronics_phones
 * 
 * Returns:
 * {
 *   status: "success",
 *   category: "electronics_phones",
 *   filters: [
 *     { key: "brand", title: "Brand", type: "multi", options: [...] },
 *     { key: "price", title: "Price", type: "range", min: 0, max: 5000 },
 *     ...
 *   ]
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { 
  resolveCategoryOrError,
  getCategoryMeta,
  CategoryResolution,
} from "../_shared/categoryRegistry.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=300",
};

// ─── FILTER TYPES ─────────────────────────────────────────────────────────────

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface FilterGroup {
  key: string;
  title: string;
  type: "single" | "multi" | "range" | "toggle";
  options?: FilterOption[];
  min?: number;
  max?: number;
}

// ─── PREDEFINED FILTERS BY CATEGORY ───────────────────────────────────────────

const ELECTRONICS_BRANDS: FilterOption[] = [
  { value: "apple", label: "Apple" },
  { value: "samsung", label: "Samsung" },
  { value: "google", label: "Google" },
  { value: "sony", label: "Sony" },
  { value: "lg", label: "LG" },
  { value: "dell", label: "Dell" },
  { value: "hp", label: "HP" },
  { value: "lenovo", label: "Lenovo" },
  { value: "asus", label: "ASUS" },
  { value: "microsoft", label: "Microsoft" },
  { value: "bose", label: "Bose" },
  { value: "jbl", label: "JBL" },
];

const CLOTHING_BRANDS: FilterOption[] = [
  { value: "nike", label: "Nike" },
  { value: "adidas", label: "Adidas" },
  { value: "puma", label: "Puma" },
  { value: "under_armour", label: "Under Armour" },
  { value: "zara", label: "Zara" },
  { value: "h&m", label: "H&M" },
  { value: "shein", label: "SHEIN" },
  { value: "levis", label: "Levi's" },
  { value: "gucci", label: "Gucci" },
  { value: "louis_vuitton", label: "Louis Vuitton" },
];

const VEHICLE_MAKES: FilterOption[] = [
  { value: "toyota", label: "Toyota" },
  { value: "honda", label: "Honda" },
  { value: "ford", label: "Ford" },
  { value: "chevrolet", label: "Chevrolet" },
  { value: "bmw", label: "BMW" },
  { value: "mercedes", label: "Mercedes-Benz" },
  { value: "nissan", label: "Nissan" },
  { value: "hyundai", label: "Hyundai" },
  { value: "kia", label: "Kia" },
  { value: "volkswagen", label: "Volkswagen" },
];

const CONDITION_OPTIONS: FilterOption[] = [
  { value: "new", label: "New" },
  { value: "used", label: "Used" },
  { value: "refurbished", label: "Refurbished" },
  { value: "for_parts", label: "For Parts/Not Working" },
];

const VEHICLE_CONDITION_OPTIONS: FilterOption[] = [
  { value: "new", label: "New" },
  { value: "used", label: "Used" },
  { value: "certified_pre_owned", label: "Certified Pre-Owned" },
  { value: "salvage", label: "Salvage" },
];

const RATING_OPTIONS: FilterOption[] = [
  { value: "4", label: "4 Stars & Up" },
  { value: "3", label: "3 Stars & Up" },
  { value: "2", label: "2 Stars & Up" },
  { value: "1", label: "1 Star & Up" },
];

// ─── FILTER BUILDERS BY CATEGORY ──────────────────────────────────────────────

function getElectronicsFilters(subcategory: string | null): FilterGroup[] {
  const filters: FilterGroup[] = [
    {
      key: "brand",
      title: "Brand",
      type: "multi",
      options: ELECTRONICS_BRANDS,
    },
    {
      key: "price",
      title: "Price",
      type: "range",
      min: 0,
      max: 5000,
    },
    {
      key: "condition",
      title: "Condition",
      type: "multi",
      options: CONDITION_OPTIONS,
    },
    {
      key: "rating",
      title: "Customer Rating",
      type: "single",
      options: RATING_OPTIONS,
    },
  ];

  // Add category-specific filters
  if (subcategory === "phones") {
    filters.push({
      key: "storage",
      title: "Storage Capacity",
      type: "multi",
      options: [
        { value: "64gb", label: "64 GB" },
        { value: "128gb", label: "128 GB" },
        { value: "256gb", label: "256 GB" },
        { value: "512gb", label: "512 GB" },
        { value: "1tb", label: "1 TB" },
      ],
    });
  }

  if (subcategory === "computers") {
    filters.push({
      key: "ram",
      title: "RAM",
      type: "multi",
      options: [
        { value: "4gb", label: "4 GB" },
        { value: "8gb", label: "8 GB" },
        { value: "16gb", label: "16 GB" },
        { value: "32gb", label: "32 GB" },
        { value: "64gb", label: "64 GB" },
      ],
    });
  }

  return filters;
}

function getVehicleFilters(subcategory: string | null): FilterGroup[] {
  const filters: FilterGroup[] = [
    {
      key: "make",
      title: "Make",
      type: "multi",
      options: VEHICLE_MAKES,
    },
    {
      key: "price",
      title: "Price",
      type: "range",
      min: 1000,
      max: 100000,
    },
    {
      key: "year",
      title: "Year",
      type: "range",
      min: 1990,
      max: new Date().getFullYear() + 1,
    },
    {
      key: "condition",
      title: "Condition",
      type: "multi",
      options: VEHICLE_CONDITION_OPTIONS,
    },
    {
      key: "mileage",
      title: "Mileage",
      type: "range",
      min: 0,
      max: 200000,
    },
  ];

  if (subcategory === "cars_trucks") {
    filters.push({
      key: "body_type",
      title: "Body Type",
      type: "multi",
      options: [
        { value: "sedan", label: "Sedan" },
        { value: "suv", label: "SUV" },
        { value: "truck", label: "Truck" },
        { value: "coupe", label: "Coupe" },
        { value: "hatchback", label: "Hatchback" },
        { value: "wagon", label: "Wagon" },
        { value: "van", label: "Van" },
        { value: "convertible", label: "Convertible" },
      ],
    });
    filters.push({
      key: "transmission",
      title: "Transmission",
      type: "single",
      options: [
        { value: "automatic", label: "Automatic" },
        { value: "manual", label: "Manual" },
        { value: "cvt", label: "CVT" },
      ],
    });
  }

  if (subcategory === "motorcycles") {
    filters.push({
      key: "type",
      title: "Type",
      type: "multi",
      options: [
        { value: "cruiser", label: "Cruiser" },
        { value: "sport", label: "Sport" },
        { value: "touring", label: "Touring" },
        { value: "standard", label: "Standard" },
        { value: "dual_sport", label: "Dual Sport" },
        { value: "scooter", label: "Scooter" },
      ],
    });
  }

  return filters;
}

function getClothingFilters(subcategory: string | null): FilterGroup[] {
  const filters: FilterGroup[] = [
    {
      key: "brand",
      title: "Brand",
      type: "multi",
      options: CLOTHING_BRANDS,
    },
    {
      key: "price",
      title: "Price",
      type: "range",
      min: 0,
      max: 500,
    },
    {
      key: "size",
      title: "Size",
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
      title: "Condition",
      type: "multi",
      options: [
        { value: "new_with_tags", label: "New with Tags" },
        { value: "new_without_tags", label: "New without Tags" },
        { value: "pre_owned", label: "Pre-Owned" },
      ],
    },
  ];

  if (subcategory === "shoes") {
    filters.push({
      key: "shoe_size",
      title: "Shoe Size (US)",
      type: "multi",
      options: [
        { value: "6", label: "6" },
        { value: "7", label: "7" },
        { value: "8", label: "8" },
        { value: "9", label: "9" },
        { value: "10", label: "10" },
        { value: "11", label: "11" },
        { value: "12", label: "12" },
        { value: "13", label: "13" },
      ],
    });
  }

  return filters;
}

function getDefaultFilters(): FilterGroup[] {
  return [
    {
      key: "price",
      title: "Price",
      type: "range",
      min: 0,
      max: 10000,
    },
    {
      key: "condition",
      title: "Condition",
      type: "multi",
      options: CONDITION_OPTIONS,
    },
    {
      key: "rating",
      title: "Customer Rating",
      type: "single",
      options: RATING_OPTIONS,
    },
  ];
}

function getFiltersForCategory(parentTab: string, subtabKey: string | null): FilterGroup[] {
  const subcategory = subtabKey?.replace(`${parentTab}_`, "") || null;

  switch (parentTab) {
    case "electronics":
      return getElectronicsFilters(subcategory);
    case "vehicles":
      return getVehicleFilters(subcategory);
    case "clothing_shoes_accessories":
      return getClothingFilters(subcategory);
    case "home_garden":
      return [
        {
          key: "price",
          title: "Price",
          type: "range",
          min: 0,
          max: 2000,
        },
        {
          key: "condition",
          title: "Condition",
          type: "multi",
          options: CONDITION_OPTIONS,
        },
        {
          key: "brand",
          title: "Brand",
          type: "multi",
          options: [
            { value: "dyson", label: "Dyson" },
            { value: "ninja", label: "Ninja" },
            { value: "instant_pot", label: "Instant Pot" },
            { value: "dewalt", label: "DeWalt" },
            { value: "makita", label: "Makita" },
          ],
        },
      ];
    case "toys":
      return [
        {
          key: "price",
          title: "Price",
          type: "range",
          min: 0,
          max: 500,
        },
        {
          key: "age_range",
          title: "Age Range",
          type: "multi",
          options: [
            { value: "0_2", label: "0-2 Years" },
            { value: "3_5", label: "3-5 Years" },
            { value: "6_8", label: "6-8 Years" },
            { value: "9_12", label: "9-12 Years" },
            { value: "13_plus", label: "13+ Years" },
          ],
        },
        {
          key: "brand",
          title: "Brand",
          type: "multi",
          options: [
            { value: "lego", label: "LEGO" },
            { value: "hasbro", label: "Hasbro" },
            { value: "mattel", label: "Mattel" },
            { value: "nintendo", label: "Nintendo" },
          ],
        },
      ];
    case "jewelry_watches":
      return [
        {
          key: "price",
          title: "Price",
          type: "range",
          min: 0,
          max: 10000,
        },
        {
          key: "material",
          title: "Material",
          type: "multi",
          options: [
            { value: "gold", label: "Gold" },
            { value: "silver", label: "Silver" },
            { value: "platinum", label: "Platinum" },
            { value: "stainless_steel", label: "Stainless Steel" },
            { value: "leather", label: "Leather" },
          ],
        },
        {
          key: "brand",
          title: "Brand",
          type: "multi",
          options: [
            { value: "rolex", label: "Rolex" },
            { value: "omega", label: "Omega" },
            { value: "cartier", label: "Cartier" },
            { value: "apple", label: "Apple" },
            { value: "seiko", label: "Seiko" },
          ],
        },
      ];
    default:
      return getDefaultFilters();
  }
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  const url = new URL(req.url);

  let envName: EnvironmentName = "production";
  try {
    envName = getEnvironmentFromRequest(req);
  } catch {
    envName = "production";
  }

  const categoryRaw = url.searchParams.get("category") || "";

  console.log(`[CATALOG_FILTERS] requestId=${requestId} category=${categoryRaw} env=${envName}`);

  if (!ALLOWED_ENVS.includes(envName)) {
    return new Response(
      JSON.stringify({
        status: "error",
        category: categoryRaw,
        filters: [],
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!categoryRaw) {
    return new Response(
      JSON.stringify({
        status: "error",
        category: "",
        filters: [],
        error: { message: "Missing required 'category' parameter", code: "MISSING_CATEGORY" },
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Resolve category
  const resolution = resolveCategoryOrError(categoryRaw);

  if ("error" in resolution) {
    return new Response(
      JSON.stringify({
        status: "error",
        category: categoryRaw,
        filters: [],
        error: { 
          message: `Invalid category: "${categoryRaw}"`, 
          code: "INVALID_CATEGORY",
          suggestions: resolution.suggestions,
        },
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const resolved = resolution as CategoryResolution;
  const canonicalKey = resolved.resolved!;
  const parentTab = resolved.parentTab || canonicalKey;
  const subtabKey = resolved.subtabKey;

  // Get filters for this category
  const filters = getFiltersForCategory(parentTab, subtabKey);

  const durationMs = Date.now() - startTime;
  console.log(`[CATALOG_FILTERS] requestId=${requestId} category=${canonicalKey} groups=${filters.length} durationMs=${durationMs}`);

  return new Response(
    JSON.stringify({
      status: "success",
      category: canonicalKey,
      categoryResolved: {
        requested: categoryRaw,
        resolved: canonicalKey,
        resolution: resolved.method,
      },
      filters,
      error: null,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
