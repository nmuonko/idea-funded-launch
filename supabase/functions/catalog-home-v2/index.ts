import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Hardcoded fallback sections (used if DB read fails)
const FALLBACK_SECTIONS = [
  { key: "phones", title_fr: "Téléphones", title_en: "Phones", seed_query: "iphone samsung smartphone unlocked", mode: "general" },
  { key: "video_games", title_fr: "Jeux Vidéo", title_en: "Video Games", seed_query: "ps5 xbox nintendo switch console", mode: "general" },
  { key: "computers", title_fr: "Ordinateurs", title_en: "Computers", seed_query: "laptop macbook dell hp notebook", mode: "general" },
  { key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", seed_query: "toyota honda rav4 camry car", mode: "vehicle" },
  { key: "fashion", title_fr: "Vêtements et Mode", title_en: "Fashion", seed_query: "shoes sneakers nike adidas clothing", mode: "general" },
];

function generateCorrelationId(): string {
  return `chv2_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SectionConfig {
  key: string;
  title_fr: string;
  title_en: string;
  seed_query: string;
  mode: string;
}

interface CatalogItem {
  id: string;
  provider: string;
  title: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string | null;
}

async function fetchSectionItems(
  sectionConfig: SectionConfig,
  limit: number,
  correlationId: string
): Promise<{ items: CatalogItem[]; error?: string; ms: number }> {
  const startMs = Date.now();
  const { key, seed_query, mode } = sectionConfig;

  try {
    // Use eBay Browse API for reliable results
    const EBAY_APP_ID = Deno.env.get("EBAY_APP_ID");
    if (!EBAY_APP_ID) {
      console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} error=EBAY_APP_ID_MISSING`);
      return { items: [], error: "EBAY_APP_ID not configured", ms: Date.now() - startMs };
    }

    // Build eBay search URL
    const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    searchUrl.searchParams.set("q", seed_query);
    searchUrl.searchParams.set("limit", String(limit));
    
    // Add category filter for vehicles
    if (mode === "vehicle") {
      searchUrl.searchParams.set("category_ids", "6000"); // eBay Motors
    }

    const response = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${EBAY_APP_ID}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} provider=ebay query="${seed_query}" error=HTTP_${response.status} body=${errorText.substring(0, 200)}`);
      return { items: [], error: `eBay API error: ${response.status}`, ms: Date.now() - startMs };
    }

    const data = await response.json();
    const items: CatalogItem[] = (data.itemSummaries || []).slice(0, limit).map((item: any) => ({
      id: `ebay_${item.itemId}`,
      provider: "ebay",
      title: item.title || "Unknown",
      price: item.price?.value ? parseFloat(item.price.value) : null,
      currency: item.price?.currency || "USD",
      imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
      productUrl: item.itemWebUrl || null,
    }));

    const ms = Date.now() - startMs;
    console.log(`[CATALOG_HOME_V2][SECTION] correlationId=${correlationId} key=${key} provider=ebay query="${seed_query}" count=${items.length} ms=${ms}`);
    return { items, ms };
  } catch (err) {
    const ms = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} provider=ebay query="${seed_query}" error=${errorMessage} stack=${stack}`);
    return { items: [], error: errorMessage, ms };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  try {
    // Parse input
    let locale = "fr";
    let currency = "USD";
    let limitPerSection = 12;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        locale = body.locale || "fr";
        currency = body.currency || "USD";
        limitPerSection = Math.min(Math.max(body.limitPerSection || 12, 1), 50);
      } catch {
        // Use defaults if JSON parsing fails
      }
    } else {
      const url = new URL(req.url);
      locale = url.searchParams.get("locale") || "fr";
      currency = url.searchParams.get("currency") || "USD";
      const limitParam = url.searchParams.get("limitPerSection");
      if (limitParam) {
        limitPerSection = Math.min(Math.max(parseInt(limitParam, 10) || 12, 1), 50);
      }
    }

    console.log(`[CATALOG_HOME_V2] start correlationId=${correlationId} inputs=${JSON.stringify({ locale, currency, limitPerSection })}`);

    // Try to load sections from database
    let sectionConfigs: SectionConfig[] = [];
    let dbError: string | undefined;

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const { data, error } = await supabase
          .from("catalog_sections")
          .select("key, title_fr, title_en, seed_query, mode")
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (error) {
          dbError = error.message;
          console.warn(`[CATALOG_HOME_V2] db_error correlationId=${correlationId} error=${error.message}`);
        } else if (data && data.length > 0) {
          sectionConfigs = data;
          console.log(`[CATALOG_HOME_V2] loaded ${data.length} sections from DB`);
        }
      }
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
      console.warn(`[CATALOG_HOME_V2] db_exception correlationId=${correlationId} error=${dbError}`);
    }

    // Fallback to hardcoded sections if DB read failed or returned empty
    if (sectionConfigs.length === 0) {
      sectionConfigs = FALLBACK_SECTIONS;
      console.log(`[CATALOG_HOME_V2] using fallback sections correlationId=${correlationId}`);
    }

    // Fetch items for each section in parallel
    const sectionPromises = sectionConfigs.map(async (config) => {
      const result = await fetchSectionItems(config, limitPerSection, correlationId);
      const title = locale === "en" ? config.title_en : config.title_fr;
      return {
        key: config.key,
        title,
        items: result.items,
        _timing: result.ms,
        _error: result.error,
      };
    });

    const sectionResults = await Promise.all(sectionPromises);

    // Build response
    const sections = sectionResults.map(({ key, title, items }) => ({
      key,
      title,
      items,
    }));

    const sectionTimingsMs: Record<string, number> = {};
    const sectionErrors: Record<string, string> = {};

    for (const result of sectionResults) {
      sectionTimingsMs[result.key] = result._timing;
      if (result._error) {
        sectionErrors[result.key] = result._error;
      }
    }

    const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
    const totalMs = Date.now() - startTime;

    console.log(`[CATALOG_HOME_V2] done correlationId=${correlationId} totalMs=${totalMs} totalItems=${totalItems} errors=${Object.keys(sectionErrors).length}`);

    return jsonResponse({
      ok: true,
      sections,
      meta: {
        generatedAt: new Date().toISOString(),
        locale,
        currency,
        debug: {
          correlationId,
          sectionTimingsMs,
          sectionErrors: Object.keys(sectionErrors).length > 0 ? sectionErrors : undefined,
          dbError,
        },
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[CATALOG_HOME_V2][FATAL] correlationId=${correlationId} error=${errorMessage} stack=${stack}`);

    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      correlationId,
    }, 200); // Always return 200 with structured error
  }
});
