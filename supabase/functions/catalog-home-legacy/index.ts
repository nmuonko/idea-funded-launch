/**
 * catalog-home-legacy - Wrapper for legacy /catalog/home path
 * 
 * This ensures mobile apps calling the old /catalog/home path still work.
 * It uses the exact same 4-tier fallback as catalog-home.
 * 
 * PRODUCTION HOTFIX: ALWAYS returns 200 + ok:true for mobile.
 */

import {
  corsHeaders,
  isMobileClient,
  normalizeEnv,
  handleMobileCatalogRequest,
  generateCorrelationId,
} from "../_shared/mobileCatalogHandler.ts";

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const correlationId = generateCorrelationId("chl");
  const url = new URL(req.url);
  const ua = req.headers.get("user-agent") || "";
  const isMobile = isMobileClient(req);
  const { envRequested, envUsed } = normalizeEnv(req);

  console.log(`[CATALOG_HOME_LEGACY] correlationId=${correlationId} path=${url.pathname} isMobile=${isMobile} ua=${ua.substring(0, 50)} envReq=${envRequested} envUsed=${envUsed}`);

  try {
    // For mobile: Use the guaranteed mobile handler
    if (isMobile) {
      return await handleMobileCatalogRequest(req, correlationId, "CATALOG_HOME_LEGACY");
    }

    // For web: Proxy to catalog-home
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      throw new Error("Missing SUPABASE_URL");
    }

    // Build new URL to catalog-home
    const targetUrl = new URL(`${supabaseUrl}/functions/v1/catalog-home`);
    
    // Copy query params
    url.searchParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value);
    });

    // Proxy the request
    const proxyRes = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: {
        "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
        "Authorization": req.headers.get("Authorization") || `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
        "Content-Type": "application/json",
      },
    });

    const data = await proxyRes.json();
    
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    console.error(`[CATALOG_HOME_LEGACY][ERROR] correlationId=${correlationId} error=${err}`);

    // For mobile: Return ok:true with empty sections
    if (isMobile) {
      return new Response(JSON.stringify({
        ok: true,
        sections: [
          { key: "phones", title: "Téléphones", title_fr: "Téléphones", title_en: "Phones", items: [] },
          { key: "electronics", title: "Électronique", title_fr: "Électronique", title_en: "Electronics", items: [] },
          { key: "vehicles", title: "Véhicules", title_fr: "Véhicules", title_en: "Vehicles", items: [] },
          { key: "video_games", title: "Jeux Vidéo", title_fr: "Jeux Vidéo", title_en: "Video Games", items: [] },
          { key: "clothing_fashion", title: "Vêtements et Mode", title_fr: "Vêtements et Mode", title_en: "Clothing & Fashion", items: [] },
          { key: "home_garden", title: "Maison et Jardin", title_fr: "Maison et Jardin", title_en: "Home & Garden", items: [] },
          { key: "toys", title: "Jouets", title_fr: "Jouets", title_en: "Toys", items: [] },
          { key: "sporting_goods", title: "Articles de Sport", title_fr: "Articles de Sport", title_en: "Sporting Goods", items: [] },
        ],
        page: 1,
        pageSize: 20,
        totalPages: 1,
        totalItems: 0,
        hasMore: false,
        hasMoreCached: false,
        ttlSeconds: 172800,
        correlationId,
        meta: {
          client: "mobile",
          envUsed,
          envRequested,
          source: "error_fallback",
          isStale: true,
          correlationId,
          ts: Date.now(),
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // For web: Return error structure
    return new Response(JSON.stringify({
      ok: false,
      sections: [{ key: "featured", title: "", title_fr: "", title_en: "", hideTitle: true, items: [] }],
      page: 1,
      pageSize: 100,
      totalPages: 0,
      correlationId,
      error: String(err),
      meta: { source: "error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
