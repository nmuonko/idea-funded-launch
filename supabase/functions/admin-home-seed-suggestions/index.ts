/**
 * admin-home-seed-suggestions
 * 
 * GET: List suggestions for a section
 * POST with action=generate: Generate suggestions from template library
 * POST with action=approve: Copy approved suggestions to home_section_seeds
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAndGetUser, unauthorizedResponse, errorResponse, AuthError } from "../_shared/auth.ts";
import { logAdminAction } from "../_shared/auditLog.ts";
import { getRandomTemplateQueries, getTemplateQueries } from "../_shared/homeSeedTemplates.ts";

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
        .from("home_seed_suggestions")
        .select("*")
        .order("score", { ascending: false })
        .order("created_at", { ascending: false });

      if (sectionKey) {
        query = query.eq("section_key", sectionKey);
      }

      const { data: suggestions, error } = await query;

      if (error) {
        console.error("[ADMIN_HOME_SUGGESTIONS] Error fetching suggestions:", error);
        return errorResponse("Failed to fetch suggestions", corsHeaders);
      }

      return new Response(
        JSON.stringify({ ok: true, suggestions: suggestions || [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action;

      if (action === "generate") {
        // Generate suggestions from template library
        const sectionKey = body.section_key;
        if (!sectionKey) {
          return new Response(
            JSON.stringify({ ok: false, error: "section_key is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get suggestion count setting
        const { data: countSetting } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "home_generate_suggestion_count")
          .maybeSingle();

        const suggestionCount = parseInt(countSetting?.value || "30", 10);

        // Get existing seeds to exclude
        const { data: existingSeeds } = await supabase
          .from("home_section_seeds")
          .select("query")
          .eq("section_key", sectionKey);

        const existingQueries = new Set((existingSeeds || []).map(s => s.query.toLowerCase()));

        // Get existing unapproved suggestions to exclude
        const { data: existingSuggestions } = await supabase
          .from("home_seed_suggestions")
          .select("query")
          .eq("section_key", sectionKey)
          .eq("approved", false);

        const existingSugQueries = new Set((existingSuggestions || []).map(s => s.query.toLowerCase()));

        // Get template queries and filter out existing ones
        const allTemplates = getTemplateQueries(sectionKey);
        const availableTemplates = allTemplates.filter(
          q => !existingQueries.has(q.toLowerCase()) && !existingSugQueries.has(q.toLowerCase())
        );

        // Shuffle and take N
        const shuffled = [...availableTemplates];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const selectedQueries = shuffled.slice(0, Math.min(suggestionCount, shuffled.length));

        // Insert suggestions
        const suggestionsToInsert = selectedQueries.map((query, index) => ({
          section_key: sectionKey,
          query,
          source: "template",
          score: selectedQueries.length - index, // Higher score for first items
          approved: false,
        }));

        if (suggestionsToInsert.length > 0) {
          const { error: insertError } = await supabase
            .from("home_seed_suggestions")
            .insert(suggestionsToInsert);

          if (insertError) {
            console.error("[ADMIN_HOME_SUGGESTIONS] Error inserting suggestions:", insertError);
            return errorResponse("Failed to generate suggestions", corsHeaders);
          }
        }

        await logAdminAction(supabase, {
          adminId: authResult.user.id,
          actionType: "GENERATE_HOME_SUGGESTIONS",
          targetSection: "home_seed_suggestions",
          targetId: sectionKey,
          details: { count: suggestionsToInsert.length },
        });

        return new Response(
          JSON.stringify({ 
            ok: true, 
            message: `Generated ${suggestionsToInsert.length} suggestions`,
            count: suggestionsToInsert.length,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (action === "approve") {
        // Copy approved suggestions to home_section_seeds
        const suggestionIds = body.suggestion_ids as string[];
        if (!suggestionIds || suggestionIds.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "suggestion_ids are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get the suggestions
        const { data: suggestions } = await supabase
          .from("home_seed_suggestions")
          .select("*")
          .in("id", suggestionIds);

        if (!suggestions || suggestions.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "No suggestions found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Insert as seeds
        const seedsToInsert = suggestions.map(s => ({
          section_key: s.section_key,
          query: s.query,
          enabled: true,
          weight: 100,
        }));

        const { error: insertError } = await supabase
          .from("home_section_seeds")
          .insert(seedsToInsert);

        if (insertError) {
          console.error("[ADMIN_HOME_SUGGESTIONS] Error inserting seeds:", insertError);
          return errorResponse("Failed to approve suggestions", corsHeaders);
        }

        // Mark suggestions as approved
        const { error: updateError } = await supabase
          .from("home_seed_suggestions")
          .update({ approved: true })
          .in("id", suggestionIds);

        if (updateError) {
          console.error("[ADMIN_HOME_SUGGESTIONS] Error updating suggestions:", updateError);
        }

        await logAdminAction(supabase, {
          adminId: authResult.user.id,
          actionType: "APPROVE_HOME_SUGGESTIONS",
          targetSection: "home_seed_suggestions",
          targetId: null,
          details: { count: suggestionIds.length, queries: suggestions.map(s => s.query) },
        });

        return new Response(
          JSON.stringify({ 
            ok: true, 
            message: `Approved ${suggestionIds.length} suggestions`,
            count: suggestionIds.length,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (action === "delete") {
        // Delete suggestions
        const suggestionIds = body.suggestion_ids as string[];
        if (!suggestionIds || suggestionIds.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "suggestion_ids are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: deleteError } = await supabase
          .from("home_seed_suggestions")
          .delete()
          .in("id", suggestionIds);

        if (deleteError) {
          console.error("[ADMIN_HOME_SUGGESTIONS] Error deleting suggestions:", deleteError);
          return errorResponse("Failed to delete suggestions", corsHeaders);
        }

        return new Response(
          JSON.stringify({ ok: true, message: `Deleted ${suggestionIds.length} suggestions` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: false, error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ADMIN_HOME_SUGGESTIONS] Error:", error);
    return errorResponse("Internal server error", corsHeaders);
  }
});
