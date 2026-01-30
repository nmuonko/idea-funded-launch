/**
 * Admin Cache Management Endpoint
 * POST: Clear cache by pattern
 * GET: Get cache statistics
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAndGetUser, handleCors, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { clearDbCache, ClearCacheParams } from "../_shared/catalogCache.ts";

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const requestId = generateRequestId();

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
      // GET: Return cache statistics
      const { data: cacheStats, error: statsError } = await supabase
        .from("catalog_cache")
        .select("cache_type, provider", { count: "exact" });

      if (statsError) {
        return errorResponse(statsError.message, 500);
      }

      // Group by type and provider
      const byType: Record<string, number> = {};
      const byProvider: Record<string, number> = {};

      for (const row of cacheStats || []) {
        byType[row.cache_type] = (byType[row.cache_type] || 0) + 1;
        byProvider[row.provider] = (byProvider[row.provider] || 0) + 1;
      }

      // Get budget stats
      const { data: budgetStats } = await supabase
        .from("provider_budget")
        .select("*")
        .order("window_start", { ascending: false })
        .limit(10);

      return jsonResponse({
        success: true,
        cache: {
          totalEntries: cacheStats?.length || 0,
          byType,
          byProvider,
        },
        budget: {
          recentWindows: budgetStats || [],
        },
      });
    }

    if (req.method === "POST") {
      // POST: Clear cache by pattern
      const body = await req.json();
      const { cacheType, provider, category, query, all } = body as ClearCacheParams;

      if (!cacheType && !provider && !category && !query && !all) {
        return errorResponse("Must specify at least one filter (cacheType, provider, category, query) or set all=true", 400);
      }

      const result = await clearDbCache(supabase, {
        cacheType,
        provider,
        category,
        query,
        all,
      }, requestId);

      // Log the action
      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        action_type: "CLEAR_CATALOG_CACHE",
        target_section: "catalog_cache",
        details: { cacheType, provider, category, query, all, result },
      });

      return jsonResponse({
        success: !result.error,
        deleted: result.deleted,
        error: result.error,
        message: result.error 
          ? `Failed to clear cache: ${result.error}` 
          : "Cache cleared successfully",
      });
    }

    return errorResponse("Method not allowed", 405);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[admin-cache-clear] Error:", message);
    return errorResponse(message, 500);
  }
});
