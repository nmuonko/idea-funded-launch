import { buildCorsHeaders, corsPreflightResponse, logStartupRequest } from "./mobileCors.ts";

type CompatOptions = {
  legacyPath: string;
  action: string;
};

const FORWARDED_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-device-id",
  "x-auth-token",
  "x-session-token",
  "x-access-token",
  "x-jwt",
  "x-afrishop-environment",
  "x-afrishop-client",
  "x-supabase-client-info",
  "x-supabase-client-version",
  "x-supabase-client-name",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
  "user-agent",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
];

async function parseBody(req: Request): Promise<any> {
  if (req.method === "GET" || req.method === "HEAD") return {};

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return {};

  try {
    return await req.clone().json();
  } catch {
    return {};
  }
}

export function createMobileCartCompatHandler(options: CompatOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return corsPreflightResponse(req);
    }

    const corsHeaders = buildCorsHeaders(req);
    const rid = logStartupRequest("MOBILE_CART_COMPAT", req, {
      legacyPath: options.legacyPath,
      action: options.action,
    });

    const jsonResponse = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

      if (!supabaseUrl || !anonKey) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "CONFIG_ERROR",
          message: "Mobile cart compatibility proxy is not configured.",
        }, 500);
      }

      const headers = new Headers();
      for (const headerName of FORWARDED_HEADERS) {
        const value = req.headers.get(headerName);
        if (value) headers.set(headerName, value);
      }
      headers.set("apikey", headers.get("apikey") || anonKey);
      headers.set("Content-Type", "application/json");

      const upstreamUrl = `${supabaseUrl}/functions/v1/mobile-cart`;
      const incomingBody = await parseBody(req);
      const payload = {
        ...(incomingBody && typeof incomingBody === "object" ? incomingBody : {}),
        action: options.action,
      };

      const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const responseText = await upstreamResponse.text();
      console.log(`[mobile-cart-compat] rid=${rid} legacy=${options.legacyPath} action=${options.action} upstreamStatus=${upstreamResponse.status}`);

      return new Response(responseText, {
        status: upstreamResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
        },
      });
    } catch (error: any) {
      console.error(`[mobile-cart-compat] rid=${rid} legacy=${options.legacyPath} failed:`, error);
      return jsonResponse({
        ok: false,
        success: false,
        error: "COMPAT_PROXY_ERROR",
        message: error?.message || "Compatibility proxy failed.",
      }, 500);
    }
  };
}
