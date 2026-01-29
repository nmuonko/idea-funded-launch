/**
 * catalog-categories
 * Returns the list of enabled category tabs from catalog_categories table
 * Single source of truth for frontend tabs
 * 
 * ALWAYS returns HTTP 200 with stable JSON shape
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
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

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  let envName: EnvironmentName = "production";

  try {
    envName = getEnvironmentFromRequest(req);
  } catch {
    envName = "production";
  }

  // Validate environment
  if (!ALLOWED_ENVS.includes(envName)) {
    console.error(`[CATALOG_CATEGORIES_API] requestId=${requestId} error=BAD_ENV env=${envName}`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        categories: [],
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[CATALOG_CATEGORIES_API] requestId=${requestId} env=${envName} method=${req.method}`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error(`[CATALOG_CATEGORIES_API] requestId=${requestId} error=MISSING_CONFIG`);
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          categories: [],
          error: { message: "Backend configuration error", code: "CONFIG_ERROR" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch enabled categories ordered by priority
    const { data: rows, error } = await supabase
      .from("catalog_categories")
      .select("slug, title, group_title, icon, priority, provider_scope, queries")
      .eq("enabled", true)
      .order("priority", { ascending: true });

    if (error) {
      console.error(`[CATALOG_CATEGORIES_API] requestId=${requestId} error=DB_ERROR message=${error.message}`);
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

    const durationMs = Date.now() - startTime;
    console.log(`[CATALOG_CATEGORIES_API] requestId=${requestId} env=${envName} count=${categories.length} durationMs=${durationMs}`);

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
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const errorStack = err instanceof Error ? err.stack : undefined;
    const durationMs = Date.now() - startTime;
    
    console.error(`[CATALOG_CATEGORIES_API] requestId=${requestId} env=${envName} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);
    if (errorStack) {
      console.error(`[CATALOG_CATEGORIES_API] requestId=${requestId} stack=${errorStack}`);
    }

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