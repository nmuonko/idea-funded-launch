/**
 * Catalog Search Endpoint - Unified Search with eBay LIVE + Amazon Cached
 * 
 * GET /catalog-search?q=iphone&page=1&pageSize=20&provider=all
 * 
 * Search Strategy:
 * - eBay: LIVE search with unlimited pagination (primary)
 * - Amazon/Rainforest: DB-first only (cached, restricted)
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { searchEbay, CatalogItem as EbayCatalogItem, EbaySearchDebug } from "../_shared/ebayAdapter.ts";
import { getDeviceId } from "../_shared/catalogCache.ts";
import { 
  filterDisallowedItems, 
  isBlockedSearchQuery, 
  getBlockedSearchMessage,
} from "../_shared/contentBlocker.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=60",
};

// ==================== TYPES ====================

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  currency: string;
  imageUrl: string | null;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  condition?: string;
  shippingPriceUsd?: number | null;
  location?: string;
  buyingOptions?: string[];
  category?: string;
  subcategory?: string;
}

// ==================== QUERY HELPERS ====================

// Vehicle-related keywords that should route to eBay live with vehicle filters
const VEHICLE_QUERY_KEYWORDS = [
  "car", "cars", "truck", "trucks", "suv", "sedan", "pickup",
  "toyota", "honda", "jeep", "bmw", "mercedes", "ford", "chevy", "chevrolet",
  "nissan", "kia", "hyundai", "lexus", "audi", "tesla", "mazda", "subaru",
  "motorcycle", "harley", "yamaha", "kawasaki", "ducati",
  "boat", "pontoon", "yacht", "rv", "camper", "trailer",
  "atv", "utv", "quad", "polaris", "can-am",
];

function isVehicleQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return VEHICLE_QUERY_KEYWORDS.some(kw => lower.includes(kw));
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function mapDbItemToResponse(item: any): CatalogItem {
  return {
    id: item.id,
    provider: item.provider || "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    currency: "USD",
    imageUrl: item.image_url,
    images: item.images || [],
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    category: item.unified_category,
    subcategory: item.unified_subcategory,
    buyingOptions: item.buying_options,
  };
}

function mapEbayItemToResponse(item: EbayCatalogItem): CatalogItem {
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.providerProductId,
    title: item.title,
    priceUsd: item.priceUsd,
    currency: item.currency || "USD",
    imageUrl: item.imageUrl,
    images: item.images || [],
    productUrl: item.productUrl,
    inStock: item.inStock,
    rating: item.rating,
  };
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const rawQuery = url.searchParams.get("q") || "";
  const qOriginal = rawQuery.trim();
  const qNorm = normalizeQuery(rawQuery);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const provider = url.searchParams.get("provider") || "all"; // all, ebay, amazon
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);
  const deviceId = getDeviceId(req);

  console.log("[CATALOG_SEARCH]", { 
    q: qOriginal, 
    page, 
    pageSize,
    provider,
    env: envName,
    deviceId: deviceId?.slice(0, 8),
  });

  // Empty query
  if (!qNorm) {
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: "",
      page,
      pageSize,
      total: 0,
      items: [],
      source: "empty",
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // HARD BLOCK: Check if query targets blocked content (books, subscriptions, etc.)
  if (isBlockedSearchQuery(qOriginal)) {
    console.log(`[CATALOG_SEARCH] Blocked query: "${qOriginal}"`);
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: qOriginal,
      page,
      pageSize,
      total: 0,
      items: [],
      source: "blocked",
      message: getBlockedSearchMessage(lang),
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        query: qOriginal,
        page,
        pageSize,
        total: 0,
        items: [],
        error: { code: "CONFIG_ERROR", message: "Backend unavailable" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Catalog is always enabled - skip environment check for search
    console.log(`[CATALOG_SEARCH] env=${envName} catalog=always_enabled`);

    let resultItems: CatalogItem[] = [];
    let ebayTotal = 0;
    let amazonTotal = 0;
    let ebayDebug: EbaySearchDebug | null = null;
    let sources: string[] = [];

    // ==================== EBAY LIVE SEARCH (unlimited pagination) ====================
    if (provider === "all" || provider === "ebay") {
      try {
        // For vehicle queries, use FIXED_PRICE filter (no auctions)
        const isVehicle = isVehicleQuery(qNorm);
        const customFilter = isVehicle 
          ? "buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}"
          : undefined;
        
        console.log(`[CATALOG_SEARCH] eBay LIVE search: "${qNorm}" page=${page} isVehicle=${isVehicle}`);
        const ebayResult = await searchEbay(supabase, qNorm, page, pageSize, { 
          marketplace: "EBAY_US",
          filter: customFilter,
        });
        ebayDebug = ebayResult.debug;
        
        if (ebayResult.items.length > 0) {
          const ebayMapped = ebayResult.items.map(mapEbayItemToResponse);
          resultItems.push(...ebayMapped);
          ebayTotal = ebayResult.total;
          sources.push("ebay_live");
          
          console.log(`[CATALOG_SEARCH] eBay returned ${ebayResult.items.length} items, total=${ebayTotal}`);
          
          // Upsert to catalog_items for caching (async, don't wait)
          const toUpsert = ebayResult.items.map((item: EbayCatalogItem) => {
            const { category, subcategory } = mapCategoryAndSubcategory({
              title: item.title,
              provider: "ebay",
              productUrl: item.productUrl,
            });
            
            return {
              id: item.id,
              provider: "ebay",
              provider_product_id: item.providerProductId,
              title: item.title,
              price_usd: item.priceUsd,
              image_url: item.imageUrl,
              images: item.images || [],
              product_url: item.productUrl,
              in_stock: item.inStock,
              rating: item.rating,
              unified_category: category !== "blocked" ? category : "electronics",
              unified_subcategory: subcategory,
              tags: [qNorm],
              updated_at: new Date().toISOString(),
            };
          });
          
          // Fire and forget - don't await
          supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
        }
      } catch (err) {
        console.error("[CATALOG_SEARCH] eBay search error:", err);
        ebayDebug = {
          enabled: true,
          tokenOk: false,
          itemCount: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    // ==================== AMAZON DB-FIRST SEARCH (no live calls) ====================
    if (provider === "all" || provider === "amazon") {
      try {
        console.log(`[CATALOG_SEARCH] Amazon DB search: "${qNorm}"`);
        
        // Search from catalog_items where provider is rainforest/amazon
        const { data: amazonItems, count } = await supabase
          .from("catalog_items")
          .select("*", { count: "exact" })
          .or(`provider.eq.rainforest,provider.eq.amazon`)
          .or(`title.ilike.%${qNorm}%,search_text.ilike.%${qNorm}%`)
          .order("rating", { ascending: false, nullsFirst: false })
          .range((page - 1) * pageSize, page * pageSize - 1);
        
        if (amazonItems && amazonItems.length > 0) {
          const mapped = amazonItems.map(mapDbItemToResponse);
          
          // Merge with eBay results, avoiding duplicates
          const existingIds = new Set(resultItems.map(i => i.providerProductId));
          const newItems = mapped.filter(i => !existingIds.has(i.providerProductId));
          
          resultItems.push(...newItems);
          amazonTotal = count || amazonItems.length;
          sources.push("amazon_db");
          
          console.log(`[CATALOG_SEARCH] Amazon DB returned ${amazonItems.length} items`);
        }
      } catch (err) {
        console.error("[CATALOG_SEARCH] Amazon DB search error:", err);
      }
    }

    // ==================== FILTER DISALLOWED CONTENT ====================
    const beforeFilter = resultItems.length;
    const { allowed: filteredItems, removed: removedCount } = filterDisallowedItems(
      resultItems.map(item => ({
        ...item,
        title: item.title,
        productUrl: item.productUrl,
        category: item.category,
      })),
      "[CATALOG_SEARCH_FILTER]"
    );
    
    const allowedIds = new Set(filteredItems.map(i => i.id));
    const finalItems = resultItems.filter(item => allowedIds.has(item.id));

    if (removedCount > 0) {
      console.log(`[CATALOG_SEARCH] Filtered: before=${beforeFilter}, removed=${removedCount}, after=${finalItems.length}`);
    }

    // Sort: eBay first by default (unless amazonFirst param)
    const amazonFirst = url.searchParams.get("amazonFirst") === "true";
    const sortedItems = finalItems.sort((a, b) => {
      if (amazonFirst) {
        if (a.provider.includes("amazon") || a.provider === "rainforest") return -1;
        if (b.provider.includes("amazon") || b.provider === "rainforest") return 1;
      } else {
        if (a.provider === "ebay") return -1;
        if (b.provider === "ebay") return 1;
      }
      return 0;
    });

    const durationMs = Date.now() - startTime;
    console.log(`[CATALOG_SEARCH] Done: ${sortedItems.length} items, sources=${sources.join(",")}, durationMs=${durationMs}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: qOriginal,
      page,
      pageSize,
      total: Math.max(ebayTotal, amazonTotal, sortedItems.length),
      items: sortedItems.slice(0, pageSize),
      sources,
      ebayTotal,
      amazonTotal,
      removedDisallowedCount: removedCount,
      providerDebug: ebayDebug ? { ebay: ebayDebug } : undefined,
      durationMs,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_SEARCH] Error:", errorMessage);
    
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      query: qOriginal,
      page,
      pageSize,
      total: 0,
      items: [],
      error: { code: "INTERNAL_ERROR", message: "Search service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
