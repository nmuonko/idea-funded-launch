/**
 * Admin Search Rewrites Management Endpoint
 * 
 * GET    - List all rewrite rules (with optional filters)
 * POST   - Create new rewrite rule
 * PUT    - Update existing rule
 * DELETE - Delete rule
 */

import { createClient } from "@supabase/supabase-js";
import { verifyAndGetUser, handleCors, errorResponse, jsonResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const url = new URL(req.url);

    // ─── GET: List rules ──────────────────────────────────────────────────────
    if (req.method === "GET") {
      const lang = url.searchParams.get("lang") || null;
      const categoryKey = url.searchParams.get("category_key") || null;
      const enabledOnly = url.searchParams.get("enabled") === "true";
      const search = url.searchParams.get("search") || null;

      let query = supabase
        .from("search_rewrites")
        .select("*")
        .order("priority", { ascending: false })
        .order("pattern", { ascending: true });

      if (lang) {
        query = query.eq("lang", lang);
      }
      if (categoryKey) {
        query = query.eq("category_key", categoryKey);
      }
      if (enabledOnly) {
        query = query.eq("enabled", true);
      }
      if (search) {
        query = query.or(`pattern.ilike.%${search}%,rewrite.ilike.%${search}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`[ADMIN_REWRITES] requestId=${requestId} Error:`, error.message);
        return errorResponse(error.message, 500);
      }

      // Get stats
      const { count: totalCount } = await supabase
        .from("search_rewrites")
        .select("*", { count: "exact", head: true });

      const { count: enabledCount } = await supabase
        .from("search_rewrites")
        .select("*", { count: "exact", head: true })
        .eq("enabled", true);

      return jsonResponse({
        success: true,
        rules: data || [],
        stats: {
          total: totalCount || 0,
          enabled: enabledCount || 0,
          disabled: (totalCount || 0) - (enabledCount || 0),
        },
      });
    }

    // ─── POST: Create rule ────────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const { lang, pattern, rewrite, categoryKey, priority, enabled, notes } = body;

      if (!pattern || !rewrite) {
        return errorResponse("pattern and rewrite are required", 400);
      }

      const { data, error } = await supabase
        .from("search_rewrites")
        .insert({
          lang: lang || "fr",
          pattern: pattern.toLowerCase().trim(),
          rewrite: rewrite.trim(),
          category_key: categoryKey || null,
          priority: priority ?? 50,
          enabled: enabled ?? true,
          notes: notes || null,
        })
        .select()
        .single();

      if (error) {
        console.error(`[ADMIN_REWRITES] requestId=${requestId} Create error:`, error.message);
        if (error.code === "23505") {
          return errorResponse("A rule with this pattern already exists for this language/category", 409);
        }
        return errorResponse(error.message, 500);
      }

      // Log the action
      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        action_type: "CREATE_SEARCH_REWRITE",
        target_section: "search_rewrites",
        target_id: data.id,
        details: { pattern, rewrite, categoryKey, priority },
      });

      return jsonResponse({ success: true, rule: data });
    }

    // ─── PUT: Update rule ─────────────────────────────────────────────────────
    if (req.method === "PUT") {
      const body = await req.json();
      const { id, pattern, rewrite, categoryKey, priority, enabled, notes } = body;

      if (!id) {
        return errorResponse("id is required", 400);
      }

      const updateData: Record<string, unknown> = {};
      if (pattern !== undefined) updateData.pattern = pattern.toLowerCase().trim();
      if (rewrite !== undefined) updateData.rewrite = rewrite.trim();
      if (categoryKey !== undefined) updateData.category_key = categoryKey || null;
      if (priority !== undefined) updateData.priority = priority;
      if (enabled !== undefined) updateData.enabled = enabled;
      if (notes !== undefined) updateData.notes = notes || null;

      const { data, error } = await supabase
        .from("search_rewrites")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error(`[ADMIN_REWRITES] requestId=${requestId} Update error:`, error.message);
        return errorResponse(error.message, 500);
      }

      // Log the action
      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        action_type: "UPDATE_SEARCH_REWRITE",
        target_section: "search_rewrites",
        target_id: id,
        details: updateData,
      });

      return jsonResponse({ success: true, rule: data });
    }

    // ─── DELETE: Delete rule ──────────────────────────────────────────────────
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");

      if (!id) {
        return errorResponse("id is required", 400);
      }

      // Get rule before deleting for audit
      const { data: existing } = await supabase
        .from("search_rewrites")
        .select("pattern, rewrite")
        .eq("id", id)
        .single();

      const { error } = await supabase
        .from("search_rewrites")
        .delete()
        .eq("id", id);

      if (error) {
        console.error(`[ADMIN_REWRITES] requestId=${requestId} Delete error:`, error.message);
        return errorResponse(error.message, 500);
      }

      // Log the action
      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        action_type: "DELETE_SEARCH_REWRITE",
        target_section: "search_rewrites",
        target_id: id,
        details: { deletedRule: existing },
      });

      return jsonResponse({ success: true, deleted: id });
    }

    return errorResponse("Method not allowed", 405);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ADMIN_REWRITES] requestId=${requestId} Error:`, message);
    return errorResponse(message, 500);
  }
});
