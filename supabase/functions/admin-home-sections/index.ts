/**
 * admin-home-sections
 * 
 * GET: Returns all home sections with seed/suggestion counts
 * POST: Update section (enabled, sort_order, titles)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAndGetUser, unauthorizedResponse, errorResponse } from "../_shared/auth.ts";
import { logAdminAction } from "../_shared/auditLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify admin
    const authResult = await verifyAndGetUser(req, supabase);
    if (!authResult.user) {
      return unauthorizedResponse(corsHeaders);
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", authResult.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return unauthorizedResponse(corsHeaders);
    }

    if (req.method === "GET") {
      // Get all sections with counts
      const { data: sections, error: sectionsError } = await supabase
        .from("home_sections")
        .select("*")
        .order("sort_order", { ascending: true });

      if (sectionsError) {
        console.error("[ADMIN_HOME_SECTIONS] Error fetching sections:", sectionsError);
        return errorResponse("Failed to fetch sections", corsHeaders);
      }

      // Get seed counts per section
      const { data: seedCounts } = await supabase
        .from("home_section_seeds")
        .select("section_key")
        .eq("enabled", true);

      const seedCountMap: Record<string, number> = {};
      for (const seed of seedCounts || []) {
        seedCountMap[seed.section_key] = (seedCountMap[seed.section_key] || 0) + 1;
      }

      // Get suggestion counts per section
      const { data: suggestionCounts } = await supabase
        .from("home_seed_suggestions")
        .select("section_key")
        .eq("approved", false);

      const suggestionCountMap: Record<string, number> = {};
      for (const suggestion of suggestionCounts || []) {
        suggestionCountMap[suggestion.section_key] = (suggestionCountMap[suggestion.section_key] || 0) + 1;
      }

      // Get seed mode setting
      const { data: seedModeSetting } = await supabase
        .from("admin_settings")
        .select("value")
        .eq("key", "home_seed_mode")
        .maybeSingle();

      const seedMode = seedModeSetting?.value || "manual";

      // Build response
      const enrichedSections = (sections || []).map(section => ({
        ...section,
        seed_count: seedCountMap[section.key] || 0,
        suggestion_count: suggestionCountMap[section.key] || 0,
      }));

      return new Response(
        JSON.stringify({
          ok: true,
          sections: enrichedSections,
          seed_mode: seedMode,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { key, enabled, sort_order, title_en, title_fr, see_all_query } = body;

      if (!key) {
        return new Response(
          JSON.stringify({ ok: false, error: "Section key is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build update object
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof enabled === "boolean") updates.enabled = enabled;
      if (typeof sort_order === "number") updates.sort_order = sort_order;
      if (title_en) updates.title_en = title_en;
      if (title_fr) updates.title_fr = title_fr;
      if (see_all_query) updates.see_all_query = see_all_query;

      const { error: updateError } = await supabase
        .from("home_sections")
        .update(updates)
        .eq("key", key);

      if (updateError) {
        console.error("[ADMIN_HOME_SECTIONS] Error updating section:", updateError);
        return errorResponse("Failed to update section", corsHeaders);
      }

      // Audit log
      await logAdminAction(supabase, {
        adminId: authResult.user.id,
        actionType: "UPDATE_HOME_SECTION",
        targetSection: "home_sections",
        targetId: key,
        details: updates,
      });

      return new Response(
        JSON.stringify({ ok: true, message: "Section updated" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ADMIN_HOME_SECTIONS] Error:", error);
    return errorResponse("Internal server error", corsHeaders);
  }
});
