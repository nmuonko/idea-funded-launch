/**
 * catalog-category
 * Fetches items for a specific category, combining eBay + Amazon (DB-first)
 * Amazon is restricted/cached, eBay can be fresher
 * 
 * Query params:
 * - key (required) - category slug from catalog_categories
 * - page default 1
 * - pageSize default 20
 * - env (from header or param)
 * - mode default "db" (db|live) - live only in staging
 * 
 * Returns ALWAYS 200 with stable shape:
 * { status, env, key, page, pageSize, total, items, error }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=120",
};

// Global deny keywords (applied to ALL categories)
const GLOBAL_DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "streaming",
  "audiobook", "textbook", "novel", "comics"
];

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string;
  inStock: boolean;
  rating: number | null;
  categoryKey: string;
}

interface CategoryRow {
  slug: string;
  title: string;
  provider_scope: string;
  queries: Record<string, unknown>;
  enabled: boolean;
}

interface DbItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  image_url: string | null;
  images: unknown;
  product_url: string;
  in_stock: boolean | null;
  rating: number | null;
  category_key: string | null;
}

function normalizeItem(row: DbItem, categoryKey: string): CatalogItem {
  let images: string[] = [];
  if (Array.isArray(row.images)) {
    images = row.images.filter((img): img is string => typeof img === "string");
  } else if (typeof row.images === "string") {
    images = [row.images];
  }

  return {
    id: row.id,
    provider: row.provider || "unknown",
    providerProductId: row.provider_product_id || row.id,
    title: row.title || "",
    priceUsd: row.price_usd,
    imageUrl: row.image_url || (images.length > 0 ? images[0] : null),
    images,
    productUrl: row.product_url || "",
    inStock: row.in_stock ?? true,
    rating: row.rating,
    categoryKey: row.category_key || categoryKey,
  };
}

function isBlockedByGlobalDeny(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return GLOBAL_DENY_KEYWORDS.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

function isBlockedByCustomDeny(title: string, denyKeywords: string[]): boolean {
  if (!denyKeywords || denyKeywords.length === 0) return false;
  const lowerTitle = title.toLowerCase();
  return denyKeywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const envName = getEnvironmentFromRequest(req);
  const url = new URL(req.url);
  
  // Support both 'key' and 'id' params for backward compatibility
  const key = url.searchParams.get("key") || url.searchParams.get("id") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const mode = url.searchParams.get("mode") || "db";

  console.log(`[CATALOG_CATEGORY] key=${key}, page=${page}, pageSize=${pageSize}, mode=${mode}, env=${envName}`);

  if (!key) {
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        key: "",
        page,
        pageSize,
        total: 0,
        items: [],
        error: { message: "Missing required 'key' parameter", code: "MISSING_KEY" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if catalog is enabled
    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) {
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          key,
          page,
          pageSize,
          total: 0,
          items: [],
          error: { message: "Catalog not enabled", code: "CATALOG_DISABLED" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch category definition
    const { data: categoryRow, error: catError } = await supabase
      .from("catalog_categories")
      .select("slug, title, provider_scope, queries, enabled")
      .eq("slug", key)
      .maybeSingle();

    if (catError || !categoryRow) {
      console.error("[CATALOG_CATEGORY] Category not found:", key, catError);
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          key,
          page,
          pageSize,
          total: 0,
          items: [],
          error: { message: `Category '${key}' not found`, code: "CATEGORY_NOT_FOUND" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!categoryRow.enabled) {
      return new Response(
        JSON.stringify({
          status: "success",
          env: envName,
          key,
          page,
          pageSize,
          total: 0,
          items: [],
          error: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const category = categoryRow as CategoryRow;
    const queries = category.queries || {};

    // Determine which providers to query
    const providers: string[] = [];
    if (category.provider_scope === "all") {
      if (queries.ebay && (queries.ebay as Record<string, unknown>).enabled !== false) {
        providers.push("ebay");
      }
      if (queries.rainforest && (queries.rainforest as Record<string, unknown>).enabled !== false) {
        providers.push("rainforest");
      }
    } else if (category.provider_scope === "ebay") {
      providers.push("ebay");
    } else if (category.provider_scope === "rainforest") {
      providers.push("rainforest");
    }

    // If no providers determined, default to both
    if (providers.length === 0) {
      providers.push("ebay", "rainforest");
    }

    // 2. Fetch items from DB (catalog_items) for each provider
    const allItems: CatalogItem[] = [];
    const fetchLimit = pageSize * 3; // Fetch extra to account for filtering

    for (const provider of providers) {
      const providerConfig = queries[provider] as Record<string, unknown> | undefined;
      const denyKeywords = (providerConfig?.denyKeywords as string[]) || [];

      // Fetch from catalog_items with matching provider and category_key
      const { data: dbItems, error: dbError } = await supabase
        .from("catalog_items")
        .select("*")
        .eq("provider", provider)
        .eq("category_key", key)
        .or("is_disallowed.is.null,is_disallowed.eq.false")
        .order("updated_at", { ascending: false })
        .limit(fetchLimit);

      if (dbError) {
        console.error(`[CATALOG_CATEGORY] DB error for provider ${provider}:`, dbError);
        continue;
      }

      if (dbItems && dbItems.length > 0) {
        for (const row of dbItems) {
          const item = normalizeItem(row as DbItem, key);
          
          // Apply global deny
          if (isBlockedByGlobalDeny(item.title)) continue;
          // Apply custom deny
          if (isBlockedByCustomDeny(item.title, denyKeywords)) continue;
          // Apply contentBlocker
          if (isDisallowedItem({ title: item.title, productUrl: item.productUrl }).isDisallowed) continue;

          allItems.push(item);
        }
      }
    }

    // If no category-specific items, try broader search from catalog_items
    if (allItems.length < pageSize) {
      for (const provider of providers) {
        const providerConfig = queries[provider] as Record<string, unknown> | undefined;
        const denyKeywords = (providerConfig?.denyKeywords as string[]) || [];

        // Fetch recent items from this provider without category filter
        const { data: fallbackItems } = await supabase
          .from("catalog_items")
          .select("*")
          .eq("provider", provider)
          .or("is_disallowed.is.null,is_disallowed.eq.false")
          .order("updated_at", { ascending: false })
          .limit(fetchLimit);

        if (fallbackItems && fallbackItems.length > 0) {
          for (const row of fallbackItems) {
            const item = normalizeItem(row as DbItem, key);
            
            // Check if already added
            if (allItems.some(existing => existing.id === item.id)) continue;
            
            // Apply filters
            if (isBlockedByGlobalDeny(item.title)) continue;
            if (isBlockedByCustomDeny(item.title, denyKeywords)) continue;
            if (isDisallowedItem({ title: item.title, productUrl: item.productUrl }).isDisallowed) continue;

            allItems.push(item);
          }
        }
      }
    }

    // 3. De-duplicate by id
    const uniqueMap = new Map<string, CatalogItem>();
    for (const item of allItems) {
      if (!uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }

    // 4. Sort: inStock first, then has price, then rating, then freshness
    const sortedItems = Array.from(uniqueMap.values()).sort((a, b) => {
      // In stock first
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      // Has price first
      const aHasPrice = a.priceUsd != null && a.priceUsd > 0;
      const bHasPrice = b.priceUsd != null && b.priceUsd > 0;
      if (aHasPrice !== bHasPrice) return aHasPrice ? -1 : 1;
      // Higher rating first
      const aRating = a.rating ?? 0;
      const bRating = b.rating ?? 0;
      if (aRating !== bRating) return bRating - aRating;
      return 0;
    });

    // 5. Paginate
    const total = sortedItems.length;
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItems = sortedItems.slice(startIdx, endIdx);

    console.log(`[CATALOG_CATEGORY] key=${key}, total=${total}, returning=${pageItems.length}, providers=${providers.join(",")}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        key,
        page,
        pageSize,
        total,
        items: pageItems,
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[CATALOG_CATEGORY] Error:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        key,
        page,
        pageSize,
        total: 0,
        items: [],
        error: { message: "Internal server error", code: "INTERNAL_ERROR" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
