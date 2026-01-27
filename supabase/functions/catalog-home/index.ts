/**
 * Catalog Home Endpoint
 * Returns featured content for the native catalog home screen
 * GET /catalog-home
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { getFeaturedContent } from "../_shared/catalogAggregator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Detect environment
    const envName = getEnvironmentFromRequest(req);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-home",
      env: envName,
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

    // Get featured content
    const result = await getFeaturedContent(supabase, envConfig);

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-home",
      env: envName,
      featuredCount: result.featured.length,
      trendingCount: result.trending.length,
      categoriesCount: result.categories.length,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[catalog-home] Error:", err);
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
