/**
 * Catalog Refresh Endpoint (Admin only)
 * Force refresh of product cache from providers
 * POST /catalog-refresh
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig } from "../_shared/environmentResolver.ts";
import { getEnabledProviders, getProviderAdapter, cacheProducts } from "../_shared/catalogProviders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const startTime = Date.now();

  try {
    // Verify admin JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify the user is an admin
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!role) {
      return new Response(
        JSON.stringify({ success: false, error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const query = body.query || "popular products";
    const providerName = body.provider; // Optional: refresh specific provider

    // Detect environment
    const envName = getEnvironmentFromRequest(req);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-refresh",
      env: envName,
      query,
      providerName,
      adminId: user.id,
    }));

    // Get enabled providers
    let providers = await getEnabledProviders(supabase, envName);
    
    if (providerName) {
      providers = providers.filter(p => p.name === providerName);
    }

    if (providers.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No providers enabled for refresh",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Refresh from each provider
    const results: { provider: string; success: boolean; count: number; error?: string }[] = [];

    for (const provider of providers) {
      try {
        const adapter = getProviderAdapter(provider, envConfig);
        if (!adapter) {
          results.push({ provider: provider.name, success: false, count: 0, error: "No adapter" });
          continue;
        }

        const searchResult = await adapter.search(query, 1, {});
        
        if (searchResult.products.length > 0) {
          await cacheProducts(supabase, provider.id, searchResult.products);
        }

        results.push({
          provider: provider.name,
          success: true,
          count: searchResult.products.length,
        });
      } catch (err) {
        results.push({
          provider: provider.name,
          success: false,
          count: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const totalRefreshed = results.reduce((sum, r) => sum + r.count, 0);

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-refresh",
      env: envName,
      totalRefreshed,
      results,
      durationMs: Date.now() - startTime,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        message: `Refreshed ${totalRefreshed} products from ${results.length} providers`,
        results,
        durationMs: Date.now() - startTime,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[catalog-refresh] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
