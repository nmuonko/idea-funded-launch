/**
 * Catalog Home Endpoint - DB-First Preloaded Catalog
 * Returns Tesla-style sections from preloaded catalog_items/catalog_collections
 * 
 * GET /catalog-home?page=1&pageSize=20&category=all
 * 
 * NO LIVE RAINFOREST CALLS - All data served from DB.
 * Data is refreshed by scheduled catalog-refresh function.
 * 
 * IMPORTANT: This endpoint MUST always return HTTP 200 with stable JSON shape.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { getDeviceId } from "../_shared/catalogCache.ts";
import { filterDisallowedItems, isDisallowedItem } from "../_shared/contentBlocker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=60",
};

const MAX_PAGE_SIZE = 40;
const DEFAULT_PAGE_SIZE = 20;

// Valid categories map to collection slugs
const CATEGORY_TO_COLLECTION: Record<string, string> = {
  all: "trending_electronics",
  phones: "phones",
  tablets: "tablets",
  computers: "computers",
  monitors: "monitors",
  audio: "audio",
  gaming: "gaming",
  accessories: "accessories",
  vehicles: "vehicles",
};

const VALID_CATEGORIES = Object.keys(CATEGORY_TO_COLLECTION);

interface CatalogItem {
  id: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  brand: string | null;
  category: string | null;
}

function mapDbItemToResponse(item: any): CatalogItem {
  return {
    id: item.id,
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: item.image_url,
    images: item.images || [],
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    reviewCount: item.review_count,
    brand: item.brand,
    category: item.category,
  };
}

/**
 * Filter items through content blocker
 */
function filterBlockedItems(items: CatalogItem[]): CatalogItem[] {
  const { allowed } = filterDisallowedItems(
    items.map(item => ({
      title: item.title,
      productUrl: item.productUrl,
      category: item.category,
    })),
    "[CATALOG_HOME_FILTER]"
  );
  
  // Map back to original items by index
  const allowedSet = new Set(allowed.map(a => a.title));
  return items.filter(item => {
    // Re-check each item individually to be safe
    const result = isDisallowedItem({
      title: item.title,
      productUrl: item.productUrl,
      category: item.category,
    });
    return !result.isDisallowed;
  });
}

interface Section {
  type: "section";
  title: string;
  slug: string;
  items: CatalogItem[];
  hasMore: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));
  const rawCategory = (url.searchParams.get("category") || "all").toLowerCase();
  const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : "all";
  const envName = getEnvironmentFromRequest(req);
  const deviceId = getDeviceId(req);
  
  // Tesla-style mode: return sections for home screen
  const sectionsMode = url.searchParams.get("sections") === "1" || category === "all";

  const buildResponse = (
    status: "success" | "error",
    data: { trending?: CatalogItem[]; sections?: Section[]; hasMore?: boolean },
    source: string,
    error: string | null
  ) => ({
    status,
    env: envName,
    category,
    page,
    pageSize,
    ...data,
    itemCount: data.trending?.length || data.sections?.reduce((sum, s) => sum + s.items.length, 0) || 0,
    source,
    error,
    durationMs: Date.now() - startTime,
  });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify(buildResponse("error", {}, "error", "Backend configuration error")), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) {
      return new Response(JSON.stringify(buildResponse("error", {}, "error", "Catalog not enabled")), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== TESLA-STYLE SECTIONS MODE ==========
    if (sectionsMode && page === 1) {
      // Return multiple sections for home screen
      const sectionSlugs = ["phones", "computers", "audio", "monitors", "tablets", "gaming"];
      const sections: Section[] = [];

      // Get all collections
      const { data: collections } = await supabase
        .from("catalog_collections")
        .select("slug, title, item_ids")
        .in("slug", sectionSlugs)
        .eq("is_active", true)
        .order("priority", { ascending: true });

      if (collections && collections.length > 0) {
        // Collect all item IDs for bulk fetch
        const allItemIds: string[] = [];
        for (const coll of collections) {
          const ids = (coll.item_ids || []).slice(0, 10);
          allItemIds.push(...ids);
        }

        // Bulk fetch items
        const { data: items } = await supabase
          .from("catalog_items")
          .select("*")
          .in("id", [...new Set(allItemIds)]);

        const itemMap = new Map((items || []).map(i => [i.id, i]));

        // Build sections with content filtering
        for (const coll of collections) {
          const collItemIds = (coll.item_ids || []).slice(0, 15); // Fetch extra to account for filtering
          const rawItems = collItemIds
            .map(id => itemMap.get(id))
            .filter(Boolean)
            .map(mapDbItemToResponse);

          // HARD BLOCK: Filter out books/subscriptions/streaming
          const filteredItems = filterBlockedItems(rawItems).slice(0, 10);

          sections.push({
            type: "section",
            title: coll.title,
            slug: coll.slug,
            items: filteredItems,
            hasMore: (coll.item_ids || []).length > 10,
          });
        }
      }

      console.log(`[CATALOG_HOME] sections mode, ${sections.length} sections, durationMs=${Date.now() - startTime}`);

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        category: "all",
        page: 1,
        pageSize,
        sections,
        source: "db-collections",
        error: null,
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== SINGLE CATEGORY/COLLECTION MODE ==========
    const collectionSlug = CATEGORY_TO_COLLECTION[category] || "trending_electronics";

    // Get collection
    const { data: collection } = await supabase
      .from("catalog_collections")
      .select("slug, title, item_ids, updated_at")
      .eq("slug", collectionSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (!collection || !collection.item_ids || collection.item_ids.length === 0) {
      // Empty collection - return empty success
      console.log(`[CATALOG_HOME] Empty collection: ${collectionSlug}`);
      return new Response(JSON.stringify(buildResponse("success", { trending: [], hasMore: false }, "db-empty", null)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allItemIds: string[] = collection.item_ids;
    const total = allItemIds.length;

    // Paginate
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItemIds = allItemIds.slice(startIdx, endIdx);

    if (pageItemIds.length === 0) {
      return new Response(JSON.stringify(buildResponse("success", { trending: [], hasMore: false }, "db-paginated", null)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch items
    const { data: items, error: itemsError } = await supabase
      .from("catalog_items")
      .select("*")
      .in("id", pageItemIds);

    if (itemsError) {
      console.error("[CATALOG_HOME] Error fetching items:", itemsError);
      return new Response(JSON.stringify(buildResponse("error", {}, "error", itemsError.message)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Preserve order from item_ids
    const itemMap = new Map((items || []).map(i => [i.id, i]));
    const rawItems = pageItemIds
      .map(id => itemMap.get(id))
      .filter(Boolean)
      .map(mapDbItemToResponse);

    // HARD BLOCK: Filter out books/subscriptions/streaming
    const orderedItems = filterBlockedItems(rawItems);

    const hasMore = endIdx < total;

    console.log(`[CATALOG_HOME] category=${category} page=${page} returned=${orderedItems.length} hasMore=${hasMore} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      category,
      page,
      pageSize,
      trending: orderedItems,
      itemCount: orderedItems.length,
      total,
      hasMore,
      source: "db-collection",
      collectionUpdatedAt: collection.updated_at,
      error: null,
      durationMs: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_HOME] Error: ${errorMessage} durationMs=${Date.now() - startTime}`);
    
    return new Response(JSON.stringify(buildResponse("error", {}, "error", "Catalog service error")), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
