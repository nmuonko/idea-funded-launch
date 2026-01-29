/**
 * Admin Backfill Unified Categories
 * 
 * One-time backfill function to compute unified_category for existing catalog_items.
 * Also ensures future ingests are classified correctly.
 * 
 * POST /admin-backfill-unified-categories
 * Headers:
 *   - authorization: Bearer <admin_token> OR x-admin-api-key: <ADMIN_API_KEY>
 * 
 * Body (optional):
 *   { "batchSize": 1000, "deleteBlocked": false }
 * 
 * Response:
 *   { success, processed, updated, blocked, skipped, deletedBlocked, durationMs }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapUnifiedCategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-admin-api-key",
  "Access-Control-Max-Age": "86400",
};

interface CatalogItemRow {
  id: string;
  title: string | null;
  provider: string | null;
  product_url: string | null;
  unified_category: string | null;
  category_key: string | null;
  // eBay metadata if stored in JSON
  metadata?: {
    categoryPath?: string;
    categoryId?: string;
    condition?: string;
  };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminApiKey = Deno.env.get("ADMIN_API_KEY");

  // Authenticate: admin token OR API key
  let isAuthorized = false;

  // Check API key header
  const apiKeyHeader = req.headers.get("x-admin-api-key");
  if (adminApiKey && apiKeyHeader === adminApiKey) {
    isAuthorized = true;
  }

  // Check bearer token for admin role
  if (!isAuthorized) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
      
      if (!claimsError && claimsData?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", claimsData.user.id)
          .eq("role", "admin")
          .maybeSingle();
        
        isAuthorized = !!roles;
      }
    }
  }

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized: Admin access required" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse request body
  let batchSize = 1000;
  let deleteBlocked = false;
  
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.batchSize === "number" && body.batchSize > 0 && body.batchSize <= 5000) {
      batchSize = body.batchSize;
    }
    if (typeof body.deleteBlocked === "boolean") {
      deleteBlocked = body.deleteBlocked;
    }
  } catch {
    // Use defaults
  }

  console.log(`[BACKFILL_CATEGORIES] Starting with batchSize=${batchSize} deleteBlocked=${deleteBlocked}`);

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Track stats
  let processed = 0;
  let updated = 0;
  let blocked = 0;
  let skipped = 0;
  let deletedBlocked = 0;
  let hasMore = true;
  let lastId: string | null = null;

  while (hasMore) {
    // Fetch batch of items with NULL unified_category
    let query = supabase
      .from("catalog_items")
      .select("id, title, provider, product_url, unified_category, category_key")
      .is("unified_category", null)
      .order("id", { ascending: true })
      .limit(batchSize);

    if (lastId) {
      query = query.gt("id", lastId);
    }

    const { data: items, error: fetchError } = await query;

    if (fetchError) {
      console.error(`[BACKFILL_CATEGORIES] Fetch error: ${fetchError.message}`);
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!items || items.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`[BACKFILL_CATEGORIES] Processing batch of ${items.length} items, lastId=${lastId || 'start'}`);

    // Process each item
    const updates: { id: string; unified_category: string }[] = [];
    const toDelete: string[] = [];

    for (const row of items as CatalogItemRow[]) {
      processed++;
      lastId = row.id;

      // Compute unified_category
      const unifiedCategory = mapUnifiedCategory({
        title: row.title || undefined,
        provider: row.provider || undefined,
        productUrl: row.product_url || undefined,
        ebayCategoryPath: row.metadata?.categoryPath,
        ebayCategoryId: row.metadata?.categoryId,
        condition: row.metadata?.condition,
      });

      if (unifiedCategory === "blocked") {
        blocked++;
        if (deleteBlocked) {
          toDelete.push(row.id);
        } else {
          // Mark as blocked rather than delete
          updates.push({ id: row.id, unified_category: "blocked" });
        }
      } else if (row.unified_category !== unifiedCategory) {
        updates.push({ id: row.id, unified_category: unifiedCategory });
      } else {
        skipped++;
      }
    }

    // Batch update
    if (updates.length > 0) {
      // Upsert in chunks of 100
      for (let i = 0; i < updates.length; i += 100) {
        const chunk = updates.slice(i, i + 100);
        const { error: updateError } = await supabase
          .from("catalog_items")
          .upsert(
            chunk.map(u => ({ id: u.id, unified_category: u.unified_category, updated_at: new Date().toISOString() })),
            { onConflict: "id" }
          );

        if (updateError) {
          console.error(`[BACKFILL_CATEGORIES] Update error: ${updateError.message}`);
        } else {
          updated += chunk.length;
        }
      }
    }

    // Batch delete blocked items
    if (toDelete.length > 0) {
      const { error: deleteError, count } = await supabase
        .from("catalog_items")
        .delete()
        .in("id", toDelete);

      if (deleteError) {
        console.error(`[BACKFILL_CATEGORIES] Delete error: ${deleteError.message}`);
      } else {
        deletedBlocked += count || toDelete.length;
      }
    }

    // If we got fewer items than batch size, we're done
    if (items.length < batchSize) {
      hasMore = false;
    }
  }

  const durationMs = Date.now() - startTime;
  
  console.log(`[BACKFILL_CATEGORIES] Complete: processed=${processed} updated=${updated} blocked=${blocked} skipped=${skipped} deletedBlocked=${deletedBlocked} durationMs=${durationMs}`);

  return new Response(
    JSON.stringify({
      success: true,
      processed,
      updated,
      blocked,
      skipped,
      deletedBlocked,
      durationMs,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
