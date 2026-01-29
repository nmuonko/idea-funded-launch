/**
 * Catalog Home Endpoint - eBay LIVE for all sections
 * 
 * Returns sections for homepage using eBay LIVE calls:
 * {
 *   status: "success",
 *   env,
 *   sections: [...],
 *   tabs: [...],
 *   error: null
 * }
 * 
 * ALL sections use eBay LIVE for broad, fresh inventory.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=60",
};

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
  total: number;
  isLive: boolean;
}

interface HomeSectionConfig {
  key: string;
  title: string;
  categoryKey: string;
  subtabKey: string | null;
  ebayCategory: string;
  isVehicle: boolean;
  minPrice: number;
}

// Home sections - ALL use eBay LIVE with proper category IDs
const HOME_SECTIONS: HomeSectionConfig[] = [
  {
    key: "phones",
    title: "Phones",
    categoryKey: "electronics",
    subtabKey: "phones",
    ebayCategory: "9355", // Cell Phones & Smartphones
    isVehicle: false,
    minPrice: 0,
  },
  {
    key: "vehicles",
    title: "Vehicles",
    categoryKey: "vehicles",
    subtabKey: "cars_trucks",
    ebayCategory: "6001", // Cars & Trucks
    isVehicle: true,
    minPrice: 1500,
  },
  {
    key: "gaming",
    title: "Gaming",
    categoryKey: "electronics",
    subtabKey: "gaming",
    ebayCategory: "1249", // Video Games & Consoles
    isVehicle: false,
    minPrice: 0,
  },
  {
    key: "clothing",
    title: "Clothing & Shoes",
    categoryKey: "clothing_shoes_accessories",
    subtabKey: null,
    ebayCategory: "11450", // Clothing, Shoes & Accessories
    isVehicle: false,
    minPrice: 0,
  },
  {
    key: "home_garden",
    title: "Home & Garden",
    categoryKey: "home_garden",
    subtabKey: null,
    ebayCategory: "11700", // Home & Garden
    isVehicle: false,
    minPrice: 0,
  },
];

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function mapEbayItemToResponse(item: NormalizedItem, category: string, subcategory: string | null): CatalogItem {
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
    unifiedCategory: category,
    unifiedSubcategory: subcategory,
  };
}

async function fetchSectionLive(
  supabase: any,
  config: HomeSectionConfig,
  requestId: string
): Promise<{ items: CatalogItem[]; total: number; hasMore: boolean }> {
  console.log(`[HOME_LIVE] requestId=${requestId} section=${config.key} ebayCategory=${config.ebayCategory}`);

  try {
    const result = await searchEbay(
      supabase,
      {
        categoryId: config.ebayCategory,
        page: 1,
        pageSize: HOME_PAGE_SIZE,
        minPrice: config.minPrice > 0 ? config.minPrice : undefined,
        isVehicle: config.isVehicle,
        marketplaceId: "EBAY_US",
      },
      requestId
    );

    let items = result.items;

    // Apply content filter
    items = items.filter(item => {
      const blocked = isDisallowedItem({ title: item.title, productUrl: item.product_url });
      return !blocked.isDisallowed;
    });

    // Vehicle-specific filtering
    if (config.isVehicle) {
      items = items.filter(item => {
        const filterResult = isAllowedMotorListing({ title: item.title, priceUsd: item.price_usd });
        return filterResult.isAllowed;
      });
    }

    const mappedItems = items.map(item => 
      mapEbayItemToResponse(item, config.categoryKey, config.subtabKey)
    );

    // Upsert to DB for caching (fire and forget)
    const toUpsert = items.map(item => ({
      id: item.id,
      provider: item.provider,
      provider_product_id: item.provider_product_id,
      title: item.title,
      price_usd: item.price_usd,
      image_url: item.image_url,
      images: item.images,
      product_url: item.product_url,
      in_stock: item.in_stock,
      rating: item.rating,
      unified_category: config.categoryKey,
      unified_subcategory: config.subtabKey,
      vehicles_subkey: config.isVehicle ? config.subtabKey : null,
      updated_at: new Date().toISOString(),
    }));

    if (toUpsert.length > 0) {
      supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
    }

    console.log(`[HOME_LIVE] requestId=${requestId} section=${config.key} returned=${mappedItems.length} total=${result.total}`);

    return {
      items: mappedItems.slice(0, HOME_PAGE_SIZE),
      total: result.total,
      hasMore: result.hasMore,
    };
  } catch (err) {
    console.error(`[HOME_LIVE] requestId=${requestId} section=${config.key} error:`, err);
    return { items: [], total: 0, hasMore: false };
  }
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

    // Build sections using eBay LIVE for ALL categories
    const sections: Section[] = [];

    for (const config of HOME_SECTIONS) {
      const { items, total, hasMore } = await fetchSectionLive(supabase, config, requestId);

      sections.push({
        key: config.key,
        title: config.title,
        categoryKey: config.categoryKey,
        subtabKey: config.subtabKey,
        items,
        hasMore,
        total,
        isLive: true,
      });
    }

    const durationMs = Date.now() - startTime;
    const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
    console.log(`[HOME] requestId=${requestId} sections=${sections.length} totalItems=${totalItems} durationMs=${durationMs}`);

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
