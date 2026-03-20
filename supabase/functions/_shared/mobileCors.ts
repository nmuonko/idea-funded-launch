/**
 * Dynamic CORS helper for mobile-facing edge functions.
 * 
 * Echoes `Access-Control-Request-Headers` when present (preflight),
 * otherwise falls back to a broad allow-list covering all known
 * mobile headers from frozen React Native / Capacitor builds.
 */

const FALLBACK_ALLOW_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-supabase-client-info",
  "x-supabase-client-version",
  "x-supabase-client-name",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
  "x-afrishop-environment",
  "x-afrishop-client",
  "x-device-id",
  "x-auth-token",
  "x-session-token",
  "x-access-token",
  "x-supabase-auth",
  "x-jwt",
  "user-agent",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
].join(", ");

export function buildCorsHeaders(req: Request): Record<string, string> {
  // During preflight the browser sends Access-Control-Request-Headers
  // listing every header the real request will use. Echo it back verbatim
  // to guarantee the preflight passes regardless of custom headers.
  const requested = req.headers.get("access-control-request-headers");
  const allowHeaders = requested && requested.trim().length > 0
    ? requested
    : FALLBACK_ALLOW_HEADERS;

  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
  };
}

export function corsPreflightResponse(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(req),
  });
}

/**
 * Log a compact request summary for startup diagnostics.
 * Call at the top of every mobile-facing handler.
 */
export function logStartupRequest(tag: string, req: Request, extra?: Record<string, unknown>): string {
  const rid = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const url = new URL(req.url);
  const summary: Record<string, unknown> = {
    rid,
    method: req.method,
    path: url.pathname,
    query: url.search,
    ua: (req.headers.get("user-agent") || "").slice(0, 80),
    deviceId: req.headers.get("x-device-id") || "",
    envHeader: req.headers.get("x-afrishop-environment") || "",
    envQuery: url.searchParams.get("env") || "",
    platform: req.headers.get("x-supabase-client-platform") || "",
    acrh: req.headers.get("access-control-request-headers") || "",
    ...extra,
  };
  console.log(`[${tag}] REQUEST`, JSON.stringify(summary));
  return rid;
}
