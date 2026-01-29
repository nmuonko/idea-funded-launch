/**
 * Catalog Search Endpoint - eBay LIVE + Amazon Cached
 * 
 * GET /catalog-search?q=iphone&page=1&pageSize=20
 * 
 * - eBay: LIVE with infinite pagination (limit+offset)
 * - Amazon: DB-first only (cached, restricted)
 * 
 * ALWAYS returns HTTP 200 with stable JSON
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { isBlockedSearchQuery, getBlockedSearchMessage, filterDisallowedItems } from "../_shared/contentBlocker.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=60",
};

const VEHICLE_QUERY_KEYWORDS = [
  "car", "cars", "truck", "trucks", "suv", "sedan", "pickup",
  "toyota", "honda", "jeep", "bmw", "mercedes", "ford", "chevy", "chevrolet",
  "nissan", "kia", "hyundai", "lexus", "audi", "tesla", "mazda", "subaru",
  "motorcycle", "harley", "yamaha", "kawasaki", "ducati",
  "boat", "pontoon", "yacht", "rv", "camper", "trailer",
  "atv", "utv", "quad", "polaris", "can-am",
];

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
  category?: string;
  subcategory?: string;
}

function isVehicleQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return VEHICLE_QUERY_KEYWORDS.some(kw => lower.includes(kw));
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function mapEbayItemToResponse(item: NormalizedItem): CatalogItem {
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    currency: item.currency,
    imageUrl: item.image_url,
    images: item.images,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
  };
}

function mapDbItemToResponse(item: Record<string, unknown>): CatalogItem {
  return {
    id: item.id as string,
    provider: (item.provider as string) || "amazon",
    providerProductId: item.provider_product_id as string,
    title: item.title as string | null,
    priceUsd: item.price_usd as number | null,
    currency: "USD",
    imageUrl: item.image_url as string | null,
    images: (item.images as string[]) || [],
    productUrl: item.product_url as string | null,
    inStock: item.in_stock as boolean | null,
    rating: item.rating as number | null,
    category: item.unified_category as string | undefined,
    subcategory: item.unified_subcategory as string | undefined,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  const url = new URL(req.url);

  const rawQuery = url.searchParams.get("q") || "";
  const qOriginal = rawQuery.trim();
  const qNorm = qOriginal.toLowerCase().replace(/\s+/g, " ");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const provider = url.searchParams.get("provider") || "all";
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);

  console.log(`[SEARCH] requestId=${requestId} q="${qOriginal}" page=${page} pageSize=${pageSize} provider=${provider}`);

  // Empty query
  if (!qNorm) {
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: "",
      page,
      pageSize,
      total: 0,
      hasMore: false,
      nextOffset: null,
      items: [],
      sources: [],
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Blocked content check
  if (isBlockedSearchQuery(qOriginal)) {
    console.log(`[SEARCH] requestId=${requestId} BLOCKED query: "${qOriginal}"`);
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: qOriginal,
      page,
      pageSize,
      total: 0,
      hasMore: false,
      nextOffset: null,
      items: [],
      sources: ["blocked"],
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
        hasMore: false,
        nextOffset: null,
        items: [],
        error: { code: "CONFIG_ERROR", message: "Backend unavailable" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let resultItems: CatalogItem[] = [];
    let ebayTotal = 0;
    let amazonTotal = 0;
    let hasMore = false;
    let nextOffset: number | null = null;
    const sources: string[] = [];

    // ─── eBay LIVE Search ─────────────────────────────────────────────────────
    if (provider === "all" || provider === "ebay") {
      try {
        const isVehicle = isVehicleQuery(qNorm);
        const minPrice = isVehicle ? 1500 : undefined;

        console.log(`[SEARCH] requestId=${requestId} eBay LIVE: q="${qNorm}" isVehicle=${isVehicle}`);

        const ebayResult = await searchEbay(
          supabase,
          {
            query: qNorm,
            page,
            pageSize,
            minPrice,
            isVehicle,
            marketplaceId: "EBAY_US",
          },
          requestId
        );

        if (ebayResult.items.length > 0) {
          let ebayItems = ebayResult.items;

          // Filter vehicles
          if (isVehicle) {
            ebayItems = ebayItems.filter(item => {
              const result = isAllowedMotorListing({ title: item.title, priceUsd: item.price_usd });
              return result.isAllowed;
            });
          }

          const mapped = ebayItems.map(mapEbayItemToResponse);
          resultItems.push(...mapped);
          ebayTotal = ebayResult.total;
          hasMore = ebayResult.hasMore;
          nextOffset = ebayResult.nextOffset;
          sources.push("ebay_live");

          console.log(`[SEARCH] requestId=${requestId} eBay returned ${ebayItems.length} items, total=${ebayTotal}`);

          // Upsert to DB (async)
          const toUpsert = ebayItems.map(item => {
            const { category, subcategory } = mapCategoryAndSubcategory({
              title: item.title,
              provider: "ebay",
              productUrl: item.product_url,
            });

            return {
              id: item.id,
              provider: "ebay",
              provider_product_id: item.provider_product_id,
              title: item.title,
              price_usd: item.price_usd,
              image_url: item.image_url,
              images: item.images,
              product_url: item.product_url,
              in_stock: item.in_stock,
              rating: item.rating,
              unified_category: category !== "blocked" ? category : "electronics",
              unified_subcategory: subcategory,
              updated_at: new Date().toISOString(),
            };
          });

          supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
        }
      } catch (err) {
        console.error(`[SEARCH] requestId=${requestId} eBay error:`, err);
      }
    }

    // ─── Amazon DB Search (cached only) ───────────────────────────────────────
    if (provider === "all" || provider === "amazon") {
      try {
        console.log(`[SEARCH] requestId=${requestId} Amazon DB search: "${qNorm}"`);

        const { data: amazonItems, count } = await supabase
          .from("catalog_items")
          .select("*", { count: "exact" })
          .or("provider.eq.rainforest,provider.eq.amazon")
          .or(`title.ilike.%${qNorm}%,search_text.ilike.%${qNorm}%`)
          .order("rating", { ascending: false, nullsFirst: false })
          .range((page - 1) * pageSize, page * pageSize - 1);

        if (amazonItems && amazonItems.length > 0) {
          const mapped = amazonItems.map(item => mapDbItemToResponse(item as Record<string, unknown>));

          // Merge with eBay, avoiding duplicates
          const existingIds = new Set(resultItems.map(i => i.providerProductId));
          const newItems = mapped.filter(i => !existingIds.has(i.providerProductId));

          resultItems.push(...newItems);
          amazonTotal = count || amazonItems.length;
          sources.push("amazon_db");

          console.log(`[SEARCH] requestId=${requestId} Amazon DB returned ${amazonItems.length} items`);
        }
      } catch (err) {
        console.error(`[SEARCH] requestId=${requestId} Amazon DB error:`, err);
      }
    }

    // Filter disallowed content
    const { allowed: filteredItems, removed: removedCount } = filterDisallowedItems(
      resultItems.map(item => ({
        ...item,
        title: item.title,
        productUrl: item.productUrl,
        category: item.category,
      })),
      `[SEARCH] requestId=${requestId}`
    );

    const allowedIds = new Set(filteredItems.map(i => i.id));
    const finalItems = resultItems.filter(item => allowedIds.has(item.id));

    const durationMs = Date.now() - startTime;
    console.log(`[SEARCH] requestId=${requestId} Done: ${finalItems.length} items, sources=${sources.join(",")}, durationMs=${durationMs}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: qOriginal,
      page,
      pageSize,
      total: Math.max(ebayTotal, amazonTotal, finalItems.length),
      hasMore,
      nextOffset,
      items: finalItems.slice(0, pageSize),
      sources,
      ebayTotal,
      amazonTotal,
      removedDisallowedCount: removedCount,
      durationMs,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[SEARCH] requestId=${requestId} error:`, errorMessage);

    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      query: qOriginal,
      page,
      pageSize,
      total: 0,
      hasMore: false,
      nextOffset: null,
      items: [],
      error: { code: "INTERNAL_ERROR", message: "Search service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
