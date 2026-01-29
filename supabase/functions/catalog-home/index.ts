/**
 * Catalog Home Endpoint - DB-First with Unified Categories
 * 
 * Returns sections-based structure for homepage + category list:
 * {
 *   status: "success",
 *   env,
 *   sections: [...],
 *   homeCategories: [...],
 *   homeDefaultCategoryKey: "electronics",
 *   error: null
 * }
 * 
 * DB-First: All data served from catalog_items using unified_category.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { TABS } from "../_shared/categoryMapper.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=60",
};

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ─── Types ───────────────────────────────────────────────────────────────────

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
}

interface Section {
  key: string;
  title: string;
  unifiedCategory: string;
  items: CatalogItem[];
  hasMore: boolean;
}

interface CategoryTab {
  key: string;
  title: string;
  icon: string | null;
  order: number;
}

// ─── Home Sections Configuration ─────────────────────────────────────────────

const HOME_SECTIONS: Array<{
  key: string;
  title: string;
  unifiedCategory: string;
  keywordFilter?: string[];
  isVehicle?: boolean;
  maxItems: number;
}> = [
  {
    key: "trending",
    title: "Trending",
    unifiedCategory: "electronics",
    maxItems: 20,
  },
  {
    key: "phones",
    title: "Phones",
    unifiedCategory: "electronics",
    keywordFilter: ["iphone", "samsung", "phone", "pixel", "galaxy", "smartphone"],
    maxItems: 20,
  },
  {
    key: "motors",
    title: "Vehicles",
    unifiedCategory: "motors",
    isVehicle: true,
    maxItems: 20,
  },
  {
    key: "clothing",
    title: "Clothing",
    unifiedCategory: "clothing",
    maxItems: 20,
  },
  {
    key: "home_garden",
    title: "Home & Garden",
    unifiedCategory: "home_garden",
    maxItems: 20,
  },
  {
    key: "jewelry_watches",
    title: "Jewelry & Watches",
    unifiedCategory: "jewelry_watches",
    maxItems: 20,
  },
];

// ─── Content Blocking ────────────────────────────────────────────────────────

const GLOBAL_DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "audiobook",
  "textbook", "novel", "comics", "journal", "membership", "streaming",
  "unlimited", "prime membership",
];

const VEHICLE_DENY_KEYWORDS = [
  "floor mat", "car mat", "wheels", "tire", "rim", "seat cover",
  "car cover", "snow chains", "accessory", "accessories", "parts",
  "replacement", "tool", "charger", "adapter", "brake pad", "oil filter",
  "wiper", "bulb", "led light", "dash cam", "phone mount", "key fob",
];

const VEHICLE_MIN_PRICE_USD = 1500;

function isBlockedItem(item: CatalogItem, isVehicle: boolean = false): boolean {
  const title = (item.title || "").toLowerCase();
  
  // Global blocks
  for (const keyword of GLOBAL_DENY_KEYWORDS) {
    if (keyword.length <= 5) {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(title)) return true;
    } else {
      if (title.includes(keyword)) return true;
    }
  }
  
  // Vehicle-specific blocks
  if (isVehicle) {
    for (const keyword of VEHICLE_DENY_KEYWORDS) {
      if (title.includes(keyword)) return true;
    }
    // Must be expensive enough to be a real vehicle
    if (item.priceUsd !== null && item.priceUsd < VEHICLE_MIN_PRICE_USD) {
      return true;
    }
  }
  
  return false;
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

function mapDbItemToResponse(item: any): CatalogItem {
  let images: string[] = [];
  if (Array.isArray(item.images)) {
    images = item.images.filter((img: any): img is string => typeof img === "string");
  }

  return {
    id: item.id,
    provider: item.provider || "unknown",
    providerProductId: item.provider_product_id || item.id.replace(/^(ebay|rainforest):/, ""),
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: item.image_url || (images.length > 0 ? images[0] : null),
    images,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: item.unified_category || item.category_key,
  };
}

async function getSectionFromDB(
  supabase: any,
  unifiedCategory: string,
  maxItems: number,
  keywordFilter?: string[],
  isVehicle: boolean = false
): Promise<CatalogItem[]> {
  // Query by unified_category
  let query = supabase
    .from("catalog_items")
    .select("id, provider, provider_product_id, title, price_usd, image_url, images, product_url, in_stock, rating, unified_category, category_key")
    .eq("unified_category", unifiedCategory)
    .or("is_disallowed.is.null,is_disallowed.eq.false");

  if (isVehicle) {
    query = query.gte("price_usd", VEHICLE_MIN_PRICE_USD);
  }

  const { data: rows, error } = await query
    .order("updated_at", { ascending: false })
    .limit(maxItems + 30); // Fetch extra for filtering

  if (error) {
    console.error(`[HOME_DB] Query error for ${unifiedCategory}:`, error.message);
    return [];
  }

  let items = (rows || []).map(mapDbItemToResponse);

  // Apply keyword filter if specified
  if (keywordFilter && keywordFilter.length > 0) {
    items = items.filter(item => {
      const title = (item.title || "").toLowerCase();
      return keywordFilter.some(kw => title.includes(kw.toLowerCase()));
    });
  }

  return items;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
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

  // Validate environment
  if (!ALLOWED_ENVS.includes(envName)) {
    console.error(`[CATALOG_HOME_API] requestId=${requestId} error=BAD_ENV env=${envName}`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        sections: [],
        homeCategories: [],
        homeDefaultCategoryKey: "electronics",
        sectionCount: 0,
        itemCount: 0,
        source: "db-first",
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
        durationMs: Date.now() - startTime,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} method=${req.method} url=${url.pathname}`);

  const buildResponse = (
    status: "success" | "error",
    sections: Section[],
    homeCategories: CategoryTab[],
    error: { message: string; code: string } | null
  ) => ({
    status,
    env: envName,
    sections,
    homeCategories,
    homeDefaultCategoryKey: "electronics",
    sectionCount: sections.length,
    itemCount: sections.reduce((sum, s) => sum + s.items.length, 0),
    source: "db-first",
    error,
    durationMs: Date.now() - startTime,
  });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.error(`[CATALOG_HOME_API] requestId=${requestId} error=MISSING_CONFIG`);
      return new Response(JSON.stringify(buildResponse("error", [], [], { message: "Backend configuration error", code: "CONFIG_ERROR" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Catalog is ALWAYS enabled - no environment check needed
    console.log(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} catalog_always_enabled=true`);

    // Return fixed category tabs from categoryMapper (single source of truth)
    const homeCategories: CategoryTab[] = TABS.map((tab, index) => ({
      key: tab.key,
      title: tab.title,
      icon: tab.icon || null,
      order: index + 1,
    }));

    // Build sections for home screen from DB
    const sections: Section[] = [];
    const sectionCounts: Record<string, number> = {};

    for (const sectionConfig of HOME_SECTIONS) {
      const items = await getSectionFromDB(
        supabase,
        sectionConfig.unifiedCategory,
        sectionConfig.maxItems,
        sectionConfig.keywordFilter,
        sectionConfig.isVehicle
      );

      // Filter blocked items
      const filteredItems = items
        .filter(item => !isBlockedItem(item, sectionConfig.isVehicle))
        .slice(0, sectionConfig.maxItems);

      sections.push({
        key: sectionConfig.key,
        title: sectionConfig.title,
        unifiedCategory: sectionConfig.unifiedCategory,
        items: filteredItems,
        hasMore: items.length > sectionConfig.maxItems,
      });

      sectionCounts[sectionConfig.key] = filteredItems.length;
    }

    const durationMs = Date.now() - startTime;
    
    // Detailed logging
    console.log(`[HOME_DB] requestId=${requestId} counts=${JSON.stringify(sectionCounts)}`);
    console.log(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} totalItems=${sections.reduce((s,x)=>s+x.items.length,0)} durationMs=${durationMs}`);

    return new Response(JSON.stringify(buildResponse("success", sections, homeCategories, null)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const errorStack = err instanceof Error ? err.stack : undefined;
    const durationMs = Date.now() - startTime;
    
    console.error(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);
    if (errorStack) {
      console.error(`[CATALOG_HOME_API] requestId=${requestId} stack=${errorStack}`);
    }
    
    return new Response(JSON.stringify(buildResponse("error", [], [], { message: "Catalog service error", code: "INTERNAL_ERROR" })), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
