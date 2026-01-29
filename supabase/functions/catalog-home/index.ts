/**
 * Catalog Home Endpoint - DB-First with eBay Live Top-Up
 * 
 * Returns sections for homepage using DB-driven nav config:
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
import { isAllowedMotorListing, getMinPriceForVehicleSubkey } from "../_shared/motorsFilter.ts";

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
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  unifiedCategory: string | null;
  unifiedSubcategory: string | null;
}

interface Section {
  key: string;
  title: string;
  categoryKey: string;
  subtabKey: string | null;
  items: CatalogItem[];
  hasMore: boolean;
  dbCount: number;
  liveTopUpCount: number;
}

interface HomeSectionConfig {
  key: string;
  title: string;
  categoryKey: string;
  subtabKey: string | null;
  isVehicle: boolean;
  minPrice: number;
  seedQueries: string[];
  ebayCategory?: string;
}

// Home sections optimized for DRC market
const HOME_SECTIONS: HomeSectionConfig[] = [
  {
    key: "phones",
    title: "Phones",
    categoryKey: "electronics",
    subtabKey: "phones",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["iphone 15", "samsung galaxy", "tecno camon", "infinix hot", "google pixel"],
    ebayCategory: "9355",
  },
  {
    key: "vehicles",
    title: "Vehicles",
    categoryKey: "vehicles",
    subtabKey: "cars_trucks",
    isVehicle: true,
    minPrice: 1500,
    seedQueries: ["used car for sale", "toyota camry", "honda accord", "ford f150"],
    ebayCategory: "6001",
  },
  {
    key: "gaming",
    title: "Gaming",
    categoryKey: "electronics",
    subtabKey: "gaming",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["ps5 console", "xbox series x", "nintendo switch", "gaming laptop"],
    ebayCategory: "1249",
  },
  {
    key: "clothing",
    title: "Clothing & Shoes",
    categoryKey: "clothing_shoes_accessories",
    subtabKey: null,
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["men sneakers", "women sneakers", "hoodie", "jacket", "handbag"],
    ebayCategory: "63889",
  },
  {
    key: "home_garden",
    title: "Home & Garden",
    categoryKey: "home_garden",
    subtabKey: null,
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["cordless vacuum", "air fryer", "blender", "power tools"],
    ebayCategory: "11700",
  },
];

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function mapDbItemToResponse(item: Record<string, unknown>): CatalogItem {
  let images: string[] = [];
  if (Array.isArray(item.images)) {
    images = item.images.filter((img): img is string => typeof img === "string");
  }

  return {
    id: item.id as string,
    provider: (item.provider as string) || "unknown",
    providerProductId: (item.provider_product_id as string) || (item.id as string),
    title: item.title as string | null,
    priceUsd: item.price_usd as number | null,
    imageUrl: (item.image_url as string) || (images.length > 0 ? images[0] : null),
    images,
    productUrl: item.product_url as string | null,
    inStock: item.in_stock as boolean | null,
    rating: item.rating as number | null,
    unifiedCategory: (item.unified_category as string) || null,
    unifiedSubcategory: (item.unified_subcategory as string) || null,
  };
}

function mapEbayItemToResponse(item: NormalizedItem): CatalogItem {
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: item.image_url,
    images: item.images,
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
    .eq("unified_category", config.categoryKey)
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
      unified_category: config.categoryKey,
      unified_subcategory: config.subtabKey,
      vehicles_subkey: config.isVehicle ? config.subtabKey : null,
      updated_at: new Date().toISOString(),
    }));

    await supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
  }

  return allItems;
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

    // Fetch tabs from nav tables
    const { data: tabs } = await supabase
      .from("catalog_nav_tabs")
      .select("key, title_en, title_fr, icon, order_index")
      .eq("enabled", true)
      .order("order_index", { ascending: true });

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
        categoryKey: config.categoryKey,
        subtabKey: config.subtabKey,
        items: items.slice(0, HOME_PAGE_SIZE),
        hasMore: items.length >= HOME_PAGE_SIZE,
        dbCount: items.length - liveTopUpCount,
        liveTopUpCount,
      });
    }

    const durationMs = Date.now() - startTime;
    console.log(`[HOME] requestId=${requestId} sections=${sections.length} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        sections,
        tabs: tabs || [],
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
