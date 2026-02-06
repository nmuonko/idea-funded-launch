/**
 * catalog-debug - Debug echo endpoint for mobile troubleshooting
 * 
 * Returns exactly what headers/params the client is sending so we can
 * diagnose mobile CORS/env issues.
 * 
 * GET /catalog-debug
 * 
 * No auth required.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type",
  "Content-Type": "application/json; charset=utf-8",
};

function generateCorrelationId(): string {
  return `cd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

Deno.serve(async (req) => {
  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    });
  }

  const correlationId = generateCorrelationId();
  const url = new URL(req.url);
  
  // Read env from both query and header (case-insensitive)
  const envFromQuery = url.searchParams.get("env") || null;
  const envFromHeaderUpper = req.headers.get("X-Afrishop-Environment");
  const envFromHeaderLower = req.headers.get("x-afrishop-environment");
  const envFromHeader = envFromHeaderUpper || envFromHeaderLower || null;
  
  // Normalize environment
  let envRaw = envFromQuery || envFromHeader || "production";
  envRaw = envRaw.toLowerCase().trim();
  
  let envNormalized = envRaw;
  if (envNormalized === "prod") {
    envNormalized = "production";
  }
  if (envNormalized !== "production" && envNormalized !== "staging" && envNormalized !== "dev") {
    envNormalized = "production";
  }

  // Collect interesting headers
  const headers: Record<string, string | null> = {
    "x-afrishop-environment": envFromHeader,
    "apikey": req.headers.get("apikey") ? "present" : "absent",
    "authorization": req.headers.get("authorization") ? "present" : "absent",
    "origin": req.headers.get("origin"),
    "user-agent": req.headers.get("user-agent"),
    "x-client-info": req.headers.get("x-client-info"),
    "x-supabase-client-platform": req.headers.get("x-supabase-client-platform"),
    "x-supabase-client-platform-version": req.headers.get("x-supabase-client-platform-version"),
    "x-supabase-client-runtime": req.headers.get("x-supabase-client-runtime"),
    "x-supabase-client-runtime-version": req.headers.get("x-supabase-client-runtime-version"),
    "x-device-id": req.headers.get("x-device-id"),
  };

  // Collect query params
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  console.log(`[CATALOG_DEBUG] correlationId=${correlationId} method=${req.method} envNormalized=${envNormalized} origin=${headers.origin}`);

  const response = {
    ok: true,
    url: req.url,
    method: req.method,
    headers,
    queryParams,
    parsed: {
      envFromQuery,
      envFromHeader,
      envRaw,
      envNormalized,
    },
    correlationId,
    ts: Date.now(),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: corsHeaders,
  });
});
