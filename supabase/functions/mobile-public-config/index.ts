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
  // TOP-LEVEL env fields for mobile debugging
  env: "production" | "staging";
  catalogEnabled: boolean;
  catalogMode: "webview" | "native" | "hybrid";
  // Standard config
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
  
  // Catalog configuration (detailed)
  catalog: {
    enabled: boolean;
    mode: "webview" | "native" | "hybrid";
    apiBaseUrl: string;
    providers: string[];
    refreshIntervalMs: number;
  };
  
  // Environment details (full info)
  envDetails: {
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
      env: envName,
      catalogEnabled: catalogConfig.enabled,
      catalogMode: catalogConfig.mode,
      exchangeRate: 2500,
      markup: { type: "percent", value: 10 },
      shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
      serviceFee: { percent: 0.12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
      catalog: catalogConfig,
      envDetails: envInfo,
    };
  }

  const exchangeRate = settings.exchange_rate_usd_to_cdf;
  if (!exchangeRate || exchangeRate <= 0) {
    console.error("[mobile-public-config] Invalid exchange rate:", exchangeRate);
    return {
      success: true,
      configValid: false,
      reason: "MISSING_EXCHANGE_RATE",
      env: envName,
      catalogEnabled: catalogConfig.enabled,
      catalogMode: catalogConfig.mode,
      exchangeRate: 2500,
      markup: { type: "percent", value: 10 },
      shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
      serviceFee: { percent: 0.12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
      catalog: catalogConfig,
      envDetails: envInfo,
    };
  }

  // UNIFIED PARSING LOGIC for all percentage values
  // Database may store as decimal (0.12) or whole number (12)
  // We normalize to whole numbers: 0.12 → 12, 10 → 10
  const normalizeToWholePercent = (val: number | null | undefined, fallback: number): number => {
    const raw = val ?? fallback;
    // If value is less than 1, it's likely a decimal (0.12 = 12%)
    // Exception: values between 0.01 and 1 could be tiny percentages like 0.5%
    // Heuristic: if raw < 1 AND raw > 0, multiply by 100 to get whole number
    if (raw > 0 && raw < 1) {
      return raw * 100; // 0.12 → 12, 0.1 → 10
    }
    return raw; // Already whole number: 10 → 10, 30.2 → 30.2
  };

  // Markup: use markup_percent first, fallback to global_markup_percent
  const markupRaw = settings.markup_percent ?? settings.global_markup_percent ?? 15;
  const markupPercent = normalizeToWholePercent(markupRaw, 15);

  const categoryMarkups = (settings.category_markups || {}) as Record<string, number>;
  const vehicleMarkupRaw = categoryMarkups.vehicles;
  const vehicleMarkupPercent = vehicleMarkupRaw !== undefined 
    ? normalizeToWholePercent(vehicleMarkupRaw, markupPercent)
    : markupPercent;

  // Shipping percent - stored as whole number (10 = 10%)
  const shippingPercentRaw = settings.shipping_percent ?? 10;
  const shippingPercentValue = normalizeToWholePercent(shippingPercentRaw, 10);
  const shippingBaseFee = settings.shipping_base_fee_usd ?? 20;

  // Service fee percent - may be stored as decimal (0.12) or whole (12)
  const serviceFeeRaw = settings.service_fee_percent ?? 12;
  const serviceFeePercentValue = normalizeToWholePercent(serviceFeeRaw, 12);

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

  // CRITICAL: Mobile app divides by 100, so we return WHOLE NUMBERS
  // e.g., 10 means 10%, mobile does: subtotal * (10 / 100) = subtotal * 0.1
  const markupWholeNumber = Number(markupPercent);
  const vehicleMarkupWholeNumber = Number(vehicleMarkupPercent);
  // Return whole numbers - mobile divides by 100
  const shippingPercentWholeNumber = Number(shippingPercentValue);
  const serviceFeeWholeNumber = Number(serviceFeePercentValue);

  console.log("[mobile-public-config] Final output values:", {
    markupWholeNumber,
    shippingPercentWholeNumber,
    serviceFeeWholeNumber,
    note: "All percents as whole numbers (10 = 10%)"
  });

  return {
    success: true,
    configValid: true,
    // TOP-LEVEL env fields for mobile debugging
    env: envName,
    catalogEnabled: catalogConfig.enabled,
    catalogMode: catalogConfig.mode,
    // Standard config
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
      percentValue: shippingPercentWholeNumber, // Whole number: 10 = 10%
    },
    serviceFee: {
      percent: serviceFeeWholeNumber, // Whole number: 12 = 12%
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
    envDetails: envInfo,
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
