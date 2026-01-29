/**
 * catalog-category
 * Fetches items for a specific unified category from DB
 * 
 * Query params:
 * - category (preferred) OR key (legacy) - unified category slug (electronics, motors, clothing, etc.)
 * - page default 1
 * - pageSize default 20
 * - env (from header or param)
 * 
 * ALWAYS returns HTTP 200 with stable shape:
 * { status, env, category, page, pageSize, total, items, error }
 * 
 * Motors: Only FIXED_PRICE (Buy It Now) items, $1500+ minimum
 * All categories: No books/subscriptions/streaming
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled, EnvironmentName } from "../_shared/environmentResolver.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { TABS, isValidCategory } from "../_shared/categoryMapper.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=120",
};

// Global deny keywords (applied to ALL categories)
const GLOBAL_DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "streaming",
  "audiobook", "textbook", "novel", "comics"
];

// Motors deny keywords (parts, accessories, auctions)
const MOTORS_DENY_KEYWORDS = [
  "floor mat", "car mat", "tire", "rim", "seat cover", "car cover",
  "parts", "replacement", "repair", "brake pad", "oil filter", "wiper",
  "bulb", "led light", "dash cam", "phone mount", "key fob", "auction", "bid"
];

// Motors minimum price (to filter out parts/accessories)
const MOTORS_MIN_PRICE_USD = 1500;

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
  unifiedCategory: string;
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
  unified_category: string | null;
  category_key: string | null;
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function normalizeItem(row: DbItem): CatalogItem {
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
    unifiedCategory: row.unified_category || row.category_key || "electronics",
  };
}

function isBlockedByGlobalDeny(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return GLOBAL_DENY_KEYWORDS.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

function isBlockedByMotorsDeny(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return MOTORS_DENY_KEYWORDS.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

Deno.serve(async (req) => {
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

  // Parse query params - prefer 'category', fall back to 'key' for backwards compatibility
  const category = url.searchParams.get("category") || url.searchParams.get("key") || url.searchParams.get("id") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const mode = url.searchParams.get("mode") || "db";

  // Validate environment
  if (!ALLOWED_ENVS.includes(envName)) {
    console.error(`[CATALOG_CATEGORY_API] requestId=${requestId} error=BAD_ENV env=${envName} category=${category}`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        category,
        page,
        pageSize,
        total: 0,
        items: [],
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[CATALOG_CATEGORY_API] requestId=${requestId} env=${envName} category=${category} page=${page} pageSize=${pageSize} mode=${mode}`);

  if (!category) {
    console.error(`[CATALOG_CATEGORY_API] requestId=${requestId} error=MISSING_CATEGORY`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        category: "",
        page,
        pageSize,
        total: 0,
        items: [],
        error: { message: "Missing required 'category' parameter", code: "MISSING_CATEGORY" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate category
  if (!isValidCategory(category)) {
    console.error(`[CATALOG_CATEGORY_API] requestId=${requestId} error=INVALID_CATEGORY category=${category}`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        category,
        page,
        pageSize,
        total: 0,
        items: [],
        error: { message: `Invalid category: ${category}. Valid categories: ${TABS.map(t => t.key).join(", ")}`, code: "INVALID_CATEGORY" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error(`[CATALOG_CATEGORY_API] requestId=${requestId} error=MISSING_CONFIG`);
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          category,
          page,
          pageSize,
          total: 0,
          items: [],
          error: { message: "Backend configuration error", code: "CONFIG_ERROR" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // REMOVED: Environment check - catalog is ALWAYS enabled for mobile
    // We no longer check isCatalogEnabled because mobile-public-config ALWAYS returns catalogEnabled: true
    console.log(`[CATALOG_CATEGORY_API] requestId=${requestId} env=${envName} catalog_always_enabled=true`);

    // Fetch items from catalog_items by unified_category
    const isMotors = category === "motors";
    const fetchLimit = pageSize * 4; // Fetch extra for filtering

    // Build query - check both unified_category and category_key for backwards compatibility
    // Also exclude blocked items
    let query = supabase
      .from("catalog_items")
      .select("*")
      .or(`unified_category.eq.${category},category_key.eq.${category}`)
      .neq("unified_category", "blocked")
      .or("is_disallowed.is.null,is_disallowed.eq.false");

    // Motors-specific: minimum price filter
    if (isMotors) {
      query = query.gte("price_usd", MOTORS_MIN_PRICE_USD);
    }

    const { data: dbItems, error: dbError } = await query
      .order("updated_at", { ascending: false })
      .limit(fetchLimit);

    if (dbError) {
      console.error(`[CATALOG_CATEGORY_API] requestId=${requestId} error=DB_ERROR message=${dbError.message}`);
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          category,
          page,
          pageSize,
          total: 0,
          items: [],
          error: { message: "Database error", code: "DB_ERROR" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize and filter items
    const allItems: CatalogItem[] = [];
    let filteredCount = 0;

    for (const row of dbItems || []) {
      const item = normalizeItem(row as DbItem);

      // Apply global deny filter
      if (isBlockedByGlobalDeny(item.title)) {
        filteredCount++;
        continue;
      }

      // Apply motors-specific filter
      if (isMotors && isBlockedByMotorsDeny(item.title)) {
        filteredCount++;
        continue;
      }

      // Apply contentBlocker
      if (isDisallowedItem({ title: item.title, productUrl: item.productUrl }).isDisallowed) {
        filteredCount++;
        continue;
      }

      allItems.push(item);
    }
    
    console.log(`[CATALOG_CATEGORY_API] requestId=${requestId} dbRows=${dbItems?.length || 0} filtered=${filteredCount} remaining=${allItems.length}`);

    // De-duplicate by id
    const uniqueMap = new Map<string, CatalogItem>();
    for (const item of allItems) {
      if (!uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }

    // Sort: inStock first, then has price, then rating
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

    // Paginate
    const total = sortedItems.length;
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageItems = sortedItems.slice(startIdx, endIdx);

    const durationMs = Date.now() - startTime;
    console.log(`[CATALOG_CATEGORY_API] requestId=${requestId} env=${envName} category=${category} total=${total} returning=${pageItems.length} providers=${[...new Set(pageItems.map(i => i.provider))].join(",")} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        category,
        page,
        pageSize,
        total,
        items: pageItems,
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const errorStack = err instanceof Error ? err.stack : undefined;
    const durationMs = Date.now() - startTime;
    
    console.error(`[CATALOG_CATEGORY_API] requestId=${requestId} env=${envName} category=${category} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);
    if (errorStack) {
      console.error(`[CATALOG_CATEGORY_API] requestId=${requestId} stack=${errorStack}`);
    }

    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        category,
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
