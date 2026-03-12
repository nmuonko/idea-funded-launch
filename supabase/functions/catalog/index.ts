import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders, corsPreflightResponse, logStartupRequest } from "../_shared/mobileCors.ts";

const ROUTE_MAP: Record<string, string> = {
  "/": "catalog-home",
  "/home": "catalog-home",
  "/search": "catalog-search",
  "/product": "catalog-product",
  "/category": "catalog-category",
  "/section": "catalog-category",
  "/categories": "catalog-categories",
};

serve(async (req: Request) => {
  // Dynamic CORS — echoes whatever headers the client requests
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }

  const corsHeaders = buildCorsHeaders(req);
  const rid = logStartupRequest("CATALOG_PROXY", req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  if (!supabaseUrl) {
    return new Response(JSON.stringify({ ok: false, error: "SUPABASE_URL not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const catalogIdx = segments.lastIndexOf("catalog");
  const suffix = catalogIdx >= 0 ? segments.slice(catalogIdx + 1) : [];
  const route = `/${suffix.join("/")}`.replace(/\/+$/, "") || "/";

  const targetFunction = ROUTE_MAP[route];
  if (!targetFunction) {
    console.log(`[CATALOG_PROXY] ${rid} unknown route=${route}`);
    return new Response(JSON.stringify({ ok: false, error: `Unknown legacy route: ${route}` }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const targetUrl = `${supabaseUrl}/functions/v1/${targetFunction}${url.search}`;
  console.log(`[CATALOG_PROXY] ${rid} route=${route} → ${targetFunction}`);

  // Forward ALL request headers to the target function
  const headers = new Headers();
  headers.set("apikey", anonKey);
  headers.set("Content-Type", req.headers.get("Content-Type") || "application/json");

  // Forward every known mobile/custom header
  for (const h of [
    "authorization",
    "x-device-id",
    "x-afrishop-environment",
    "x-afrishop-client",
    "x-client-info",
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
  ]) {
    const value = req.headers.get(h);
    if (value) headers.set(h, value);
  }

  const requestInit: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const bodyText = await req.text();
    if (bodyText) requestInit.body = bodyText;
  }

  try {
    const upstream = await fetch(targetUrl, requestInit);
    const text = await upstream.text();

    console.log(`[CATALOG_PROXY] ${rid} upstream status=${upstream.status} bodyLen=${text.length}`);

    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "x-catalog-compat-route": route,
        "x-catalog-compat-target": targetFunction,
        "x-catalog-proxy-rid": rid,
      },
    });
  } catch (err: any) {
    console.error(`[CATALOG_PROXY] ${rid} fetch error: ${err.message}`);
    return new Response(JSON.stringify({ ok: false, error: "Proxy fetch failed", rid }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
