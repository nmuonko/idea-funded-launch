/**
 * Market Search Proxy Edge Function — UNIFIED SEARCH
 * 
 * Thin proxy that delegates ALL search logic to catalog-search,
 * ensuring mobile and web return identical results with the same
 * relevance ranking, query normalization, and result depth.
 * 
 * Mobile request params → catalog-search params → mobile response format
 */

import { createClient } from "@supabase/supabase-js";
import { getClientIp } from "../_shared/rateLimiter.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_IP = 60;
const RATE_LIMIT_USER = 120;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;

// ─── Types ───────────────────────────────────────────────────────────────────

interface NormalizedItem {
  id: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string;
  productUrl: string;
  source: "ebay" | "amazon";
  condition: string;
}

interface SearchResponse {
  query: string;
  sourceRequested: string;
  sourceServed: string[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  items: NormalizedItem[];
  timingsMs: { db: number; ebay: number; amazon: number; total: number };
  cache: { hit: boolean; ttlSeconds: number; stale?: boolean; ageSeconds?: number };
  errors: { source: string; message: string }[];
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const startTime = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: CORS_HEADERS }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Parse mobile request
    const url = new URL(req.url);
    const params = url.searchParams;
    const q = params.get("q")?.trim();
    if (!q || q.length < 1) {
      return new Response(JSON.stringify({ error: "Missing required parameter: q" }), { status: 400, headers: CORS_HEADERS });
    }
    if (q.length > 200) {
      return new Response(JSON.stringify({ error: "Query too long (max 200 characters)" }), { status: 400, headers: CORS_HEADERS });
    }

    const sourceRaw = params.get("source") || "both";
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(params.get("limit") || String(DEFAULT_LIMIT), 10)));
    const page = Math.max(1, parseInt(params.get("page") || "1", 10));
    const category = params.get("category") || undefined;
    const sort = params.get("sort") || "best";
    const minPrice = params.get("minPrice") || undefined;
    const maxPrice = params.get("maxPrice") || undefined;
    const condition = params.get("condition") || "any";

    const platformRaw = params.get("clientPlatform");
    let clientPlatform: string | undefined;
    if (platformRaw && ["ios", "android", "web"].includes(platformRaw)) {
      clientPlatform = platformRaw;
    }

    const requestId = crypto.randomUUID().slice(0, 8);
    console.log(`[SEARCH_PROXY] requestId=${requestId} UNIFIED delegating to catalog-search q="${q}" limit=${limit} page=${page} platform=${clientPlatform || "unknown"}`);

    // 2. Rate limit (keep mobile-specific rate limiting)
    const clientIp = getClientIp(req);
    const authHeader = req.headers.get("Authorization");
    const rateLimitResult = await checkRateLimit(supabase, clientIp, authHeader);
    if (!rateLimitResult.allowed) {
      return new Response(
        JSON.stringify({ error: "rate_limited", retry_after: rateLimitResult.retryAfter }),
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": rateLimitResult.retryAfter || "60" } }
      );
    }

    // 3. Build catalog-search URL with mapped parameters
    // catalog-search uses page 0-indexed, mobile uses page 1-indexed
    const catalogPage = Math.max(0, page - 1);
    const catalogSearchUrl = new URL(`${supabaseUrl}/functions/v1/catalog-search`);
    catalogSearchUrl.searchParams.set("q", q);
    catalogSearchUrl.searchParams.set("limit", String(limit));
    catalogSearchUrl.searchParams.set("page", String(catalogPage));
    catalogSearchUrl.searchParams.set("provider", "mixed");
    if (category) catalogSearchUrl.searchParams.set("category_key", category);

    // Map sort: mobile uses best/price_asc/price_desc → catalog uses relevance/price_asc/price_desc
    const sortMap: Record<string, string> = {
      "best": "relevance",
      "price_asc": "price_asc",
      "price_desc": "price_desc",
      "newly_listed": "newly_listed",
    };
    catalogSearchUrl.searchParams.set("sort", sortMap[sort] || "relevance");

    // Map filters
    if (minPrice || maxPrice || condition !== "any") {
      const filters: Record<string, any> = {};
      if (minPrice) filters.minPrice = parseFloat(minPrice);
      if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
      if (condition !== "any") filters.condition = condition;
      catalogSearchUrl.searchParams.set("filters", JSON.stringify(filters));
    }

    // Pass platform for feature flag resolution
    if (clientPlatform) {
      catalogSearchUrl.searchParams.set("clientPlatform", clientPlatform);
    }

    // 4. Call catalog-search internally with service role key
    const catalogResponse = await fetch(catalogSearchUrl.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "apikey": supabaseKey,
        "Content-Type": "application/json",
        "x-afrishop-environment": "production",
      },
    });

    if (!catalogResponse.ok) {
      console.error(`[SEARCH_PROXY] requestId=${requestId} catalog-search returned ${catalogResponse.status}`);
      return new Response(
        JSON.stringify({ error: "Search service temporarily unavailable" }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const catalogData = await catalogResponse.json();
    const catalogItems: any[] = catalogData.items || [];
    const catalogTotal: number = catalogData.total || catalogItems.length;
    const catalogHasMore: boolean = catalogData.hasMore ?? false;

    // 5. Map catalog-search items → mobile NormalizedItem format
    const mappedItems: NormalizedItem[] = catalogItems
      .map((item: any) => {
        const imageUrl = item.mainImageUrl || item.imageUrl || item.image_url || "";
        const title = item.title || "";
        const price = item.priceUsd || item.price_usd || item.price || 0;
        if (!imageUrl || !title || price <= 0) return null;

        return {
          id: item.id || "",
          title,
          price: Number(price),
          currency: item.currency || "USD",
          imageUrl,
          productUrl: item.productUrl || item.product_url || "",
          source: (item.provider === "rainforest" ? "amazon" : (item.provider || item.store || "ebay")) as "ebay" | "amazon",
          condition: item.condition || "used",
        };
      })
      .filter((item: NormalizedItem | null): item is NormalizedItem => item !== null);

    // 6. Build mobile response format
    const totalMs = Date.now() - startTime;
    const sourceServed: string[] = [];
    if (mappedItems.some(i => i.source === "ebay")) sourceServed.push("ebay");
    if (mappedItems.some(i => i.source === "amazon")) sourceServed.push("amazon");
    if (catalogData.meta?.source?.includes("db") || catalogData.sourcesUsed?.includes("db")) sourceServed.push("db");

    const response: SearchResponse = {
      query: q,
      sourceRequested: sourceRaw,
      sourceServed,
      page,
      limit,
      total: catalogTotal,
      hasMore: catalogHasMore,
      items: mappedItems,
      timingsMs: {
        db: catalogData.durationMs || 0,
        ebay: 0,
        amazon: 0,
        total: totalMs,
      },
      cache: {
        hit: catalogData._cacheHit || false,
        ttlSeconds: catalogData.ttlSeconds || 300,
        ...(catalogData._cacheAgeSec !== undefined && { ageSeconds: catalogData._cacheAgeSec }),
      },
      errors: catalogData.error ? [{ source: "catalog-search", message: catalogData.error.message || String(catalogData.error) }] : [],
    };

    console.log(`[SEARCH_PROXY] requestId=${requestId} UNIFIED response items=${mappedItems.length} total=${catalogTotal} hasMore=${catalogHasMore} totalMs=${totalMs}`);

    return new Response(JSON.stringify(response), { headers: CORS_HEADERS });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[SEARCH_PROXY] error", errorMsg);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: string;
}

async function checkRateLimit(supabase: any, clientIp: string, authHeader: string | null): Promise<RateLimitResult> {
  try {
    const ipKey = `ip:${clientIp}:market-search`;
    const { data: ipResult, error: ipError } = await supabase.rpc("check_rate_limit", {
      p_key: ipKey, p_limit: RATE_LIMIT_IP, p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    });

    if (ipError) return { allowed: true };
    if (!ipResult?.allowed) return { allowed: false, retryAfter: ipResult?.reset_at };

    if (authHeader?.startsWith("Bearer ")) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const { data } = await supabase.auth.getUser(token);
        if (data?.user) {
          const userKey = `user:${data.user.id}:market-search`;
          const { data: userResult } = await supabase.rpc("check_rate_limit", {
            p_key: userKey, p_limit: RATE_LIMIT_USER, p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
          });
          if (userResult && !userResult.allowed) {
            return { allowed: false, retryAfter: userResult.reset_at };
          }
        }
      } catch {}
    }

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
