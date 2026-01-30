/**
 * Catalog Home Endpoint - DB-First with eBay Live Top-Up
 * Uses CANONICAL category keys from categoryRegistry
 * 
 * Returns:
 * {
 *   status: "success",
 *   env,
 *   sections: [...],
 *   tabs: [...],
 *   error: null
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
import { normalizeAndValidateImageUrl } from "../_shared/imageValidation.ts";
import { 
  CANONICAL_TABS, 
  CANONICAL_SUBTABS,
  getCategoryMeta,
  getEbayCategoryId,
} from "../_shared/categoryRegistry.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=60",
};

const HOME_MIN_PER_SECTION = 6;
const HOME_PAGE_SIZE = 12;

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  imageUrl: string | null;
  imageMissing: boolean;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  unifiedCategory: string | null;
  unifiedSubcategory: string | null;
}

interface SeeAllMeta {
  type: "search";
  q: string;
  category_key: string | null;
}

interface Section {
  key: string;
  title: string;
  categoryKey: string;       // CANONICAL key e.g. "electronics_phones"
  parentTab: string;         // Parent tab key e.g. "electronics"
  subtabKey: string | null;  // Subtab suffix e.g. "phones"
  items: CatalogItem[];
  hasMore: boolean;
  dbCount: number;
  liveTopUpCount: number;
  see_all: SeeAllMeta;       // "See All" routing metadata
}

interface Tab {
  key: string;
  titleEn: string;
  titleFr: string;
  icon: string | null;
  orderIndex: number;
  subtabs: Array<{
    key: string;
    titleEn: string;
    titleFr: string;
    orderIndex: number;
  }>;
}

interface HomeSectionConfig {
  key: string;               // Section display key
  categoryKey: string;       // CANONICAL category key (e.g., "electronics_phones")
  parentTab: string;         // Parent tab key
  subtabKey: string | null;  // Subtab suffix
  title: string;
  isVehicle: boolean;
  minPrice: number;
  seedQueries: string[];
  ebayCategory?: string;
  seeAllQuery: string;       // Query for "See All" mixed search
}

// Home sections using CANONICAL keys with "see_all" queries
// IMPORTANT: seeAllQuery MUST be non-empty to route to /catalog-search (mixed mode)
const HOME_SECTIONS: HomeSectionConfig[] = [
  {
    key: "phones",
    categoryKey: "electronics_phones",
    parentTab: "electronics",
    subtabKey: "phones",
    title: "Phones",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["iphone 15", "samsung galaxy", "tecno camon", "infinix hot", "google pixel"],
    ebayCategory: "9355",
    seeAllQuery: "iphone",  // → /catalog-search?q=iphone&category_key=electronics_phones
  },
  {
    key: "vehicles",
    categoryKey: "vehicles_cars_trucks",
    parentTab: "vehicles",
    subtabKey: "cars_trucks",
    title: "Vehicles",
    isVehicle: true,
    minPrice: 1500,
    seedQueries: ["used car for sale", "toyota camry", "honda accord", "ford f150"],
    ebayCategory: "6001",
    seeAllQuery: "cars",  // → /catalog-search?q=cars&category_key=vehicles_cars_trucks
  },
  {
    key: "gaming",
    categoryKey: "electronics_gaming",
    parentTab: "electronics",
    subtabKey: "gaming",
    title: "Gaming",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["ps5 console", "xbox series x", "nintendo switch", "gaming laptop"],
    ebayCategory: "1249",
    seeAllQuery: "ps5",  // → /catalog-search?q=ps5&category_key=electronics_gaming
  },
  {
    key: "clothing",
    categoryKey: "clothing_shoes_accessories",
    parentTab: "clothing_shoes_accessories",
    subtabKey: null,
    title: "Clothing & Shoes",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["men sneakers", "women sneakers", "hoodie", "jacket", "handbag"],
    ebayCategory: "63889",
    seeAllQuery: "shoes",  // → /catalog-search?q=shoes&category_key=clothing_shoes_accessories
  },
  {
    key: "home_garden",
    categoryKey: "home_garden",
    parentTab: "home_garden",
    subtabKey: null,
    title: "Home & Garden",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["cordless vacuum", "air fryer", "blender", "power tools"],
    ebayCategory: "11700",
    seeAllQuery: "sofa",  // → /catalog-search?q=sofa&category_key=home_garden
  },
  {
    key: "refurbished",
    categoryKey: "refurbished",
    parentTab: "refurbished",
    subtabKey: null,
    title: "Refurbished",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["refurbished iphone", "refurbished laptop", "refurbished macbook"],
    ebayCategory: "11800",
    seeAllQuery: "refurbished",  // → /catalog-search?q=refurbished&category_key=refurbished
  },
  {
    key: "parts_accessories",
    categoryKey: "parts_accessories",
    parentTab: "parts_accessories",
    subtabKey: null,
    title: "Parts & Accessories",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["car parts", "phone accessories", "laptop charger"],
    ebayCategory: "6028",
    seeAllQuery: "parts",  // → /catalog-search?q=parts&category_key=parts_accessories
  },
];

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function mapDbItemToResponse(item: Record<string, unknown>): CatalogItem {
  let images: string[] = [];
  if (Array.isArray(item.images)) {
    images = item.images
      .filter((img): img is string => typeof img === "string")
      .map(img => normalizeAndValidateImageUrl(img, item.product_url as string))
      .filter((img): img is string => img !== null);
  }

  const rawImageUrl = item.image_url as string | null;
  const validatedImageUrl = normalizeAndValidateImageUrl(rawImageUrl, item.product_url as string);

  return {
    id: item.id as string,
    provider: (item.provider as string) || "unknown",
    providerProductId: (item.provider_product_id as string) || (item.id as string),
    title: item.title as string | null,
    priceUsd: item.price_usd as number | null,
    imageUrl: validatedImageUrl || (images.length > 0 ? images[0] : null),
    imageMissing: !validatedImageUrl && images.length === 0,
    images,
    productUrl: item.product_url as string | null,
    inStock: item.in_stock as boolean | null,
    rating: item.rating as number | null,
    unifiedCategory: (item.unified_category as string) || null,
    unifiedSubcategory: (item.unified_subcategory as string) || null,
  };
}

function mapEbayItemToResponse(item: NormalizedItem): CatalogItem {
  const validatedImageUrl = normalizeAndValidateImageUrl(item.image_url, item.product_url);
  const validatedImages = item.images
    .map(img => normalizeAndValidateImageUrl(img, item.product_url))
    .filter((img): img is string => img !== null);

  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: validatedImageUrl || (validatedImages.length > 0 ? validatedImages[0] : null),
    imageMissing: !validatedImageUrl && validatedImages.length === 0,
    images: validatedImages,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: null,
    unifiedSubcategory: null,
  };
}

async function getSectionFromDB(
  supabase: any,
  config: HomeSectionConfig,
  maxItems: number
): Promise<CatalogItem[]> {
  let query = supabase
    .from("catalog_items")
    .select("*")
    .eq("unified_category", config.parentTab)
    .or("is_disallowed.is.null,is_disallowed.eq.false");

  if (config.subtabKey) {
    if (config.isVehicle) {
      query = query.eq("vehicles_subkey", config.subtabKey);
    } else {
      query = query.eq("unified_subcategory", config.subtabKey);
    }
  }

  if (config.isVehicle) {
    query = query.gte("price_usd", config.minPrice);
  }

  const { data: rows, error } = await query
    .order("updated_at", { ascending: false })
    .limit(maxItems + 10);

  if (error) {
    console.error(`[HOME_DB] Query error for ${config.key}:`, error.message);
    return [];
  }

  return (rows || []).map(row => mapDbItemToResponse(row as Record<string, unknown>));
}

async function fetchEbayLiveItems(
  supabase: any,
  config: HomeSectionConfig,
  neededCount: number,
  requestId: string
): Promise<CatalogItem[]> {
  console.log(`[HOME_EBAY] requestId=${requestId} section=${config.key} neededCount=${neededCount}`);

  const allItems: CatalogItem[] = [];
  const seenIds = new Set<string>();

  for (const query of config.seedQueries.slice(0, 2)) {
    if (allItems.length >= neededCount) break;

    try {
      const result = await searchEbay(
        supabase,
        {
          query,
          categoryId: config.ebayCategory,
          page: 1,
          pageSize: 20,
          minPrice: config.minPrice > 0 ? config.minPrice : undefined,
          isVehicle: config.isVehicle,
          marketplaceId: "EBAY_US",
        },
        requestId
      );

      for (const ebayItem of result.items) {
        if (seenIds.has(ebayItem.id)) continue;

        // Content filter
        if (isDisallowedItem({ title: ebayItem.title, productUrl: ebayItem.product_url }).isDisallowed) {
          continue;
        }

        // Vehicle filter
        if (config.isVehicle) {
          const filterResult = isAllowedMotorListing({ title: ebayItem.title, priceUsd: ebayItem.price_usd });
          if (!filterResult.isAllowed) continue;
        }

        seenIds.add(ebayItem.id);
        allItems.push(mapEbayItemToResponse(ebayItem));
      }

      console.log(`[HOME_EBAY] requestId=${requestId} query="${query}" found=${result.items.length} filtered=${allItems.length}`);
    } catch (err) {
      console.error(`[HOME_EBAY] requestId=${requestId} query="${query}" error:`, err);
    }
  }

  // Upsert to DB
  if (allItems.length > 0) {
    const toUpsert = allItems.map(item => ({
      id: item.id,
      provider: item.provider,
      provider_product_id: item.providerProductId,
      title: item.title,
      price_usd: item.priceUsd,
      image_url: item.imageUrl,
      images: item.images,
      product_url: item.productUrl,
      in_stock: item.inStock,
      rating: item.rating,
      unified_category: config.parentTab,
      unified_subcategory: config.subtabKey,
      vehicles_subkey: config.isVehicle ? config.subtabKey : null,
      updated_at: new Date().toISOString(),
    }));

    await supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
  }

  return allItems;
}

// Build tabs from canonical registry
function buildTabs(): Tab[] {
  return CANONICAL_TABS.map((tabKey, index) => {
    const meta = getCategoryMeta(tabKey);
    const subtabs = CANONICAL_SUBTABS[tabKey] || [];
    
    return {
      key: tabKey,
      titleEn: meta?.titleEn || tabKey,
      titleFr: meta?.titleFr || tabKey,
      icon: null,
      orderIndex: index,
      subtabs: subtabs.map((subKey, subIndex) => {
        const subMeta = getCategoryMeta(subKey);
        return {
          key: subKey,
          titleEn: subMeta?.titleEn || subKey,
          titleFr: subMeta?.titleFr || subKey,
          orderIndex: subIndex,
        };
      }),
    };
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  let envName: EnvironmentName = "production";
  try {
    envName = getEnvironmentFromRequest(req);
  } catch {
    envName = "production";
  }

  console.log(`[HOME] requestId=${requestId} env=${envName}`);

  if (!ALLOWED_ENVS.includes(envName)) {
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        sections: [],
        tabs: [],
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          sections: [],
          tabs: [],
          error: { message: "Backend configuration error", code: "CONFIG_ERROR" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build tabs from canonical registry (single source of truth)
    const tabs = buildTabs();
    console.log(`[NAV] requestId=${requestId} tabs=${tabs.length} subtabs=${tabs.reduce((a, t) => a + t.subtabs.length, 0)}`);

    // Build sections
    const sections: Section[] = [];

    for (const config of HOME_SECTIONS) {
      let items = await getSectionFromDB(supabase, config, HOME_PAGE_SIZE);

      // If DB has fewer than minimum, top-up from eBay live
      let liveTopUpCount = 0;
      if (items.length < HOME_MIN_PER_SECTION) {
        console.log(`[HOME] requestId=${requestId} section=${config.key} dbCount=${items.length} < ${HOME_MIN_PER_SECTION}, fetching live`);
        const liveItems = await fetchEbayLiveItems(supabase, config, HOME_PAGE_SIZE - items.length, requestId);
        
        const seenIds = new Set(items.map(i => i.id));
        const newItems = liveItems.filter(i => !seenIds.has(i.id));
        items = [...items, ...newItems];
        liveTopUpCount = newItems.length;
      }

      sections.push({
        key: config.key,
        title: config.title,
        categoryKey: config.categoryKey,      // CANONICAL key
        parentTab: config.parentTab,
        subtabKey: config.subtabKey,
        items: items.slice(0, HOME_PAGE_SIZE),
        hasMore: items.length >= HOME_PAGE_SIZE,
        dbCount: items.length - liveTopUpCount,
        liveTopUpCount,
        see_all: {
          type: "search",
          q: config.seeAllQuery,
          category_key: config.categoryKey,
        },
      });
    }

    const durationMs = Date.now() - startTime;
    console.log(`[HOME] requestId=${requestId} sections=${sections.length} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        sections,
        tabs,
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[HOME] requestId=${requestId} error:`, errorMessage);

    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        sections: [],
        tabs: [],
        error: { message: "Internal error", code: "INTERNAL_ERROR" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
