/**
 * Catalog Home Endpoint - DB-First with eBay Live Top-Up
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
 * If DB has < homeMinPerSection (12), top-up from eBay live.
 * Amazon/Rainforest is NEVER called here.
 * 
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { TABS, mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";
import { searchEbay, CatalogItem as EbayCatalogItem } from "../_shared/ebayAdapter.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { isAllowedMotorListing, MOTORS_SEED_QUERIES } from "../_shared/motorsFilter.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=60",
};

// ─── Configuration ───────────────────────────────────────────────────────────

const HOME_MIN_PER_SECTION = 12; // If DB has fewer, top-up from eBay
const HOME_PAGE_SIZE = 20;
const LIVE_CACHE_TTL_SECONDS = 300; // 5 minutes

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
  unifiedSubcategory: string | null;
}

interface Section {
  key: string;
  title: string;
  unifiedCategory: string;
  items: CatalogItem[];
  hasMore: boolean;
  dbCount: number;
  liveTopUpCount: number;
}

interface CategoryTab {
  key: string;
  title: string;
  icon: string | null;
  order: number;
}

// ─── Home Sections Configuration ─────────────────────────────────────────────

interface SectionConfig {
  key: string;
  title: string;
  unifiedCategory: string;
  keywordFilter?: string[];
  isVehicle?: boolean;
  maxItems: number;
  seedQueries: string[];
}

const HOME_SECTIONS: SectionConfig[] = [
  {
    key: "trending",
    title: "Trending",
    unifiedCategory: "electronics",
    maxItems: HOME_PAGE_SIZE,
    seedQueries: ["iphone", "samsung galaxy", "laptop", "headphones"],
  },
  {
    key: "phones",
    title: "Phones",
    unifiedCategory: "electronics",
    keywordFilter: ["iphone", "samsung", "phone", "pixel", "galaxy", "smartphone"],
    maxItems: HOME_PAGE_SIZE,
    seedQueries: ["iphone 15", "samsung phone unlocked", "android phone"],
  },
  {
    key: "motors",
    title: "Vehicles",
    unifiedCategory: "motors",
    isVehicle: true,
    maxItems: HOME_PAGE_SIZE,
    seedQueries: MOTORS_SEED_QUERIES.slice(0, 5), // Use first 5 motor seeds
  },
  {
    key: "clothing_shoes_accessories",
    title: "Clothing",
    unifiedCategory: "clothing_shoes_accessories",
    maxItems: HOME_PAGE_SIZE,
    seedQueries: ["nike hoodie", "adidas shoes", "mens jacket"],
  },
  {
    key: "home_garden",
    title: "Home & Garden",
    unifiedCategory: "home_garden",
    maxItems: HOME_PAGE_SIZE,
    seedQueries: ["vacuum cleaner", "air fryer", "power tools"],
  },
  {
    key: "jewelry_watches",
    title: "Jewelry & Watches",
    unifiedCategory: "jewelry_watches",
    maxItems: HOME_PAGE_SIZE,
    seedQueries: ["mens watch", "gold necklace", "diamond ring"],
  },
];

// ─── Content Blocking ────────────────────────────────────────────────────────

const GLOBAL_DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "audiobook",
  "textbook", "novel", "comics", "journal", "membership", "streaming",
  "unlimited", "prime membership",
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
  
  // Vehicle-specific: use motorsFilter
  if (isVehicle) {
    const result = isAllowedMotorListing({
      title: item.title || "",
      priceUsd: item.priceUsd,
    });
    return !result.isAllowed;
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
    unifiedSubcategory: item.unified_subcategory || null,
  };
}

function mapEbayItemToResponse(item: EbayCatalogItem): CatalogItem {
  return {
    id: item.id,
    provider: item.provider,
    providerProductId: item.providerProductId,
    title: item.title,
    priceUsd: item.priceUsd,
    imageUrl: item.imageUrl,
    images: item.images || [],
    productUrl: item.productUrl,
    inStock: item.inStock,
    rating: item.rating,
    unifiedCategory: null, // Will be set during upsert
    unifiedSubcategory: null,
  };
}

async function getSectionFromDB(
  supabase: any,
  unifiedCategory: string,
  maxItems: number,
  keywordFilter?: string[],
  isVehicle: boolean = false
): Promise<CatalogItem[]> {
  let query = supabase
    .from("catalog_items")
    .select("id, provider, provider_product_id, title, price_usd, image_url, images, product_url, in_stock, rating, unified_category, unified_subcategory, category_key")
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

// ─── eBay Live Top-Up ────────────────────────────────────────────────────────

async function fetchEbayLiveItems(
  supabase: any,
  sectionConfig: SectionConfig,
  neededCount: number,
  requestId: string
): Promise<CatalogItem[]> {
  console.log(`[HOME_EBAY_TOPUP] requestId=${requestId} section=${sectionConfig.key} neededCount=${neededCount}`);
  
  const allItems: CatalogItem[] = [];
  const seenIds = new Set<string>();
  
  // Limit queries to avoid excessive API calls
  const queriesToRun = sectionConfig.seedQueries.slice(0, 3);
  
  for (const query of queriesToRun) {
    if (allItems.length >= neededCount) break;
    
    try {
      // For motors, apply special filter
      const isMotors = sectionConfig.isVehicle === true;
      
      const result = await searchEbay(
        supabase,
        query,
        1, // page 1
        20, // limit
        {
          marketplace: "EBAY_US",
        }
      );
      
      if (result.items.length === 0) {
        console.log(`[HOME_EBAY_TOPUP] requestId=${requestId} query="${query}" returned 0 items`);
        continue;
      }
      
      // Process items
      for (const ebayItem of result.items) {
        if (seenIds.has(ebayItem.id)) continue;
        
        const item = mapEbayItemToResponse(ebayItem);
        
        // Apply content filter
        if (isDisallowedItem({ title: item.title, productUrl: item.productUrl }).isDisallowed) {
          continue;
        }
        
        // Apply motors filter
        if (isMotors && !isAllowedMotorListing({ title: item.title || "", priceUsd: item.priceUsd }).isAllowed) {
          continue;
        }
        
        // Map category
        const { category, subcategory } = mapCategoryAndSubcategory({
          title: item.title || "",
          provider: "ebay",
        });
        
        // Skip blocked categories
        if (category === "blocked") continue;
        
        // Force category to match section if mapper returns different
        item.unifiedCategory = sectionConfig.unifiedCategory;
        item.unifiedSubcategory = subcategory;
        
        seenIds.add(item.id);
        allItems.push(item);
      }
      
      console.log(`[HOME_EBAY_TOPUP] requestId=${requestId} query="${query}" found=${result.items.length} filtered=${allItems.length}`);
      
    } catch (err) {
      console.error(`[HOME_EBAY_TOPUP] requestId=${requestId} query="${query}" error:`, err);
    }
  }
  
  // Upsert to DB for future use
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
      unified_category: item.unifiedCategory,
      unified_subcategory: item.unifiedSubcategory,
      updated_at: new Date().toISOString(),
    }));
    
    const { error: upsertError } = await supabase
      .from("catalog_items")
      .upsert(toUpsert, { onConflict: "id" });
    
    if (upsertError) {
      console.error(`[HOME_EBAY_TOPUP] requestId=${requestId} upsert error:`, upsertError.message);
    } else {
      console.log(`[HOME_EBAY_TOPUP] requestId=${requestId} upserted ${toUpsert.length} items`);
    }
  }
  
  return allItems;
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
  const mode = url.searchParams.get("mode") || "auto"; // db | live | auto
  const pageSize = parseInt(url.searchParams.get("pageSize") || String(HOME_PAGE_SIZE), 10);
  
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

  console.log(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} mode=${mode} pageSize=${pageSize}`);

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

    console.log(`[CATALOG_HOME_API] requestId=${requestId} env=${envName} catalog_always_enabled=true`);

    // Return fixed category tabs from categoryMapper (single source of truth)
    const homeCategories: CategoryTab[] = TABS.map((tab, index) => ({
      key: tab.key,
      title: tab.title,
      icon: tab.icon || null,
      order: index + 1,
    }));

    // Build sections for home screen
    const sections: Section[] = [];
    const sectionCounts: Record<string, { db: number; live: number }> = {};

    for (const sectionConfig of HOME_SECTIONS) {
      // Step 1: Get from DB
      const dbItems = await getSectionFromDB(
        supabase,
        sectionConfig.unifiedCategory,
        sectionConfig.maxItems,
        sectionConfig.keywordFilter,
        sectionConfig.isVehicle
      );

      // Filter blocked items
      let filteredDbItems = dbItems
        .filter(item => !isBlockedItem(item, sectionConfig.isVehicle));

      const dbCount = filteredDbItems.length;
      let liveTopUpCount = 0;
      
      // Step 2: If DB has fewer than minimum AND mode allows live, fetch from eBay
      if (filteredDbItems.length < HOME_MIN_PER_SECTION && mode !== "db") {
        const neededCount = sectionConfig.maxItems - filteredDbItems.length;
        const liveItems = await fetchEbayLiveItems(
          supabase,
          sectionConfig,
          neededCount,
          requestId
        );
        
        // Merge, avoiding duplicates
        const existingIds = new Set(filteredDbItems.map(i => i.id));
        const newItems = liveItems.filter(i => !existingIds.has(i.id));
        filteredDbItems = [...filteredDbItems, ...newItems];
        liveTopUpCount = newItems.length;
      }

      // Slice to max items
      const finalItems = filteredDbItems.slice(0, sectionConfig.maxItems);

      sections.push({
        key: sectionConfig.key,
        title: sectionConfig.title,
        unifiedCategory: sectionConfig.unifiedCategory,
        items: finalItems,
        hasMore: filteredDbItems.length > sectionConfig.maxItems,
        dbCount,
        liveTopUpCount,
      });

      sectionCounts[sectionConfig.key] = { db: dbCount, live: liveTopUpCount };
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
