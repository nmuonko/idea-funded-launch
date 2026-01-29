/**
 * Admin Bootstrap Catalog
 * 
 * One-time setup endpoint that:
 * 1. Seeds default catalog queries (admin-seed-default-catalog)
 * 2. Runs live refresh for ALL categories (catalog-refresh-seeded?mode=live)
 * 3. Optionally backfills unified_category for existing items
 * 
 * POST /admin-bootstrap-catalog
 * Body: { runBackfill?: boolean, maxSeeds?: number }
 * 
 * Requires: admin auth
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapUnifiedCategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth check
  let isAuthorized = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
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
      JSON.stringify({ success: false, error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse params
  let runBackfill = true;
  let maxSeeds = 30;

  try {
    const body = await req.json().catch(() => ({}));
    runBackfill = body.runBackfill !== false;
    maxSeeds = body.maxSeeds || 30;
  } catch {
    // Use defaults
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const startTime = Date.now();

  const results: Record<string, any> = {};

  // Step 1: Seed default catalog queries
  console.log("[BOOTSTRAP] Step 1: Seeding default catalog queries...");
  try {
    const seedResponse = await fetch(`${supabaseUrl}/functions/v1/admin-seed-default-catalog`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
    });
    const seedResult = await seedResponse.json();
    results.seedCatalog = seedResult;
    console.log("[BOOTSTRAP] Seed result:", seedResult.totalSeeded || 0, "seeds");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[BOOTSTRAP] Seed failed:", msg);
    results.seedCatalog = { error: msg };
  }

  // Step 2: Run live refresh
  console.log("[BOOTSTRAP] Step 2: Running live refresh...");
  try {
    const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/catalog-refresh-seeded`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "live",
        maxSeeds,
      }),
    });
    const refreshResult = await refreshResponse.json();
    results.refreshCatalog = refreshResult;
    console.log("[BOOTSTRAP] Refresh result: Fetched=", refreshResult.totalFetched || 0, "Upserted=", refreshResult.totalUpserted || 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[BOOTSTRAP] Refresh failed:", msg);
    results.refreshCatalog = { error: msg };
  }

  // Step 3: Backfill unified_category for existing items
  if (runBackfill) {
    console.log("[BOOTSTRAP] Step 3: Backfilling unified_category...");
    try {
      // Get items without unified_category
      const { data: itemsToBackfill, error: fetchError } = await supabase
        .from("catalog_items")
        .select("id, title, provider, product_url, metadata")
        .is("unified_category", null)
        .limit(1000);

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      let backfillCount = 0;
      let blockedCount = 0;

      if (itemsToBackfill && itemsToBackfill.length > 0) {
        for (const item of itemsToBackfill) {
          const unified = mapUnifiedCategory({
            title: item.title || undefined,
            provider: item.provider || undefined,
            productUrl: item.product_url || undefined,
            ebayCategoryPath: (item.metadata as any)?.categoryPath || undefined,
          });

          if (unified === "blocked") {
            // Delete blocked items
            await supabase.from("catalog_items").delete().eq("id", item.id);
            blockedCount++;
          } else {
            // Update unified_category
            await supabase
              .from("catalog_items")
              .update({ unified_category: unified, updated_at: new Date().toISOString() })
              .eq("id", item.id);
            backfillCount++;
          }
        }
      }

      results.backfill = {
        processed: itemsToBackfill?.length || 0,
        updated: backfillCount,
        blocked: blockedCount,
      };
      console.log(`[BOOTSTRAP] Backfill: Updated=${backfillCount} Blocked=${blockedCount}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[BOOTSTRAP] Backfill failed:", msg);
      results.backfill = { error: msg };
    }
  }

  // Get final counts
  const { count: totalItems } = await supabase
    .from("catalog_items")
    .select("*", { count: "exact", head: true });

  const { data: categoryCounts } = await supabase
    .from("catalog_items")
    .select("unified_category")
    .not("unified_category", "is", null);

  // Aggregate by category
  const byCategory: Record<string, number> = {};
  if (categoryCounts) {
    for (const row of categoryCounts) {
      const cat = row.unified_category as string;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`[BOOTSTRAP] Complete. Total items: ${totalItems} Duration: ${durationMs}ms`);

  return new Response(
    JSON.stringify({
      success: true,
      totalItems: totalItems || 0,
      byCategory,
      durationMs,
      steps: results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
