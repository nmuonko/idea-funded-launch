import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home - Compatibility wrapper
 * 
 * This endpoint mirrors catalog-home-v2 for backward compatibility.
 * Mobile and web clients call /functions/v1/catalog-home expecting the same response.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Hardcoded fallback sections (used if DB read fails)
const FALLBACK_SECTIONS = [
  { key: "phones", title_fr: "Téléphones", title_en: "Phones", seed_query: "iphone samsung smartphone unlocked", mode: "general", ebay_category_id: "9355" },
  { key: "video_games", title_fr: "Jeux Vidéo", title_en: "Video Games", seed_query: "ps5 xbox nintendo switch console", mode: "general", ebay_category_id: "1249" },
  { key: "computers", title_fr: "Ordinateurs", title_en: "Computers", seed_query: "laptop macbook dell hp notebook", mode: "general", ebay_category_id: "58058" },
  { key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", seed_query: "toyota honda rav4 camry car", mode: "vehicle", ebay_category_id: "6000" },
  { key: "fashion", title_fr: "Vêtements et Mode", title_en: "Fashion", seed_query: "shoes sneakers nike adidas clothing", mode: "general", ebay_category_id: "63889" },
];

// Cache for eBay OAuth token
let ebayTokenCache: { token: string; expiresAt: number } | null = null;

function generateCorrelationId(): string {
  return `ch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getEbayToken(): Promise<string | null> {
  // Check cache first
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60000) {
    return ebayTokenCache.token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[CATALOG_HOME] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
    return null;
  }

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CATALOG_HOME] eBay OAuth error: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json();
    const token = data.access_token;
    const expiresIn = data.expires_in || 7200;

    // Cache the token
    ebayTokenCache = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return token;
  } catch (err) {
    console.error(`[CATALOG_HOME] eBay OAuth exception: ${err}`);
    return null;
  }
}

interface SectionConfig {
  key: string;
  title_fr: string;
  title_en: string;
  seed_query: string;
  mode: string;
  ebay_category_id?: string;
}

interface CatalogItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  priceUsd: number | null; // Alias for frontend compatibility
  currency: string;
  image_url: string | null;
  imageUrl: string | null; // Alias for frontend compatibility
  product_url: string | null;
  productUrl: string | null; // Alias for frontend compatibility
  in_stock: boolean;
}

/**
 * Extract price from eBay item - robust multi-field extraction
 */
function extractPriceFromItem(item: Record<string, unknown>, correlationId: string): number | null {
  // Try price.value first (standard eBay Browse API format)
  const priceObj = item.price as Record<string, unknown> | undefined;
  if (priceObj?.value !== undefined && priceObj?.value !== null) {
    const val = typeof priceObj.value === "string" ? parseFloat(priceObj.value) : priceObj.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      return val;
    }
  }
  
  // Try currentPrice.value
  const currentPrice = item.currentPrice as Record<string, unknown> | undefined;
  if (currentPrice?.value !== undefined) {
    const val = typeof currentPrice.value === "string" ? parseFloat(currentPrice.value) : currentPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      return val;
    }
  }
  
  // Try sellingStatus.currentPrice.value (older eBay API)
  const sellingStatus = item.sellingStatus as Record<string, unknown> | undefined;
  const sellingPrice = sellingStatus?.currentPrice as Record<string, unknown> | undefined;
  if (sellingPrice?.value !== undefined) {
    const val = typeof sellingPrice.value === "string" ? parseFloat(sellingPrice.value) : sellingPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      return val;
    }
  }
  
  // Try pricingSummary.price.value
  const pricingSummary = item.pricingSummary as Record<string, unknown> | undefined;
  const summaryPrice = pricingSummary?.price as Record<string, unknown> | undefined;
  if (summaryPrice?.value !== undefined) {
    const val = typeof summaryPrice.value === "string" ? parseFloat(summaryPrice.value) : summaryPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      return val;
    }
  }

  // Try convertedCurrentPrice.value
  const convertedPrice = item.convertedCurrentPrice as Record<string, unknown> | undefined;
  if (convertedPrice?.value !== undefined) {
    const val = typeof convertedPrice.value === "string" ? parseFloat(convertedPrice.value) : convertedPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      return val;
    }
  }
  
  // Log missing price for debugging
  const itemId = item.itemId || "unknown";
  const title = typeof item.title === "string" ? item.title.substring(0, 40) : "unknown";
  const sampleFields = {
    price: priceObj ? `{value:${priceObj.value}}` : null,
    currentPrice: currentPrice ? `{value:${currentPrice.value}}` : null,
    sellingStatus: sellingStatus ? "exists" : null,
  };
  console.log(`[PRICE_MAP] missing correlationId=${correlationId} provider=ebay itemId=${itemId} title="${title}" sampleFields=${JSON.stringify(sampleFields)}`);
  
  return null;
}

async function fetchSectionItems(
  sectionConfig: SectionConfig,
  limit: number,
  correlationId: string,
  ebayToken: string | null
): Promise<{ items: CatalogItem[]; error?: string; ms: number }> {
  const startMs = Date.now();
  const { key, seed_query, mode, ebay_category_id } = sectionConfig;

  if (!ebayToken) {
    console.error(`[CATALOG_HOME][SECTION_ERROR] correlationId=${correlationId} key=${key} error=NO_EBAY_TOKEN`);
    return { items: [], error: "eBay OAuth token not available", ms: Date.now() - startMs };
  }

  try {
    const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    searchUrl.searchParams.set("q", seed_query);
    searchUrl.searchParams.set("limit", String(limit));
    
    // Apply eBay category filter if configured (restricts results to relevant category)
    if (ebay_category_id) {
      searchUrl.searchParams.set("category_ids", ebay_category_id);
      console.log(`[CATALOG_HOME][SECTION] correlationId=${correlationId} key=${key} applying category_ids=${ebay_category_id}`);
    } else if (mode === "vehicle") {
      // Fallback for vehicles if no ebay_category_id
      searchUrl.searchParams.set("category_ids", "6000");
    }

    const response = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${ebayToken}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CATALOG_HOME][SECTION_ERROR] correlationId=${correlationId} key=${key} provider=ebay query="${seed_query}" error=HTTP_${response.status} body=${errorText.substring(0, 200)}`);
      return { items: [], error: `eBay API error: ${response.status}`, ms: Date.now() - startMs };
    }

    const data = await response.json();
    const rawItems = data.itemSummaries || [];
    
    const items: CatalogItem[] = rawItems.slice(0, limit).map((item: Record<string, unknown>) => {
      const priceUsd = extractPriceFromItem(item, correlationId);
      const imageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || 
                       ((item.thumbnailImages as Array<Record<string, unknown>>)?.[0]?.imageUrl as string) || 
                       null;
      const productUrl = (item.itemWebUrl as string) || null;
      const priceObj = item.price as Record<string, unknown> | undefined;
      
      return {
        id: `ebay_${item.itemId}`,
        provider: "ebay",
        provider_product_id: item.itemId as string,
        title: (item.title as string) || "Unknown",
        price_usd: priceUsd,
        priceUsd: priceUsd, // Alias
        currency: (priceObj?.currency as string) || "USD",
        image_url: imageUrl,
        imageUrl: imageUrl, // Alias
        product_url: productUrl,
        productUrl: productUrl, // Alias
        in_stock: true,
      };
    });
    
    // Log price extraction stats
    const withPrice = items.filter(i => i.price_usd !== null).length;
    const withoutPrice = items.filter(i => i.price_usd === null).length;

    const ms = Date.now() - startMs;
    console.log(`[CATALOG_HOME][SECTION] correlationId=${correlationId} key=${key} provider=ebay query="${seed_query}" count=${items.length} withPrice=${withPrice} withoutPrice=${withoutPrice} ms=${ms}`);
    return { items, ms };
  } catch (err) {
    const ms = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[CATALOG_HOME][SECTION_ERROR] correlationId=${correlationId} key=${key} provider=ebay query="${seed_query}" error=${errorMessage}`);
    return { items: [], error: errorMessage, ms };
  }
}

async function loadSectionsFromDb(): Promise<{ sections: SectionConfig[] | null; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return { sections: null, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/catalog_sections?is_active=eq.true&order=sort_order.asc&select=key,title_fr,title_en,seed_query,mode,ebay_category_id`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { sections: null, error: `DB error: ${response.status} ${errorText.substring(0, 100)}` };
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return { sections: data };
    }
    return { sections: null, error: "No sections found in DB" };
  } catch (err) {
    return { sections: null, error: err instanceof Error ? err.message : String(err) };
  }
}

serve(async (req) => {
  const correlationId = generateCorrelationId();
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log(`[CATALOG_ALIAS] preflight correlationId=${correlationId} fn=catalog-home`);
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[CATALOG_ALIAS] start correlationId=${correlationId} fn=catalog-home path=${new URL(req.url).pathname}`);

  try {
    let locale = "fr";
    let currency = "USD";
    let limitPerSection = 12;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        locale = body.locale || body.lang || "fr";
        currency = body.currency || "USD";
        limitPerSection = Math.min(Math.max(body.limitPerSection || 12, 1), 50);
      } catch {
        // Use defaults
      }
    } else {
      const url = new URL(req.url);
      locale = url.searchParams.get("locale") || url.searchParams.get("lang") || "fr";
      currency = url.searchParams.get("currency") || "USD";
      const limitParam = url.searchParams.get("limitPerSection");
      if (limitParam) {
        limitPerSection = Math.min(Math.max(parseInt(limitParam, 10) || 12, 1), 50);
      }
    }

    console.log(`[CATALOG_HOME] inputs correlationId=${correlationId} locale=${locale} currency=${currency} limit=${limitPerSection}`);

    // Get eBay OAuth token
    const ebayToken = await getEbayToken();

    // Try to load sections from database
    const { sections: dbSections, error: dbError } = await loadSectionsFromDb();
    const sectionConfigs: SectionConfig[] = dbSections || FALLBACK_SECTIONS;

    if (dbError) {
      console.warn(`[CATALOG_HOME] db_error correlationId=${correlationId} error=${dbError}`);
    } else {
      console.log(`[CATALOG_HOME] loaded ${sectionConfigs.length} sections from DB correlationId=${correlationId}`);
    }

    // Fetch items for each section in parallel
    const sectionPromises = sectionConfigs.map(async (config) => {
      const result = await fetchSectionItems(config, limitPerSection, correlationId, ebayToken);
      const title = locale === "en" ? config.title_en : config.title_fr;
      return {
        key: config.key,
        title,
        items: result.items,
        see_all: { q: config.seed_query },
        _timing: result.ms,
        _error: result.error,
      };
    });

    const sectionResults = await Promise.all(sectionPromises);

    const sections = sectionResults.map(({ key, title, items, see_all }) => ({
      key,
      title,
      items,
      see_all,
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

    console.log(`[CATALOG_ALIAS] done correlationId=${correlationId} fn=catalog-home status=200 totalMs=${totalMs} totalItems=${totalItems}`);

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
    const totalMs = Date.now() - startTime;
    console.error(`[CATALOG_ALIAS] error correlationId=${correlationId} fn=catalog-home status=500 error=${errorMessage} ms=${totalMs}`);

    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      correlationId,
    }, 500);
  }
});
