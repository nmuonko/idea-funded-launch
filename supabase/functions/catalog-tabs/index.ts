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
 * Frontend should use this for:
 * - Drawer menu
 * - Home pills/chips
 * - Category screens
 */

import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";

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
// Single source of truth for all 9 category tabs

interface CategoryTab {
  key: string;
  title: string;
  icon: string;
  providerPriority: string[];
  allowLive: boolean;
  motorsOnlyVehicles?: boolean;
}

interface HomeSection {
  key: string;
  title: string;
  limit: number;
}

// The 9 unified category tabs matching eBay top nav
const CATEGORY_TABS: CategoryTab[] = [
  {
    key: "electronics",
    title: "Electronics",
    icon: "bolt",
    providerPriority: ["ebay", "rainforest"],
    allowLive: true,
  },
  {
    key: "motors",
    title: "Motors",
    icon: "car",
    providerPriority: ["ebay"],
    allowLive: true,
    motorsOnlyVehicles: true,
  },
  {
    key: "home_garden",
    title: "Home & Garden",
    icon: "home",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  {
    key: "clothing_shoes_accessories",
    title: "Clothing, Shoes & Accessories",
    icon: "shirt",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  {
    key: "toys",
    title: "Toys",
    icon: "puzzle",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  {
    key: "sporting_goods",
    title: "Sporting Goods",
    icon: "dumbbell",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  {
    key: "business_industrial",
    title: "Business & Industrial",
    icon: "factory",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  {
    key: "jewelry_watches",
    title: "Jewelry & Watches",
    icon: "watch",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  {
    key: "refurbished",
    title: "Refurbished",
    icon: "refresh-ccw",
    providerPriority: ["ebay"],
    allowLive: true,
  },
];

// Home sections to display on home screen
const HOME_SECTIONS: HomeSection[] = [
  { key: "electronics", title: "Electronics", limit: 10 },
  { key: "motors", title: "Motors", limit: 10 },
  { key: "home_garden", title: "Home & Garden", limit: 10 },
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
    const durationMs = Date.now() - startTime;
    console.log(`[CAT_TABS] requestId=${requestId} env=${envName} tabsCount=${CATEGORY_TABS.length} sectionsCount=${HOME_SECTIONS.length} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        tabs: CATEGORY_TABS,
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
