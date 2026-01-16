// Mobile Public Config Endpoint - OPTIMIZED FOR 10K+ USERS
// Returns cart configuration for guest users (exchange rate, markup, shipping)
// PUBLIC: No JWT required - callable with apikey only
// Source of truth: `settings` table with aggressive caching

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { coalesce, CACHE_TTL, makeCacheKey } from "../_shared/responseCache.ts";
import { withLoadShedding, getEndpointPriority, LoadSheddingError, loadSheddingResponse } from "../_shared/loadShedding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
}

// Cache key for public config (singleton - same for all users)
const CACHE_KEY = "public-config";

async function fetchConfig(): Promise<PublicConfigResponse> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: settings, error } = await supabase
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
    .maybeSingle();

  if (error) {
    console.error("[mobile-public-config] Database error:", error.message);
    throw new Error(`DATABASE_ERROR: ${error.message}`);
  }

  if (!settings) {
    console.warn("[mobile-public-config] No settings found - returning defaults");
    return {
      success: true,
      configValid: false,
      reason: "NO_SETTINGS_CONFIGURED",
      exchangeRate: 2500,
      markup: { type: "percent", value: 10 },
      shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
      serviceFee: { percent: 12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
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
      serviceFee: { percent: 12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
    };
  }

  // Parse values - Handle both decimal (0.15) and percentage (15) formats
  // Rule: values <= 1 are treated as decimals, values > 1 are treated as percentages
  const markupRaw = settings.markup_percent ?? settings.global_markup_percent ?? 15;
  // If stored as decimal (e.g., 0.15), convert to percentage (15)
  // If stored as percentage (e.g., 15 or 50), keep as-is
  const markupPercent = markupRaw <= 1 ? markupRaw * 100 : markupRaw;

  const categoryMarkups = (settings.category_markups || {}) as Record<string, number>;
  const vehicleMarkupRaw = categoryMarkups.vehicles ?? markupPercent;
  const vehicleMarkupPercent = vehicleMarkupRaw <= 1 ? vehicleMarkupRaw * 100 : vehicleMarkupRaw;

  // Shipping percent: stored as decimal (0.10) or percentage (10)
  const shippingPercentRaw = settings.shipping_percent ?? 0.10;
  const shippingPercentValue = shippingPercentRaw <= 1 ? shippingPercentRaw * 100 : shippingPercentRaw;
  const shippingBaseFee = settings.shipping_base_fee_usd ?? 20;

  // Service fee percent: stored as decimal (0.1199) or percentage (11.99)
  const serviceFeeRaw = settings.service_fee_percent ?? 0.12;
  const serviceFeePercentValue = serviceFeeRaw <= 1 ? serviceFeeRaw * 100 : serviceFeeRaw;

  const updatedAt = settings.updated_at || new Date().toISOString();
  const version = new Date(updatedAt).getTime();

  console.log("[mobile-public-config] Parsed config:", {
    markupRaw, markupPercent,
    vehicleMarkupRaw, vehicleMarkupPercent,
    shippingPercentRaw, shippingPercentValue, shippingBaseFee,
    serviceFeeRaw, serviceFeePercentValue,
  });

  return {
    success: true,
    configValid: true,
    exchangeRate: Number(exchangeRate),
    markup: {
      type: "percent",
      value: Number(markupPercent),
      vehicleValue: Number(vehicleMarkupPercent),
    },
    shipping: {
      mode: shippingBaseFee > 0 && shippingPercentValue > 0 ? "combined" : 
            shippingBaseFee > 0 ? "flat" : "percent",
      flatUsd: Number(shippingBaseFee),
      percentValue: Number(shippingPercentValue),
    },
    serviceFee: {
      percent: Number(serviceFeePercentValue),
      minUsd: Number(settings.min_service_fee_usd ?? 5),
    },
    limits: {
      maishapayMaxUsd: Number(settings.maishapay_max_usd ?? 5000),
      maishapayMaxCdf: Number(settings.maishapay_max_cdf ?? 30000000),
    },
    currency: "USD",
    updated_at: updatedAt,
    version,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const priority = getEndpointPriority("mobile-public-config");

  try {
    const response = await withLoadShedding(priority, async () => {
      // Use request coalescing + caching (5 min TTL)
      return coalesce(CACHE_KEY, fetchConfig, CACHE_TTL.PUBLIC_CONFIG);
    });

    console.log("[mobile-public-config] Returning cached/fresh config, version:", response.version);

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
