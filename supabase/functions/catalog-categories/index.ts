/**
 * catalog-categories
 * Returns the navigation tabs and subtabs from database (single source of truth)
 * 
 * ALWAYS returns HTTP 200 with stable JSON shape:
 * { status: "success", env, tabs: [...], error: null }
 * 
 * Each tab includes its subtabs for easy frontend consumption.
 * 
 * TOP-LEVEL TABS:
 * - electronics
 * - vehicles
 * - home_garden
 * - clothing_shoes_accessories
 * - toys
 * - sporting_goods
 * - business_industrial
 * - jewelry_watches
 * - refurbished
 * - parts_accessories
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { 
  CANONICAL_TABS, 
  CANONICAL_SUBTABS,
  getCategoryMeta,
} from "../_shared/categoryRegistry.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=300",
};

interface SubtabResponse {
  key: string;
  title_en: string;
  title_fr: string;
  order: number;
  enabled: boolean;
  is_vehicle?: boolean;
  is_parts?: boolean;
  min_price_usd?: number | null;
}

interface TabResponse {
  key: string;
  title_en: string;
  title_fr: string;
  icon: string | null;
  order: number;
  enabled: boolean;
  subtabs: SubtabResponse[];
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// Build fallback tabs from canonical registry
function buildFallbackTabs(): TabResponse[] {
  const iconMap: Record<string, string> = {
    electronics: "Smartphone",
    vehicles: "Car",
    home_garden: "Home",
    clothing_shoes_accessories: "Shirt",
    toys: "Gamepad2",
    sporting_goods: "Dumbbell",
    business_industrial: "Building",
    jewelry_watches: "Watch",
    refurbished: "RefreshCw",
    parts_accessories: "Wrench",
  };

  return CANONICAL_TABS.map((tabKey, index) => {
    const meta = getCategoryMeta(tabKey);
    const subtabKeys = CANONICAL_SUBTABS[tabKey] || [];
    
    return {
      key: tabKey,
      title_en: meta?.titleEn || tabKey,
      title_fr: meta?.titleFr || tabKey,
      icon: iconMap[tabKey] || null,
      order: index + 1,
      enabled: true,
      subtabs: subtabKeys.map((subKey, subIndex) => {
        const subMeta = getCategoryMeta(subKey);
        return {
          key: subKey,
          title_en: subMeta?.titleEn || subKey,
          title_fr: subMeta?.titleFr || subKey,
          order: subIndex,
          enabled: true,
          is_vehicle: subMeta?.isVehicle || false,
          is_parts: subMeta?.isParts || false,
          min_price_usd: subMeta?.minPrice || null,
        };
      }),
    };
  });
}

const FALLBACK_TABS = buildFallbackTabs();

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
    console.error(`[NAV] requestId=${requestId} error=BAD_ENV env=${envName}`);
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        tabs: FALLBACK_TABS,
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[NAV] requestId=${requestId} env=${envName} method=${req.method}`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.warn(`[NAV] requestId=${requestId} No Supabase config, using fallback`);
      return new Response(
        JSON.stringify({
          status: "success",
          env: envName,
          tabs: FALLBACK_TABS,
          error: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch tabs from database
    const { data: tabsData, error: tabsError } = await supabase
      .from("catalog_nav_tabs")
      .select("*")
      .eq("enabled", true)
      .order("order_index", { ascending: true });

    if (tabsError) {
      console.error(`[NAV] requestId=${requestId} tabs error:`, tabsError.message);
      return new Response(
        JSON.stringify({
          status: "success",
          env: envName,
          tabs: FALLBACK_TABS,
          warning: { message: "Failed to load tabs from DB, using fallback", code: "DB_ERROR" },
          error: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch subtabs from database
    const { data: subtabsData, error: subtabsError } = await supabase
      .from("catalog_nav_subtabs")
      .select("*")
      .eq("enabled", true)
      .order("order_index", { ascending: true });

    if (subtabsError) {
      console.error(`[NAV] requestId=${requestId} subtabs error:`, subtabsError.message);
    }

    // Group subtabs by parent
    const subtabsByParent: Record<string, SubtabResponse[]> = {};
    if (subtabsData) {
      for (const sub of subtabsData) {
        if (!subtabsByParent[sub.parent_key]) {
          subtabsByParent[sub.parent_key] = [];
        }
        subtabsByParent[sub.parent_key].push({
          key: sub.key,
          title_en: sub.title_en,
          title_fr: sub.title_fr,
          order: sub.order_index,
          enabled: sub.enabled,
          is_vehicle: sub.is_vehicle || false,
          is_parts: sub.is_parts || false,
          min_price_usd: sub.min_price_usd,
        });
      }
    }

    // Build response
    const tabs: TabResponse[] = (tabsData || []).map(tab => ({
      key: tab.key,
      title_en: tab.title_en,
      title_fr: tab.title_fr,
      icon: tab.icon,
      order: tab.order_index,
      enabled: tab.enabled,
      subtabs: subtabsByParent[tab.key] || [],
    }));

    // If no tabs found, use fallback
    if (tabs.length === 0) {
      console.warn(`[NAV] requestId=${requestId} No tabs in DB, using fallback`);
      return new Response(
        JSON.stringify({
          status: "success",
          env: envName,
          tabs: FALLBACK_TABS,
          warning: { message: "No tabs configured, using defaults", code: "NO_TABS" },
          error: null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const durationMs = Date.now() - startTime;
    console.log(`[NAV] requestId=${requestId} env=${envName} tabCount=${tabs.length} subtabCount=${subtabsData?.length || 0} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        tabs,
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const durationMs = Date.now() - startTime;
    
    console.error(`[NAV] requestId=${requestId} env=${envName} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        tabs: FALLBACK_TABS,
        warning: { message: "Internal error, using fallback", code: "INTERNAL_ERROR" },
        error: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
