/**
 * catalog-categories — Returns category tabs + subtabs for the mobile app
 * 
 * This function was missing, causing 404 errors on the mobile homepage.
 * It reads from catalog_nav_tabs and catalog_nav_subtabs tables.
 * 
 * Always returns HTTP 200 with stable JSON to prevent mobile app crashes.
 */

import { createClient } from "@supabase/supabase-js";
import { getEnvironmentFromRequest, getRequestedEnv } from "../_shared/environmentResolver.ts";
import { buildCorsHeaders, corsPreflightResponse, logStartupRequest } from "../_shared/mobileCors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }

  const corsHeaders = buildCorsHeaders(req);
  const rid = logStartupRequest("CATALOG_CATEGORIES", req);

  function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const lang = url.searchParams.get("lang") || url.searchParams.get("language") || "en";
    const env = getEnvironmentFromRequest(req);
    const responseEnv = getRequestedEnv(req);

    // Fetch tabs
    const { data: tabs, error: tabsError } = await supabase
      .from("catalog_nav_tabs")
      .select("key, title_en, title_fr, icon, order_index, enabled, ebay_category_id")
      .eq("enabled", true)
      .order("order_index", { ascending: true });

    if (tabsError) {
      console.error("[catalog-categories] tabs error:", tabsError);
    }

    // Fetch subtabs
    const { data: subtabs, error: subtabsError } = await supabase
      .from("catalog_nav_subtabs")
      .select("key, parent_key, title_en, title_fr, order_index, enabled, ebay_category_id, ebay_category_hint, is_vehicle, is_parts, min_price_usd, provider_mode")
      .eq("enabled", true)
      .order("order_index", { ascending: true });

    if (subtabsError) {
      console.error("[catalog-categories] subtabs error:", subtabsError);
    }

    const safeTabs = tabs || [];
    const safeSubtabs = subtabs || [];

    // Build response in format mobile app expects
    const categories = safeTabs.map((tab: any) => {
      const children = safeSubtabs
        .filter((st: any) => st.parent_key === tab.key)
        .map((st: any) => ({
          key: st.key,
          title: lang === "fr" ? st.title_fr : st.title_en,
          title_en: st.title_en,
          title_fr: st.title_fr,
          parent_key: st.parent_key,
          order_index: st.order_index,
          ebay_category_id: st.ebay_category_id,
          ebay_category_hint: st.ebay_category_hint,
          is_vehicle: st.is_vehicle,
          is_parts: st.is_parts,
          min_price_usd: st.min_price_usd,
          provider_mode: st.provider_mode,
        }));

      return {
        key: tab.key,
        title: lang === "fr" ? tab.title_fr : tab.title_en,
        title_en: tab.title_en,
        title_fr: tab.title_fr,
        icon: tab.icon,
        order_index: tab.order_index,
        ebay_category_id: tab.ebay_category_id,
        subtabs: children,
      };
    });

    console.log(`[catalog-categories] env=${env} lang=${lang} tabs=${safeTabs.length} subtabs=${safeSubtabs.length}`);

    return jsonResponse({
      ok: true,
      tabs: categories,
      categories,
      env,
      total: categories.length,
    });

  } catch (err: any) {
    console.error("[catalog-categories] Unexpected error:", err);
    // NEVER return non-200 — mobile app crashes on non-200
    return jsonResponse({
      ok: true,
      tabs: [],
      categories: [],
      env: "production",
      total: 0,
      error: err.message,
    });
  }
});
