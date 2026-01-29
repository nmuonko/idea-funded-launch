/**
 * catalog-categories
 * Returns the list of category tabs from backend (single source of truth)
 * 
 * ALWAYS returns HTTP 200 with stable JSON shape:
 * { status: "success", env, categories: [...], aliases: {...}, error: null }
 * 
 * TOP-LEVEL TABS (in order):
 * - electronics
 * - vehicles (NEW - top-level, for actual vehicles ONLY)
 * - home_garden
 * - clothing_shoes_accessories
 * - toys
 * - sporting_goods
 * - business_industrial
 * - jewelry_watches
 * - refurbished
 * - parts_accessories (for automotive parts, NOT vehicles)
 * 
 * REMOVED:
 * - "motors" as top-level (split into "vehicles" and "parts_accessories")
 * - "secure_purchase" (completely removed)
 */

import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { TABS, CATEGORY_ALIASES } from "../_shared/categoryMapper.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=300",
};

interface CategoryResponse {
  key: string;
  title: string;
  icon: string | null;
  order: number;
  listingType?: "vehicle" | "part";
  children?: { key: string; title: string; icon?: string; enabled?: boolean }[];
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
    console.error(`[CAT_CATEGORIES] requestId=${requestId} error=BAD_ENV env=${envName}`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        categories: [],
        aliases: {},
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[CAT_CATEGORIES] requestId=${requestId} env=${envName} method=${req.method}`);

  try {
    // Return the fixed TABS list from categoryMapper (single source of truth)
    const categories: CategoryResponse[] = TABS.map((tab, index) => {
      const category: CategoryResponse = {
        key: tab.key,
        title: tab.title,
        icon: tab.icon || null,
        order: index + 1,
      };

      // Add listing type for vehicles and parts
      if (tab.listingType) {
        category.listingType = tab.listingType;
      }

      // Add children (subcategories) if present
      if (tab.subcategories && tab.subcategories.length > 0) {
        category.children = tab.subcategories.map(sub => ({
          key: sub.key,
          title: sub.title,
          icon: sub.icon,
          enabled: sub.enabled !== false,
        }));
      }

      return category;
    });

    const durationMs = Date.now() - startTime;
    console.log(`[CAT_CATEGORIES] requestId=${requestId} env=${envName} count=${categories.length} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        categories,
        aliases: CATEGORY_ALIASES,
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const errorStack = err instanceof Error ? err.stack : undefined;
    const durationMs = Date.now() - startTime;
    
    console.error(`[CAT_CATEGORIES] requestId=${requestId} env=${envName} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);
    if (errorStack) {
      console.error(`[CAT_CATEGORIES] requestId=${requestId} stack=${errorStack}`);
    }

    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        categories: [],
        aliases: {},
        error: { message: "Internal server error", code: "INTERNAL_ERROR" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
