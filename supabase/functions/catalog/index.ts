import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-afrishop-environment, x-device-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

const ROUTE_MAP: Record<string, string> = {
  "/": "catalog-home",
  "/home": "catalog-home",
  "/search": "catalog-search",
  "/product": "catalog-product",
  "/category": "catalog-category",
  "/section": "catalog-category",
  "/categories": "catalog-categories",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  if (!supabaseUrl) {
    return jsonResponse({ ok: false, error: "SUPABASE_URL not configured" }, 500);
  }

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const catalogIdx = segments.lastIndexOf("catalog");
  const suffix = catalogIdx >= 0 ? segments.slice(catalogIdx + 1) : [];
  const route = `/${suffix.join("/")}`.replace(/\/+$/, "") || "/";

  const targetFunction = ROUTE_MAP[route];
  if (!targetFunction) {
    return jsonResponse({ ok: false, error: `Unknown legacy route: ${route}` }, 404);
  }

  const targetUrl = `${supabaseUrl}/functions/v1/${targetFunction}${url.search}`;

  const headers = new Headers();
  headers.set("apikey", anonKey);
  headers.set("Content-Type", req.headers.get("Content-Type") || "application/json");

  const auth = req.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);

  for (const h of [
    "x-device-id",
    "x-afrishop-environment",
    "x-client-info",
    "x-supabase-client-platform",
    "x-supabase-client-platform-version",
    "x-supabase-client-runtime",
    "x-supabase-client-runtime-version",
    "user-agent",
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

  const upstream = await fetch(targetUrl, requestInit);
  const text = await upstream.text();

  return new Response(text, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      "x-catalog-compat-route": route,
      "x-catalog-compat-target": targetFunction,
    },
  });
});
