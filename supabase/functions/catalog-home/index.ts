/**
 * Catalog Home Endpoint - DB-First with Category Tabs
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
 * DB-First: All data served from catalog_items/catalog_collection_cache.
 * Live eBay calls only in staging or when cache is empty.
 * Amazon/Rainforest stays restricted and heavily cached.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled, EnvironmentName } from "../_shared/environmentResolver.ts";
import { filterDisallowedItems, isDisallowedItem } from "../_shared/contentBlocker.ts";

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
  categoryKey: string | null;
}

interface Section {
  key: string;
  title: string;
  provider: string;
  items: CatalogItem[];
  hasMore: boolean;
}

interface CategoryTab {
  key: string;
  title: string;
  groupTitle: string;
  icon: string | null;
  providers: string[];
  order: number;
}

// ─── Home Sections Configuration ─────────────────────────────────────────────
// Define which collections to show on homepage

const HOME_SECTIONS: Array<{
  key: string;
  title: string;
  provider: string;
  categoryKey: string;
  isVehicle?: boolean;
  maxItems: number;
  ttlSeconds: number;
}> = [
  {
    key: "ebay_trending_all",
    title: "Trending",
    provider: "ebay",
    categoryKey: "electronics",
    maxItems: 10,
    ttlSeconds: 2700, // 45 min
  },
  {
    key: "phones_trending",
    title: "Phones",
    provider: "ebay",
    categoryKey: "electronics",
    maxItems: 10,
    ttlSeconds: 5400, // 1.5 hours
  },
  {
    key: "electronics_trending",
    title: "Electronics",
    provider: "ebay",
    categoryKey: "electronics",
    maxItems: 10,
    ttlSeconds: 7200, // 2 hours
  },
  {
    key: "vehicles_trending",
    title: "Vehicles",
    provider: "ebay",
    categoryKey: "motors",
    isVehicle: true,
    maxItems: 10,
    ttlSeconds: 2700, // 45 min
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

// ─── Debug Logging ───────────────────────────────────────────────────────────

function debugLog(marker: string, data: Record<string, any>): void {
  console.log(`[${marker}]`, JSON.stringify(data));
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

function mapDbItemToResponse(item: any): CatalogItem {
  return {
    id: item.id,
    provider: item.provider || "ebay",
    providerProductId: item.provider_product_id || item.id.replace(/^ebay:/, ""),
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: item.image_url,
    images: Array.isArray(item.images) ? item.images : [],
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    categoryKey: item.category_key,
  };
}

async function getSectionFromCache(
  supabase: any,
  sectionKey: string,
  provider: string,
  maxItems: number
): Promise<{ items: CatalogItem[]; hit: boolean }> {
  // Try multiple cache key sizes (10 and 20 are common)
  const cacheKeySizes = [maxItems, 10, 20];
  
  for (const size of cacheKeySizes) {
    const cacheKey = `${provider}:${sectionKey}:1:${size}`;
    
    const { data: cache } = await supabase
      .from("catalog_collection_cache")
      .select("item_ids, updated_at, ttl_seconds")
      .eq("key", cacheKey)
      .maybeSingle();

    if (!cache) continue;

    // Check if cache is expired
    const updatedAt = new Date(cache.updated_at).getTime();
    const expiresAt = updatedAt + ((cache.ttl_seconds || 3600) * 1000);
    if (Date.now() > expiresAt) continue;

    const itemIds = cache.item_ids || [];
    if (itemIds.length === 0) {
      return { items: [], hit: true };
    }

    const { data: itemRows } = await supabase
      .from("catalog_items")
      .select("id, provider, provider_product_id, title, price_usd, image_url, images, product_url, in_stock, rating, category_key")
      .in("id", itemIds.slice(0, maxItems));

    return {
      items: (itemRows || []).map(mapDbItemToResponse),
      hit: true,
    };
  }
  
  return { items: [], hit: false };
}

async function getSectionFromDB(
  supabase: any,
  provider: string,
  categoryKey: string,
  maxItems: number,
  isVehicle: boolean = false
): Promise<CatalogItem[]> {
  let query = supabase
    .from("catalog_items")
    .select("id, provider, provider_product_id, title, price_usd, image_url, images, product_url, in_stock, rating, category_key")
    .or("is_disallowed.is.null,is_disallowed.eq.false")
    .eq("provider", provider);

  if (categoryKey) {
    query = query.eq("category_key", categoryKey);
  }

  if (isVehicle) {
    query = query.gte("price_usd", VEHICLE_MIN_PRICE_USD);
  }

  const { data: rows } = await query
    .order("updated_at", { ascending: false })
    .limit(maxItems + 10); // Fetch extra for filtering

  return (rows || []).map(mapDbItemToResponse);
}

async function getCategories(supabase: any): Promise<CategoryTab[]> {
  const { data: rows, error } = await supabase
    .from("catalog_categories")
    .select("slug, title, group_title, icon, priority, provider_scope, queries")
    .eq("enabled", true)
    .order("priority", { ascending: true });

  if (error || !rows) {
    console.error("[CATALOG_HOME] Failed to fetch categories:", error);
    return [];
  }

  return rows.map((row: any) => {
    let providers: string[] = [];
    if (row.provider_scope === "all") {
      providers = ["ebay", "rainforest"];
    } else if (row.provider_scope === "ebay") {
      providers = ["ebay"];
    } else if (row.provider_scope === "rainforest") {
      providers = ["rainforest"];
    } else {
      const queries = row.queries || {};
      if (queries.ebay?.enabled !== false) providers.push("ebay");
      if (queries.rainforest?.enabled !== false) providers.push("rainforest");
    }

    return {
      key: row.slug,
      title: row.title,
      groupTitle: row.group_title,
      icon: row.icon,
      providers,
      order: row.priority,
    };
  });
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

    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} catalog_disabled`);
      return new Response(JSON.stringify(buildResponse("error", [], [], { message: "Catalog not enabled", code: "CATALOG_DISABLED" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch categories for the tab list
    const homeCategories = await getCategories(supabase);

    // Build sections for home screen
    const sections: Section[] = [];
    const sectionCounts: Record<string, number> = {};

    for (const sectionConfig of HOME_SECTIONS) {
      // Try cache first
      const cached = await getSectionFromCache(
        supabase,
        sectionConfig.key,
        sectionConfig.provider,
        sectionConfig.maxItems
      );

      let items: CatalogItem[];
      if (cached.hit && cached.items.length > 0) {
        items = cached.items;
      } else {
        // Fallback to DB query
        items = await getSectionFromDB(
          supabase,
          sectionConfig.provider,
          sectionConfig.categoryKey,
          sectionConfig.maxItems,
          sectionConfig.isVehicle
        );
      }

      // Filter blocked items
      const filteredItems = items
        .filter(item => !isBlockedItem(item, sectionConfig.isVehicle))
        .slice(0, sectionConfig.maxItems);

      sections.push({
        key: sectionConfig.key,
        title: sectionConfig.title,
        provider: sectionConfig.provider,
        items: filteredItems,
        hasMore: items.length > sectionConfig.maxItems,
      });

      sectionCounts[sectionConfig.key] = filteredItems.length;
    }

    const durationMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} sectionKeys=${Object.keys(sectionCounts).join(",")} counts=${JSON.stringify(sectionCounts)} durationMs=${durationMs}`);

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
