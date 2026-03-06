/**
 * Admin Settings Management Endpoint
 * GET: Retrieve all catalog settings
 * POST: Update one or more settings
 */

import { createClient } from "@supabase/supabase-js";
import { verifyAndGetUser, handleCors, errorResponse, jsonResponse, createAdminClient } from "../_shared/auth.ts";
import { getCatalogSettings, updateCatalogSetting, CatalogSettings } from "../_shared/catalogSettings.ts";
import { invalidateTtlPolicyCache } from "../_shared/ttlPolicy.ts";

const CATALOG_SETTING_KEYS = [
  "catalog_provider_mode",
  "amazon_enabled",
  "ebay_enabled",
  "amazon_max_results_per_query",
  "amazon_max_calls_per_hour",
  "amazon_budget_window",
  "mixed_amazon_first_count",
  "mixed_blend_ratio",
  "search_cache_ttl_seconds",
  "home_cache_ttl_seconds",
  "offers_cache_ttl_seconds",
  "negative_cache_ttl_seconds",
  "ebay_cache_ttl_seconds",
  "amazon_category_allowlist",
  "enable_category_rules",
  // Media cache settings
  "media_cache_ttl_days",
  "media_prefetch_enabled",
  "media_prefetch_max_items_per_page",
  "media_fetch_timeout_ms",
  "media_fetch_concurrency",
  // Smart Amazon Live settings
  "amazon_live_search_enabled",
  "amazon_live_category_enabled",
  "amazon_live_home_enabled",
  "amazon_live_max_pages",
  "amazon_home_prewarm_enabled",
  "amazon_home_prewarm_interval_minutes",
  "amazon_home_prewarm_max_items_per_section",
  "amazon_query_generic_blocklist",
  "amazon_live_min_query_len",
  // Home rotation settings
  "home_rotation_interval_minutes",
  "home_rotation_mode",
  "home_avoid_repeat_days",
  "home_items_per_section",
  "ebay_home_cache_ttl_seconds",
  // TTL / DB-first settings
  "global_max_item_age_days",
  "global_price_refresh_days",
  "global_availability_refresh_days",
  "db_search_min_results",
  "amazon_max_calls_per_month",
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify admin access
    const { user, supabase } = await verifyAndGetUser(req);
    
    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return errorResponse("Admin access required", 403);
    }

    if (req.method === "GET") {
      // GET: Return all catalog settings + category TTL overrides
      const settings = await getCatalogSettings(supabase);

      // Also fetch raw values for admin view
      const { data: rawSettings } = await supabase
        .from("admin_settings")
        .select("key, value, updated_at")
        .in("key", CATALOG_SETTING_KEYS);

      // Fetch category TTL overrides
      const adminClient = createAdminClient();
      const { data: categoryTtl } = await adminClient
        .from("catalog_category_ttl")
        .select("*");

      return jsonResponse({
        success: true,
        settings,
        raw: rawSettings || [],
        categoryTtl: categoryTtl || [],
      });
    }

    if (req.method === "POST") {
      // POST: Update settings
      const body = await req.json();
      const { updates } = body as { updates: Record<string, unknown> };

      if (!updates || typeof updates !== "object") {
        return errorResponse("Missing 'updates' object in request body", 400);
      }

      const results: Record<string, { success: boolean; error?: string }> = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (!CATALOG_SETTING_KEYS.includes(key)) {
          results[key] = { success: false, error: `Invalid key: ${key}` };
          continue;
        }

        // Validate specific settings
        if (key === "catalog_provider_mode") {
          if (!["mixed", "ebay", "amazon"].includes(value as string)) {
            results[key] = { success: false, error: "Must be 'mixed', 'ebay', or 'amazon'" };
            continue;
          }
        }

        if (key === "amazon_budget_window") {
          if (!["hour", "day"].includes(value as string)) {
            results[key] = { success: false, error: "Must be 'hour' or 'day'" };
            continue;
          }
        }

        // TTL validations
        if (key === "global_max_item_age_days") {
          const n = parseInt(value as string, 10);
          if (isNaN(n) || n < 7 || n > 90) {
            results[key] = { success: false, error: "Must be 7-90" };
            continue;
          }
        }
        if (key === "global_price_refresh_days" || key === "global_availability_refresh_days") {
          const n = parseInt(value as string, 10);
          if (isNaN(n) || n < 1 || n > 14) {
            results[key] = { success: false, error: "Must be 1-14" };
            continue;
          }
        }
        if (key === "db_search_min_results") {
          const n = parseInt(value as string, 10);
          if (isNaN(n) || n < 3 || n > 50) {
            results[key] = { success: false, error: "Must be 3-50" };
            continue;
          }
        }

        const result = await updateCatalogSetting(supabase, key, value, user.id);
        results[key] = result;
      }

      // Invalidate TTL policy cache after updates
      invalidateTtlPolicyCache();

      // Log the action
      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        action_type: "UPDATE_CATALOG_SETTINGS",
        target_section: "catalog_settings",
        details: { updates, results },
      });

      // Check if all succeeded
      const allSucceeded = Object.values(results).every(r => r.success);

      return jsonResponse({
        success: allSucceeded,
        results,
        message: allSucceeded 
          ? "All settings updated successfully" 
          : "Some settings failed to update",
      });
    }

    // ─── PUT: Category TTL overrides ──────────────────────────────────
    if (req.method === "PUT") {
      const body = await req.json();
      const { categoryOverrides } = body as { 
        categoryOverrides?: Array<{
          category_key: string;
          max_item_age_days?: number | null;
          price_refresh_days?: number | null;
          availability_refresh_days?: number | null;
          db_min_results?: number | null;
          enabled?: boolean;
        }>;
      };

      if (!categoryOverrides || !Array.isArray(categoryOverrides)) {
        return errorResponse("Missing 'categoryOverrides' array in body", 400);
      }

      // Validate
      for (const ov of categoryOverrides) {
        if (!ov.category_key) {
          return errorResponse("Each override must have category_key", 400);
        }
        if (ov.max_item_age_days != null && (ov.max_item_age_days < 7 || ov.max_item_age_days > 90)) {
          return errorResponse(`max_item_age_days for ${ov.category_key} must be 7-90`, 400);
        }
        if (ov.price_refresh_days != null && (ov.price_refresh_days < 1 || ov.price_refresh_days > 14)) {
          return errorResponse(`price_refresh_days for ${ov.category_key} must be 1-14`, 400);
        }
        if (ov.availability_refresh_days != null && (ov.availability_refresh_days < 1 || ov.availability_refresh_days > 14)) {
          return errorResponse(`availability_refresh_days for ${ov.category_key} must be 1-14`, 400);
        }
      }

      // Use admin client (service_role) to bypass RLS
      const adminClient = createAdminClient();

      const rows = categoryOverrides.map(ov => ({
        category_key: ov.category_key,
        max_item_age_days: ov.max_item_age_days ?? null,
        price_refresh_days: ov.price_refresh_days ?? null,
        availability_refresh_days: ov.availability_refresh_days ?? null,
        db_min_results: ov.db_min_results ?? null,
        enabled: ov.enabled ?? true,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }));

      const { error: upsertError } = await adminClient
        .from("catalog_category_ttl")
        .upsert(rows, { onConflict: "category_key" });

      if (upsertError) {
        return errorResponse("Failed to save category overrides: " + upsertError.message, 500);
      }

      invalidateTtlPolicyCache();

      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        action_type: "UPDATE_CATEGORY_TTL",
        target_section: "catalog_category_ttl",
        details: { count: rows.length },
      });

      return jsonResponse({ success: true, saved: rows.length });
    }

    // ─── DELETE: Clear all category overrides (Apply Global to All) ───
    if (req.method === "DELETE") {
      const adminClient = createAdminClient();

      // Delete all rows = all categories inherit global
      const { error: delError } = await adminClient
        .from("catalog_category_ttl")
        .delete()
        .neq("category_key", "__never_match__");

      if (delError) {
        return errorResponse("Failed to clear overrides: " + delError.message, 500);
      }

      invalidateTtlPolicyCache();

      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        action_type: "CLEAR_CATEGORY_TTL",
        target_section: "catalog_category_ttl",
        details: { action: "apply_global_to_all" },
      });

      return jsonResponse({ success: true, message: "All category overrides cleared" });
    }

    return errorResponse("Method not allowed", 405);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[admin-catalog-settings] Error:", message);
    return errorResponse(message, 500);
  }
});
