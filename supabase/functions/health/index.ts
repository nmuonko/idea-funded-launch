/**
 * Health Check Endpoint (SDK-Free)
 * 
 * Validates:
 * - Database connectivity
 * - Settings table has valid data
 * - Environment variables
 * - MaishaPay API config (optional)
 * 
 * GET /health
 * Returns: { status: "healthy" | "degraded" | "unhealthy", checks: {...} }
 * 
 * SDK-FREE: Uses lightweight PostgREST client to avoid bundler timeouts.
 */

import { createAdminPostgrestClient } from "../_shared/postgrest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

interface HealthCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  latencyMs?: number;
  message?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  const checks: HealthCheck[] = [];

  // Check 1: Database connectivity
  const dbStart = Date.now();
  try {
    const db = createAdminPostgrestClient();
    const { data, error } = await db
      .from("settings")
      .select("id, exchange_rate_usd_to_cdf")
      .limit(1)
      .maybeSingle();

    const dbLatency = Date.now() - dbStart;

    if (error) {
      checks.push({
        name: "database",
        status: "fail",
        latencyMs: dbLatency,
        message: error.message,
      });
    } else if (!data) {
      checks.push({
        name: "database",
        status: "warn",
        latencyMs: dbLatency,
        message: "Settings table is empty",
      });
    } else {
      checks.push({
        name: "database",
        status: "pass",
        latencyMs: dbLatency,
        message: `Exchange rate: ${data.exchange_rate_usd_to_cdf}`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: "database",
      status: "fail",
      latencyMs: Date.now() - dbStart,
      message: err.message,
    });
  }

  // Check 2: Environment variables
  const requiredEnvVars = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ];

  const missingEnvVars = requiredEnvVars.filter((v) => !Deno.env.get(v));

  if (missingEnvVars.length > 0) {
    checks.push({
      name: "environment",
      status: "fail",
      message: `Missing: ${missingEnvVars.join(", ")}`,
    });
  } else {
    checks.push({
      name: "environment",
      status: "pass",
    });
  }

  // Check 3: Optional API keys
  const optionalVars = ["RESEND_API_KEY", "MAISHAPAY_PUBLIC_API_KEY", "MAISHAPAY_SECRET_API_KEY"];
  const missingOptional = optionalVars.filter((v) => !Deno.env.get(v));

  if (missingOptional.length > 0) {
    checks.push({
      name: "optional_services",
      status: "warn",
      message: `Not configured: ${missingOptional.join(", ")}`,
    });
  } else {
    checks.push({
      name: "optional_services",
      status: "pass",
      message: "All optional services configured",
    });
  }

  // Determine overall status
  const hasFailure = checks.some((c) => c.status === "fail");
  const hasWarning = checks.some((c) => c.status === "warn");

  let overallStatus: "healthy" | "degraded" | "unhealthy";
  if (hasFailure) {
    overallStatus = "unhealthy";
  } else if (hasWarning) {
    overallStatus = "degraded";
  } else {
    overallStatus = "healthy";
  }

  const totalLatency = Date.now() - startTime;

  console.log(`[HEALTH] status=${overallStatus} checks=${checks.length} ms=${totalLatency}`);

  return new Response(
    JSON.stringify({
      ok: overallStatus !== "unhealthy",
      status: overallStatus,
      timestamp: new Date().toISOString(),
      totalLatencyMs: totalLatency,
      checks,
    }),
    {
      status: overallStatus === "unhealthy" ? 503 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
