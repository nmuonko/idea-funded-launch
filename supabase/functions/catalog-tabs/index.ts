/**
 * catalog-tabs
 * Returns the unified list of category tabs (single source of truth)
 * 
 * ALWAYS returns HTTP 200 with stable JSON shape:
 * {
 *   status: "success",
 *   env,
 *   tabs: [...],
 *   homeSections: [...],
 *   error: null
 * }
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
 * 
 * Frontend should use this for:
 * - Drawer menu
 * - Home pills/chips
 * - Category screens
 */

import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { 
  TABS, 
  VEHICLES_SUBCATEGORIES, 
  PARTS_SUBCATEGORIES,
  ELECTRONICS_SUBCATEGORIES_LIST,
} from "../_shared/categoryMapper.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=300",
};

// ─── Category Tab Definitions ────────────────────────────────────────────────

interface CategoryTabResponse {
  key: string;
  title: string;
  icon: string;
  providerPriority: string[];
  allowLive: boolean;
  listingType?: "vehicle" | "part";
  children?: { key: string; title: string; icon?: string; enabled?: boolean }[];
}

interface HomeSection {
  key: string;
  title: string;
  limit: number;
}

// Home sections to display on home screen
const HOME_SECTIONS: HomeSection[] = [
  { key: "electronics", title: "Electronics", limit: 10 },
  { key: "vehicles", title: "Vehicles", limit: 10 },
  { key: "home_garden", title: "Home & Garden", limit: 10 },
  { key: "clothing_shoes_accessories", title: "Clothing", limit: 10 },
];

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
    console.error(`[CAT_TABS] requestId=${requestId} error=BAD_ENV env=${envName}`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        tabs: [],
        homeSections: [],
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[CAT_TABS] requestId=${requestId} env=${envName} method=${req.method}`);

  try {
    // Build response tabs from categoryMapper TABS
    const responseTabs: CategoryTabResponse[] = TABS.map(tab => {
      const responseTab: CategoryTabResponse = {
        key: tab.key,
        title: tab.title,
        icon: tab.icon || "package",
        providerPriority: tab.providerPriority || ["ebay"],
        allowLive: tab.allowLive !== false,
      };

      // Add listing type for vehicles and parts
      if (tab.listingType) {
        responseTab.listingType = tab.listingType;
      }

      // Add children (subcategories) if present
      if (tab.subcategories && tab.subcategories.length > 0) {
        responseTab.children = tab.subcategories.map(sub => ({
          key: sub.key,
          title: sub.title,
          icon: sub.icon,
          enabled: sub.enabled !== false, // Default to true if not specified
        }));
      }

      return responseTab;
    });

    const durationMs = Date.now() - startTime;
    console.log(`[CAT_TABS] requestId=${requestId} env=${envName} tabsCount=${responseTabs.length} sectionsCount=${HOME_SECTIONS.length} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        tabs: responseTabs,
        homeSections: HOME_SECTIONS,
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const durationMs = Date.now() - startTime;
    
    console.error(`[CAT_TABS] requestId=${requestId} env=${envName} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        tabs: [],
        homeSections: [],
        error: { message: "Internal server error", code: "INTERNAL_ERROR" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
