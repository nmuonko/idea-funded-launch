import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Mobile Health Check Endpoint
 * Returns basic diagnostic info for mobile debugging
 * NO SECRETS are returned or logged
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check if essential configs exist (boolean only, no values)
    const hasSupabaseUrl = !!Deno.env.get("SUPABASE_URL");
    const hasSupabaseAnonKey = !!Deno.env.get("SUPABASE_ANON_KEY");
    const hasPawapayConfig = !!Deno.env.get("PAWAPAY_API_TOKEN");
    const hasStripeConfig = !!Deno.env.get("STRIPE_SECRET_KEY");

    const configReady = hasSupabaseUrl && hasSupabaseAnonKey;

    console.log("[mobile-health] Health check requested");

    return new Response(
      JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        configReady,
        checks: {
          supabase: hasSupabaseUrl && hasSupabaseAnonKey,
          pawapay: hasPawapayConfig,
          stripe: hasStripeConfig,
        },
        version: "2.0.0",
        service: "afrishop-mobile-api",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[mobile-health] Error:", error.message);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Health check failed",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
