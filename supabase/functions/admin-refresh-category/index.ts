/**
 * Admin Refresh Category
 * 
 * Re-runs seed refresh for a specific category and updates the cache.
 * 
 * POST /admin-refresh-category?category=clothing_shoes_accessories
 * 
 * Query params:
 * - category (required) - unified category slug to refresh
 * - maxSeeds (optional) - max number of seed queries to process (default: 20)
 * 
 * Requires: admin auth or cron secret
 * 
 * ALWAYS returns HTTP 200 with stable shape:
 * { status, category, seeded, refreshed, error }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { extractBrand } from "../_shared/brandExtractor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret, x-admin-key",
};

// Allow x-admin-key header as alternative auth
function checkAdminKey(req: Request): boolean {
  const adminKey = req.headers.get("x-admin-key");
  const expectedKey = Deno.env.get("CRON_SECRET");
  return adminKey === expectedKey && !!adminKey;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const maxSeeds = parseInt(url.searchParams.get("maxSeeds") || "20", 10);
  const startTime = Date.now();

  // Response helper
  const buildResponse = (
    status: "success" | "error",
    data: Record<string, unknown>,
    error: { message: string; code: string } | null
  ) => ({
    status,
    category,
    ...data,
    error,
    durationMs: Date.now() - startTime,
  });

  // Validate category
  if (!category) {
    return new Response(
      JSON.stringify(buildResponse("error", {}, { message: "Missing required 'category' parameter", code: "MISSING_CATEGORY" })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth check
  let isAuthorized = false;
  
  if (checkAdminKey(req)) {
    isAuthorized = true;
  }
  
  const authHeader = req.headers.get("authorization");
  if (!isAuthorized && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === supabaseServiceKey) {
      isAuthorized = true;
    } else {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        isAuthorized = !!roles;
      }
    }
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return new Response(
      JSON.stringify(buildResponse("error", {}, { message: "Unauthorized", code: "UNAUTHORIZED" })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log(`[REFRESH_CATEGORY] Starting refresh for category=${category} maxSeeds=${maxSeeds}`);

  try {
    // Step 1: Get seed queries for this category
    const { data: seeds, error: seedsError } = await supabase
      .from("catalog_seed_queries")
      .select("*")
      .eq("category", category)
      .eq("enabled", true)
      .limit(maxSeeds);

    if (seedsError) {
      console.error(`[REFRESH_CATEGORY] Failed to fetch seeds:`, seedsError.message);
      return new Response(
        JSON.stringify(buildResponse("error", {}, { message: "Failed to fetch seeds", code: "SEEDS_ERROR" })),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[REFRESH_CATEGORY] Found ${seeds?.length || 0} seeds for category=${category}`);

    // Step 2: Call catalog-refresh-seeded for this category's seeds
    const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/catalog-refresh-seeded`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "live",
        maxSeeds,
        categoryFilter: category,
      }),
    });

    let refreshResult;
    try {
      refreshResult = await refreshResponse.json();
    } catch {
      refreshResult = { error: "Failed to parse refresh response" };
    }

    console.log(`[REFRESH_CATEGORY] Refresh result:`, refreshResult);

    // Step 3: Backfill brand for existing items in this category that don't have it
    const { data: itemsWithoutBrand, error: fetchError } = await supabase
      .from("catalog_items")
      .select("id, title")
      .eq("unified_category", category)
      .is("brand", null)
      .limit(500);

    let backfilledCount = 0;
    if (!fetchError && itemsWithoutBrand && itemsWithoutBrand.length > 0) {
      console.log(`[REFRESH_CATEGORY] Backfilling brand for ${itemsWithoutBrand.length} items`);
      
      const updates = itemsWithoutBrand.map(item => ({
        id: item.id,
        brand: extractBrand(item.title),
      }));

      const { error: updateError } = await supabase
        .from("catalog_items")
        .upsert(updates, { onConflict: "id" });

      if (!updateError) {
        backfilledCount = updates.length;
        console.log(`[REFRESH_CATEGORY] Backfilled brand for ${backfilledCount} items`);
      } else {
        console.error(`[REFRESH_CATEGORY] Brand backfill error:`, updateError.message);
      }
    }

    return new Response(
      JSON.stringify(buildResponse("success", {
        seedsFound: seeds?.length || 0,
        refreshResult,
        brandBackfilled: backfilledCount,
      }, null)),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[REFRESH_CATEGORY] Error:`, errorMessage);

    return new Response(
      JSON.stringify(buildResponse("error", {}, { message: "Internal server error", code: "INTERNAL_ERROR" })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
