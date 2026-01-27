/**
 * Catalog Search Endpoint
 * Aggregated search across all enabled providers
 * GET /catalog-search?q=...&page=...&provider=...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { aggregatedSearch } from "../_shared/catalogAggregator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=60",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q") || "";
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const provider = url.searchParams.get("provider");
    const minPrice = url.searchParams.get("minPrice");
    const maxPrice = url.searchParams.get("maxPrice");
    const category = url.searchParams.get("category");

    if (!query) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Query parameter 'q' is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Detect environment
    const envName = getEnvironmentFromRequest(req);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-search",
      env: envName,
      query,
      page,
      provider,
      catalogEnabled: isCatalogEnabled(envConfig),
    }));

    // Check if catalog is enabled for this environment
    if (!isCatalogEnabled(envConfig)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Catalog not enabled for this environment",
          env: envName,
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build filters
    const filters = {
      ...(minPrice && { minPrice: parseFloat(minPrice) }),
      ...(maxPrice && { maxPrice: parseFloat(maxPrice) }),
      ...(category && { category }),
    };

    // Execute aggregated search
    const result = await aggregatedSearch(supabase, query, page, filters, envConfig);

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-search",
      env: envName,
      query,
      resultCount: result.products.length,
      totalResults: result.totalResults,
      providers: result.providers,
      cacheHit: result.cacheHit,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[catalog-search] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
