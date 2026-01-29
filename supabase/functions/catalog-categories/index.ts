/**
 * catalog-categories
 * Returns the list of enabled category tabs from catalog_categories table
 * Single source of truth for frontend tabs
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
};

interface CategoryRow {
  slug: string;
  title: string;
  group_title: string;
  icon: string | null;
  priority: number;
  enabled: boolean;
  provider_scope: string;
  queries: Record<string, unknown>;
}

interface CategoryResponse {
  key: string;
  title: string;
  groupTitle: string;
  icon: string | null;
  providers: string[];
  order: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const envName = getEnvironmentFromRequest(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch enabled categories ordered by priority
    const { data: rows, error } = await supabase
      .from("catalog_categories")
      .select("slug, title, group_title, icon, priority, provider_scope, queries")
      .eq("enabled", true)
      .order("priority", { ascending: true });

    if (error) {
      console.error("[CATALOG_CATEGORIES] DB error:", error);
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          categories: [],
          error: { message: "Failed to fetch categories", code: "DB_ERROR" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Transform to frontend-friendly format
    const categories: CategoryResponse[] = (rows || []).map((row: CategoryRow) => {
      // Determine providers from provider_scope and queries
      let providers: string[] = [];
      if (row.provider_scope === "all") {
        providers = ["ebay", "rainforest"];
      } else if (row.provider_scope === "ebay") {
        providers = ["ebay"];
      } else if (row.provider_scope === "rainforest") {
        providers = ["rainforest"];
      } else {
        // Check queries for enabled providers
        const queries = row.queries || {};
        if (queries.ebay && (queries.ebay as Record<string, unknown>).enabled !== false) {
          providers.push("ebay");
        }
        if (queries.rainforest && (queries.rainforest as Record<string, unknown>).enabled !== false) {
          providers.push("rainforest");
        }
      }

      return {
        key: row.slug,
        title: row.title,
        groupTitle: row.group_title,
        icon: row.icon,
        providers,
        order: row.priority,
      };
    });

    console.log(`[CATALOG_CATEGORIES] Returning ${categories.length} categories for env=${envName}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        categories,
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[CATALOG_CATEGORIES] Error:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        categories: [],
        error: { message: "Internal server error", code: "INTERNAL_ERROR" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
