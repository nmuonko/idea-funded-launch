// Mobile Public Config Endpoint
// Returns cart configuration for guest users (exchange rate, markup, shipping)
// PUBLIC: No JWT required - callable with apikey only
// Source of truth: `settings` table (same as admin portal uses)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store, no-cache, must-revalidate",
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

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("[mobile-public-config] Request received");

  try {
    // Create Supabase client with service role for public access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch settings from the single source of truth: `settings` table
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
      return new Response(
        JSON.stringify({
          success: false,
          configValid: false,
          reason: "DATABASE_ERROR",
          error: error.message,
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    if (!settings) {
      console.error("[mobile-public-config] No settings found in database");
      return new Response(
        JSON.stringify({
          success: true,
          configValid: false,
          reason: "NO_SETTINGS_CONFIGURED",
          // Provide safe defaults but mark as invalid
          exchangeRate: 2500,
          markup: { type: "percent", value: 10 },
          shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
          serviceFee: { percent: 12, minUsd: 5 },
          limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
          currency: "USD",
          updated_at: new Date().toISOString(),
          version: 0,
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Parse and validate exchange rate (critical field)
    const exchangeRate = settings.exchange_rate_usd_to_cdf;
    if (!exchangeRate || exchangeRate <= 0) {
      console.error("[mobile-public-config] CRITICAL: Invalid exchange rate:", exchangeRate);
      return new Response(
        JSON.stringify({
          success: true,
          configValid: false,
          reason: "MISSING_EXCHANGE_RATE",
          exchangeRate: 2500, // Emergency fallback
          markup: { type: "percent", value: 10 },
          shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
          serviceFee: { percent: 12, minUsd: 5 },
          limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
          currency: "USD",
          updated_at: new Date().toISOString(),
          version: 0,
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Parse markup (can be stored as decimal 0.15 or integer 15)
    const markupRaw = settings.markup_percent ?? settings.global_markup_percent ?? 15;
    const markupPercent = markupRaw < 1 ? markupRaw * 100 : markupRaw;

    // Parse vehicle-specific markup from category_markups
    const categoryMarkups = (settings.category_markups || {}) as Record<string, number>;
    const vehicleMarkupRaw = categoryMarkups.vehicles ?? markupPercent;
    const vehicleMarkupPercent = vehicleMarkupRaw < 1 ? vehicleMarkupRaw * 100 : vehicleMarkupRaw;

    // Parse shipping (stored as decimal, e.g., 0.10 = 10%)
    const shippingPercent = settings.shipping_percent ?? 0.10;
    const shippingPercentValue = shippingPercent < 1 ? shippingPercent * 100 : shippingPercent;
    const shippingBaseFee = settings.shipping_base_fee_usd ?? 20;

    // Parse service fee (stored as decimal, e.g., 0.12 = 12%)
    const serviceFeePercent = settings.service_fee_percent ?? 0.12;
    const serviceFeePercentValue = serviceFeePercent < 1 ? serviceFeePercent * 100 : serviceFeePercent;

    // Generate version from updated_at timestamp
    const updatedAt = settings.updated_at || new Date().toISOString();
    const version = new Date(updatedAt).getTime();

    const response: PublicConfigResponse = {
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

    console.log("[mobile-public-config] Returning config:", {
      exchangeRate: response.exchangeRate,
      markup: response.markup.value,
      shippingFlat: response.shipping.flatUsd,
      version: response.version,
    });

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err) {
    console.error("[mobile-public-config] Unexpected error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        configValid: false,
        reason: "INTERNAL_ERROR",
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
