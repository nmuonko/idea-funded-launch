/**
 * admin-home-seeds
 * 
 * GET: Returns seeds for a section sorted by weight
 * POST: Upsert seed (add/edit)
 * DELETE: Remove seed by ID
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAndGetUser, unauthorizedResponse, errorResponse, AuthError } from "../_shared/auth.ts";
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
    let authResult;
    try {
      authResult = await verifyAndGetUser(req, supabase);
    } catch (authError) {
      if (authError instanceof AuthError) {
        return unauthorizedResponse(corsHeaders);
      }
      throw authError;
    }
    
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

    const url = new URL(req.url);

    if (req.method === "GET") {
      const sectionKey = url.searchParams.get("section_key");

      let query = supabase
        .from("home_section_seeds")
        .select("*")
        .order("weight", { ascending: false });

      if (sectionKey) {
        query = query.eq("section_key", sectionKey);
      }

      const { data: seeds, error } = await query;

      if (error) {
        console.error("[ADMIN_HOME_SEEDS] Error fetching seeds:", error);
        return errorResponse("Failed to fetch seeds", corsHeaders);
      }

      return new Response(
        JSON.stringify({ ok: true, seeds: seeds || [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { id, section_key, query, enabled, weight } = body;

      if (!section_key || !query) {
        return new Response(
          JSON.stringify({ ok: false, error: "section_key and query are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (id) {
        // Update existing seed
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (query) updates.query = query;
        if (typeof enabled === "boolean") updates.enabled = enabled;
        if (typeof weight === "number") updates.weight = weight;

        const { error: updateError } = await supabase
          .from("home_section_seeds")
          .update(updates)
          .eq("id", id);

        if (updateError) {
          console.error("[ADMIN_HOME_SEEDS] Error updating seed:", updateError);
          return errorResponse("Failed to update seed", corsHeaders);
        }

        await logAdminAction(supabase, {
          adminId: authResult.user.id,
          actionType: "UPDATE_HOME_SEED",
          targetSection: "home_section_seeds",
          targetId: id,
          details: { section_key, query, enabled, weight },
        });

        return new Response(
          JSON.stringify({ ok: true, message: "Seed updated" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // Insert new seed
        const { data: newSeed, error: insertError } = await supabase
          .from("home_section_seeds")
          .insert({
            section_key,
            query,
            enabled: enabled ?? true,
            weight: weight ?? 100,
          })
          .select()
          .single();

        if (insertError) {
          console.error("[ADMIN_HOME_SEEDS] Error inserting seed:", insertError);
          return errorResponse("Failed to add seed", corsHeaders);
        }

        await logAdminAction(supabase, {
          adminId: authResult.user.id,
          actionType: "ADD_HOME_SEED",
          targetSection: "home_section_seeds",
          targetId: newSeed.id,
          details: { section_key, query },
        });

        return new Response(
          JSON.stringify({ ok: true, seed: newSeed }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (req.method === "DELETE") {
      let body;
      try {
        body = await req.json();
      } catch (parseError) {
        console.error("[ADMIN_HOME_SEEDS] Error parsing DELETE body:", parseError);
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid request body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const { id, ids } = body;

      // Support both single and bulk delete
      const idsToDelete: string[] = ids ? ids : (id ? [id] : []);

      console.log("[ADMIN_HOME_SEEDS] Delete request for", idsToDelete.length, "seeds:", idsToDelete);

      if (idsToDelete.length === 0) {
        return new Response(
          JSON.stringify({ ok: false, error: "Seed ID(s) required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const invalidIds = idsToDelete.filter(id => !uuidRegex.test(id));
      if (invalidIds.length > 0) {
        console.error("[ADMIN_HOME_SEEDS] Invalid UUIDs:", invalidIds);
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid seed ID format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get seed info before deleting for audit log
      const { data: seedsInfo, error: fetchError } = await supabase
        .from("home_section_seeds")
        .select("id, section_key, query")
        .in("id", idsToDelete);

      if (fetchError) {
        console.error("[ADMIN_HOME_SEEDS] Error fetching seeds for delete:", fetchError);
      }

      console.log("[ADMIN_HOME_SEEDS] Found", seedsInfo?.length || 0, "seeds to delete");

      const { error: deleteError } = await supabase
        .from("home_section_seeds")
        .delete()
        .in("id", idsToDelete);

      if (deleteError) {
        console.error("[ADMIN_HOME_SEEDS] Error deleting seed(s):", deleteError);
        return new Response(
          JSON.stringify({ ok: false, error: `Failed to delete: ${deleteError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[ADMIN_HOME_SEEDS] Successfully deleted seeds");

      // Log bulk or single delete action
      const isBulk = idsToDelete.length > 1;
      try {
        await logAdminAction(supabase, {
          adminId: authResult.user.id,
          actionType: isBulk ? "BULK_DELETE_HOME_SEEDS" : "DELETE_HOME_SEED",
          targetSection: "home_section_seeds",
          targetId: isBulk ? null : idsToDelete[0],
          details: isBulk 
            ? { count: idsToDelete.length, seeds: seedsInfo || [] }
            : (seedsInfo?.[0] || {}),
        });
      } catch (auditError) {
        console.error("[ADMIN_HOME_SEEDS] Audit log error (non-fatal):", auditError);
      }

      return new Response(
        JSON.stringify({ 
          ok: true, 
          message: isBulk ? `${idsToDelete.length} seeds deleted` : "Seed deleted",
          count: idsToDelete.length 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ADMIN_HOME_SEEDS] Error:", error);
    return errorResponse("Internal server error", corsHeaders);
  }
});
