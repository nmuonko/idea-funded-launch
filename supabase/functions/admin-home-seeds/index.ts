/**
 * admin-home-seeds
 * 
 * GET: Returns seeds for a section sorted by weight
 * POST: Upsert seed (add/edit)
 * DELETE: Remove seed by ID
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
      const body = await req.json();
      const { id } = body;

      if (!id) {
        return new Response(
          JSON.stringify({ ok: false, error: "Seed ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get seed info before deleting
      const { data: seedInfo } = await supabase
        .from("home_section_seeds")
        .select("section_key, query")
        .eq("id", id)
        .single();

      const { error: deleteError } = await supabase
        .from("home_section_seeds")
        .delete()
        .eq("id", id);

      if (deleteError) {
        console.error("[ADMIN_HOME_SEEDS] Error deleting seed:", deleteError);
        return errorResponse("Failed to delete seed", corsHeaders);
      }

      await logAdminAction(supabase, {
        adminId: authResult.user.id,
        actionType: "DELETE_HOME_SEED",
        targetSection: "home_section_seeds",
        targetId: id,
        details: seedInfo || {},
      });

      return new Response(
        JSON.stringify({ ok: true, message: "Seed deleted" }),
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
