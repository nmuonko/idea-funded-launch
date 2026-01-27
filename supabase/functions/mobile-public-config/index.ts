// Mobile Public Config Endpoint - OPTIMIZED FOR 10K+ USERS
// Returns cart configuration for guest users (exchange rate, markup, shipping)
// PUBLIC: No JWT required - callable with apikey only
// Source of truth: `settings` table with aggressive caching

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { coalesce, CACHE_TTL, makeCacheKey } from "../_shared/responseCache.ts";
import { withLoadShedding, getEndpointPriority, LoadSheddingError, loadSheddingResponse } from "../_shared/loadShedding.ts";
import { getEnvironmentFromRequest, getEnvironmentConfig, EnvironmentConfig } from "../_shared/environmentResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
};

interface PublicConfigResponse {
  success: boolean;
  configValid: boolean;
  reason?: string;
  exchangeRate: number;
  markup: {
    type: "percent" | "fixed";
    value: number;
    vehicleValue?: number;
  };
  shipping: {
    mode: "flat" | "percent" | "combined";
    flatUsd: number;
    percentValue: number;
  };
  serviceFee: {
    percent: number;
    minUsd: number;
  };
  limits: {
    maishapayMaxUsd: number;
    maishapayMaxCdf: number;
  };
  currency: string;
  updated_at: string;
  version: number;
  
  // NEW: Catalog configuration
  catalog: {
    enabled: boolean;
    mode: "webview" | "native" | "hybrid";
    apiBaseUrl: string;
    providers: string[];
    refreshIntervalMs: number;
  };
  
  // NEW: Environment info
  env: {
    name: "production" | "staging";
    minSupportedAppVersion: string;
    ota: {
      enabled: boolean;
      channel: string;
    };
  };
}

async function fetchConfig(envName: "production" | "staging"): Promise<PublicConfigResponse> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch settings and environment config in parallel
  const [settingsResult, envConfig, providersResult] = await Promise.all([
    supabase
      .from("settings")
      .select(`
        exchange_rate_usd_to_cdf,
        markup_percent,
        global_markup_percent,
        category_markups,
        shipping_base_fee_usd,
        shipping_percent,
        service_fee_percent,
        min_service_fee_usd,
        maishapay_max_usd,
        maishapay_max_cdf,
        updated_at
      `)
      .limit(1)
      .maybeSingle(),
    getEnvironmentConfig(supabase, envName),
    supabase
      .from("catalog_providers")
      .select("name")
      .eq("enabled", true)
      .or(`environment.eq.all,environment.eq.${envName}`),
  ]);

  const { data: settings, error } = settingsResult;
  const enabledProviders = (providersResult.data || []).map(p => p.name);

  if (error) {
    console.error("[mobile-public-config] Database error:", error.message);
    throw new Error(`DATABASE_ERROR: ${error.message}`);
  }

  // Build catalog config from environment
  const catalogConfig = {
    enabled: envConfig?.catalog_enabled ?? false,
    mode: (envConfig?.catalog_mode ?? "webview") as "webview" | "native" | "hybrid",
    apiBaseUrl: envConfig?.api_base_url ?? "",
    providers: enabledProviders,
    refreshIntervalMs: 300000, // 5 minutes
  };

  // Build env info from environment
  const envInfo = {
    name: envName,
    minSupportedAppVersion: envConfig?.min_app_version ?? "1.0.0",
    ota: {
      enabled: envConfig?.ota_enabled ?? true,
      channel: envConfig?.ota_channel ?? envName,
    },
  };

  if (!settings) {
    console.warn("[mobile-public-config] No settings found - returning defaults");
    return {
      success: true,
      configValid: false,
      reason: "NO_SETTINGS_CONFIGURED",
      exchangeRate: 2500,
      markup: { type: "percent", value: 10 },
      shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
      serviceFee: { percent: 0.12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
      catalog: catalogConfig,
      env: envInfo,
    };
  }

  const exchangeRate = settings.exchange_rate_usd_to_cdf;
  if (!exchangeRate || exchangeRate <= 0) {
    console.error("[mobile-public-config] Invalid exchange rate:", exchangeRate);
    return {
      success: true,
      configValid: false,
      reason: "MISSING_EXCHANGE_RATE",
      exchangeRate: 2500,
      markup: { type: "percent", value: 10 },
      shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
      serviceFee: { percent: 0.12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
      catalog: catalogConfig,
      env: envInfo,
    };
  }

  // UNIFIED PARSING LOGIC for all percentage values
  const normalizePercent = (val: number | null | undefined, fallback: number): number => {
    const raw = val ?? fallback;
    return raw;
  };

  // Markup: use markup_percent first, fallback to global_markup_percent
  const markupRaw = settings.markup_percent ?? settings.global_markup_percent ?? 15;
  const markupPercent = normalizePercent(markupRaw, 15);

  const categoryMarkups = (settings.category_markups || {}) as Record<string, number>;
  const vehicleMarkupRaw = categoryMarkups.vehicles;
  const vehicleMarkupPercent = vehicleMarkupRaw !== undefined 
    ? normalizePercent(vehicleMarkupRaw, markupPercent)
    : markupPercent;

  // Shipping percent - stored as whole number (10 = 10%)
  const shippingPercentRaw = settings.shipping_percent ?? 10;
  const shippingPercentValue = normalizePercent(shippingPercentRaw, 10);
  const shippingBaseFee = settings.shipping_base_fee_usd ?? 20;

  // Service fee percent - stored as whole number (12 = 12%)
  const serviceFeeRaw = settings.service_fee_percent ?? 12;
  const serviceFeePercentValue = normalizePercent(serviceFeeRaw, 12);

  const updatedAt = settings.updated_at || new Date().toISOString();
  const version = new Date(updatedAt).getTime();

  console.log("[mobile-public-config] Parsed config:", {
    envName,
    markupRaw, markupPercent,
    vehicleMarkupRaw, vehicleMarkupPercent,
    shippingPercentRaw, shippingPercentValue, shippingBaseFee,
    serviceFeeRaw, serviceFeePercentValue,
    catalogEnabled: catalogConfig.enabled,
    catalogMode: catalogConfig.mode,
  });

  // CRITICAL: Mobile app expects markup as WHOLE NUMBERS (e.g., 30.2 for 30.2%)
  const markupWholeNumber = Number(markupPercent);
  const vehicleMarkupWholeNumber = Number(vehicleMarkupPercent);
  const shippingPercentDecimal = Number(shippingPercentValue) / 100;
  const serviceFeeDecimal = Number(serviceFeePercentValue) / 100;

  return {
    success: true,
    configValid: true,
    exchangeRate: Number(exchangeRate),
    markup: {
      type: "percent",
      value: markupWholeNumber,
      vehicleValue: vehicleMarkupWholeNumber,
    },
    shipping: {
      mode: shippingBaseFee > 0 && shippingPercentValue > 0 ? "combined" : 
            shippingBaseFee > 0 ? "flat" : "percent",
      flatUsd: Number(shippingBaseFee),
      percentValue: shippingPercentDecimal,
    },
    serviceFee: {
      percent: serviceFeeDecimal,
      minUsd: Number(settings.min_service_fee_usd ?? 5),
    },
    limits: {
      maishapayMaxUsd: Number(settings.maishapay_max_usd ?? 5000),
      maishapayMaxCdf: Number(settings.maishapay_max_cdf ?? 30000000),
    },
    currency: "USD",
    updated_at: updatedAt,
    version,
    catalog: catalogConfig,
    env: envInfo,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const priority = getEndpointPriority("mobile-public-config");

  try {
    // Detect environment from request
    const envName = getEnvironmentFromRequest(req);
    const cacheKey = `public-config:${envName}`;

    const response = await withLoadShedding(priority, async () => {
      return coalesce(cacheKey, () => fetchConfig(envName), CACHE_TTL.PUBLIC_CONFIG);
    });

    console.log("[mobile-public-config] Returning config for env:", envName, "version:", response.version);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    if (err instanceof LoadSheddingError) {
      return loadSheddingResponse(err, corsHeaders);
    }

    console.error("[mobile-public-config] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        configValid: false,
        reason: "INTERNAL_ERROR",
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
