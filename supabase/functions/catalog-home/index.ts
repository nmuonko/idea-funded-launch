/**
 * Catalog Home Endpoint
 * Returns featured content for the native catalog home screen
 * GET /catalog-home
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * Mobile apps depend on this - never return 404.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { getFeaturedContent } from "../_shared/catalogAggregator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300",
};

// Stable response shape that mobile apps expect
interface CatalogHomeResponse {
  status: "ok" | "error";
  env: string;
  featured: any[];
  categories: any[];
  trending: any[];
  message: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);
  
  console.log(`[CATALOG_HOME] env=${envName}`);

  // Default response - always return this shape
  const defaultResponse: CatalogHomeResponse = {
    status: "ok",
    env: envName,
    featured: [],
    categories: [],
    trending: [],
    message: "Catalog ready"
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[CATALOG_HOME] Missing Supabase credentials, returning empty catalog");
      return new Response(
        JSON.stringify({
          ...defaultResponse,
          message: "Catalog initializing"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    console.log("[CATALOG_HOME] Config:", JSON.stringify({
      env: envName,
      catalogEnabled: isCatalogEnabled(envConfig),
      catalogMode: envConfig?.catalog_mode || "unknown"
    }));

    // If catalog is not enabled, return empty but valid response
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_HOME] Catalog not enabled for env=${envName}, returning empty`);
      return new Response(
        JSON.stringify({
          ...defaultResponse,
          message: "Catalog not enabled for this environment"
        }),
        {
          status: 200, // Always 200, never 403/404
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get featured content from aggregator
    const result = await getFeaturedContent(supabase, envConfig);

    const response: CatalogHomeResponse = {
      status: "ok",
      env: envName,
      featured: result.featured || [],
      categories: result.categories || [],
      trending: result.trending || [],
      message: "Catalog ready"
    };

    console.log(`[CATALOG_HOME] returning featured=${response.featured.length} categories=${response.categories.length} trending=${response.trending.length}`);
    console.log(`[CATALOG_HOME] duration=${Date.now() - startTime}ms`);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_HOME] Error:", errorMessage);
    
    // Even on error, return 200 with stable shape
    const errorResponse: CatalogHomeResponse = {
      status: "error",
      env: envName,
      featured: [],
      categories: [],
      trending: [],
      message: "Catalog service error"
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 200, // Always 200 to prevent mobile crash
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
