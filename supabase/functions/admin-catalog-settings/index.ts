/**
 * Admin Settings Management Endpoint
 * GET: Retrieve all catalog settings
 * POST: Update one or more settings
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAndGetUser, handleCors, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { getCatalogSettings, updateCatalogSetting, CatalogSettings } from "../_shared/catalogSettings.ts";

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
      // GET: Return all catalog settings
      const settings = await getCatalogSettings(supabase);

      // Also fetch raw values for admin view
      const { data: rawSettings } = await supabase
        .from("admin_settings")
        .select("key, value, updated_at")
        .in("key", CATALOG_SETTING_KEYS);

      return jsonResponse({
        success: true,
        settings,
        raw: rawSettings || [],
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

        const result = await updateCatalogSetting(supabase, key, value, user.id);
        results[key] = result;
      }

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

    return errorResponse("Method not allowed", 405);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[admin-catalog-settings] Error:", message);
    return errorResponse(message, 500);
  }
});
