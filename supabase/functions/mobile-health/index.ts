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
    // Determine gateway mode (NO secret values exposed)
    const gatewayMode = Deno.env.get("MAISHAPAY_GATEWAY_MODE") || "1";
    const isLiveMode = gatewayMode === "1";

    // Check if essential configs exist (boolean only, no values)
    const hasSupabaseUrl = !!Deno.env.get("SUPABASE_URL");
    const hasSupabaseAnonKey = !!Deno.env.get("SUPABASE_ANON_KEY");
    const hasMaishapayPublicKey = !!(
      Deno.env.get("MAISHAPAY_LIVE_PUBLIC_KEY") ||
      Deno.env.get("MAISHAPAY_PUBLIC_KEY")
    );
    const hasMaishapaySecretKey = !!(
      Deno.env.get("MAISHAPAY_LIVE_SECRET_KEY") ||
      Deno.env.get("MAISHAPAY_SECRET_KEY")
    );
    const hasCallbackUrl = !!(
      Deno.env.get("MAISHAPAY_CALLBACK_URL") ||
      Deno.env.get("MAISHA_CALLBACK_URL")
    );

    const configReady =
      hasSupabaseUrl &&
      hasSupabaseAnonKey &&
      hasMaishapayPublicKey &&
      hasMaishapaySecretKey &&
      hasCallbackUrl;

    console.log("[mobile-health] Health check requested");

    return new Response(
      JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        gatewayMode,
        isLiveMode,
        configReady,
        checks: {
          supabase: hasSupabaseUrl && hasSupabaseAnonKey,
          maishapay: hasMaishapayPublicKey && hasMaishapaySecretKey,
          callback: hasCallbackUrl,
        },
        version: "1.0.0",
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
