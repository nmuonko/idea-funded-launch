import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Hardcoded fallback sections with filtering rules (used if DB read fails)
const FALLBACK_SECTIONS: SectionConfig[] = [
  { 
    key: "phones", title_fr: "Téléphones", title_en: "Phones", 
    seed_query: "iphone samsung smartphone unlocked -case -cover -parts", 
    mode: "general", ebay_category_id: "9355",
    exclude_keywords: ["case","cover","screen protector","charger","parts","repair","lot","lcd","holder","stand","mount"],
    min_price_usd: 50, strict: true
  },
  { 
    key: "video_games", title_fr: "Jeux Vidéo", title_en: "Video Games", 
    seed_query: "ps5 xbox nintendo switch console -repair -tool -kit", 
    mode: "general", ebay_category_id: "1249",
    exclude_keywords: ["repair","tool","kit","screwdriver","shell","housing","replacement","mod","parts"],
    min_price_usd: 20, strict: true
  },
  { 
    key: "computers", title_fr: "Ordinateurs", title_en: "Computers", 
    seed_query: "laptop macbook dell hp notebook -case -sleeve -bag -skin", 
    mode: "general", ebay_category_id: "58058",
    exclude_keywords: ["case","sleeve","skin","sticker","decal","bag","cover","stand","mousepad","charger","adapter"],
    min_price_usd: 100, strict: true
  },
  { 
    key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", 
    seed_query: "toyota honda ford bmw car suv sedan -cover -mat -sticker -accessories", 
    mode: "vehicle", ebay_category_id: "6000",
    exclude_keywords: ["seat cover","floor mat","sticker","decal","hook","organizer","trim","parts","accessories","emblem","badge"],
    min_price_usd: 1000, strict: true
  },
  { 
    key: "fashion", title_fr: "Vêtements et Mode", title_en: "Fashion", 
    seed_query: "shoes sneakers nike adidas clothing -laces -cleaner", 
    mode: "general", ebay_category_id: "63889",
    exclude_keywords: ["laces","insole","cleaner","protector","spray","brush","polish","tree","stretcher"],
    min_price_usd: 15, strict: true
  },
];

// Cache for eBay OAuth token
let ebayTokenCache: { token: string; expiresAt: number } | null = null;

function generateCorrelationId(): string {
  return `chv2_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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
    console.error("[CATALOG_HOME_V2] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
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
      console.error(`[CATALOG_HOME_V2] eBay OAuth error: ${response.status} ${errorText}`);
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
    console.error(`[CATALOG_HOME_V2] eBay OAuth exception: ${err}`);
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
  include_keywords?: string[];
  exclude_keywords?: string[];
  min_price_usd?: number;
  strict?: boolean;
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
 * Build enhanced query with negative keywords for eBay
 */
function buildEnhancedQuery(seedQuery: string, excludeKeywords: string[]): string {
  if (!excludeKeywords || excludeKeywords.length === 0) {
    return seedQuery;
  }
  // eBay supports negative terms with "-" prefix (limit to ~10 for best results)
  const negatives = excludeKeywords.slice(0, 10).map(kw => `-${kw.replace(/\s+/g, '')}`);
  return `${seedQuery} ${negatives.join(' ')}`;
}

/**
 * Filter items for relevance based on section config
 */
function filterRelevantItems(
  items: CatalogItem[],
  config: SectionConfig,
  correlationId: string
): { filtered: CatalogItem[]; excluded: number; topExcluded: string[] } {
  const { key, exclude_keywords = [], min_price_usd, strict = true, mode } = config;
  
  // Build exclusion patterns from keywords
  const excludePatterns = exclude_keywords.map(kw => 
    new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
  );
  
  // Common accessory patterns - applied when strict=true
  const accessoryRegex = /(case|cover|sleeve|skin|sticker|decal|protector|replacement|repair|tool|kit|parts|holder|mount|stand|charger|cable|adapter|bag|pouch|wallet|strap|hook|organizer|mat|trim|emblem|badge|keychain|freshener|liner|cushion|headrest|visor|sunshade)/i;
  
  // Vehicle-specific: must NOT be parts/accessories
  const vehiclePartsRegex = /(seat cover|floor mat|steering wheel|dash|bumper|fender|mirror|hood|door panel|trunk|cargo|headlight|taillight|wheel cover|hub cap|antenna|emblem|badge|decal|sticker|air freshener|tissue|cup holder|phone holder|sun visor|key|remote|fob|cable|charger|mount|stand|hook|organizer|liner|cushion|mat|cover|protector)/i;
  
  const topExcluded: string[] = [];
  
  const filtered = items.filter(item => {
    const title = (item.title || '').toLowerCase();
    const price = item.price_usd ?? item.priceUsd ?? 0;
    
    // Price floor check
    if (min_price_usd && price > 0 && price < min_price_usd) {
      if (topExcluded.length < 5) topExcluded.push(`price<${min_price_usd}: ${title.substring(0,40)}`);
      return false;
    }
    
    // Excluded keywords check
    for (const pattern of excludePatterns) {
      if (pattern.test(title)) {
        if (topExcluded.length < 5) topExcluded.push(`keyword: ${title.substring(0,40)}`);
        return false;
      }
    }
    
    // Vehicle mode: extra strict filtering
    if (mode === 'vehicle') {
      if (vehiclePartsRegex.test(title)) {
        if (topExcluded.length < 5) topExcluded.push(`vehicle_part: ${title.substring(0,40)}`);
        return false;
      }
    }
    
    // General accessory pattern check (when strict)
    if (strict && accessoryRegex.test(title)) {
      if (topExcluded.length < 5) topExcluded.push(`accessory: ${title.substring(0,40)}`);
      return false;
    }
    
    return true;
  });
  
  const excludedCount = items.length - filtered.length;
  if (excludedCount > 0 || mode === 'vehicle') {
    console.log(`[SECTION_RELEVANCE] key=${key} before=${items.length} after=${filtered.length} excluded=${excludedCount} topExcluded=${JSON.stringify(topExcluded)}`);
  }
  if (mode === 'vehicle') {
    console.log(`[VEHICLE_STRICT] key=${key} before=${items.length} after=${filtered.length} droppedParts=${excludedCount}`);
  }
  
  return { filtered, excluded: excludedCount, topExcluded };
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
  
  return null;
}

async function fetchSectionItems(
  sectionConfig: SectionConfig,
  limit: number,
  correlationId: string,
  ebayToken: string | null
): Promise<{ items: CatalogItem[]; error?: string; ms: number }> {
  const startMs = Date.now();
  const { key, seed_query, mode, ebay_category_id, exclude_keywords = [] } = sectionConfig;

  if (!ebayToken) {
    console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} error=NO_EBAY_TOKEN`);
    return { items: [], error: "eBay OAuth token not available", ms: Date.now() - startMs };
  }

  try {
    // Build enhanced query with negative keywords
    const enhancedQuery = buildEnhancedQuery(seed_query, exclude_keywords);
    
    const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    searchUrl.searchParams.set("q", enhancedQuery);
    // Fetch more items to account for filtering
    searchUrl.searchParams.set("limit", String(Math.min(limit * 3, 50)));
    
    // Apply eBay category filter if configured (restricts results to relevant category)
    if (ebay_category_id) {
      searchUrl.searchParams.set("category_ids", ebay_category_id);
      console.log(`[CATALOG_HOME_V2][SECTION] correlationId=${correlationId} key=${key} applying category_ids=${ebay_category_id} query="${enhancedQuery}"`);
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
      console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} provider=ebay query="${enhancedQuery}" error=HTTP_${response.status} body=${errorText.substring(0, 200)}`);
      return { items: [], error: `eBay API error: ${response.status}`, ms: Date.now() - startMs };
    }

    const data = await response.json();
    const rawItems = data.itemSummaries || [];
    
    const mappedItems: CatalogItem[] = rawItems.map((item: Record<string, unknown>) => {
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
    
    // Apply relevance filtering
    const { filtered } = filterRelevantItems(mappedItems, sectionConfig, correlationId);
    
    // Take only the requested limit after filtering
    const items = filtered.slice(0, limit);
    
    // Log price extraction stats
    const withPrice = items.filter(i => i.price_usd !== null).length;
    const withoutPrice = items.filter(i => i.price_usd === null).length;

    const ms = Date.now() - startMs;
    console.log(`[CATALOG_HOME_V2][SECTION] correlationId=${correlationId} key=${key} provider=ebay rawCount=${rawItems.length} filteredCount=${items.length} withPrice=${withPrice} withoutPrice=${withoutPrice} ms=${ms}`);
    return { items, ms };
  } catch (err) {
    const ms = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} provider=ebay error=${errorMessage}`);
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
      `${supabaseUrl}/rest/v1/catalog_sections?is_active=eq.true&order=sort_order.asc&select=key,title_fr,title_en,seed_query,mode,ebay_category_id,include_keywords,exclude_keywords,min_price_usd,strict`,
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  try {
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
        // Use defaults
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

    // Get eBay OAuth token
    const ebayToken = await getEbayToken();

    // Try to load sections from database
    const { sections: dbSections, error: dbError } = await loadSectionsFromDb();
    const sectionConfigs: SectionConfig[] = dbSections || FALLBACK_SECTIONS;

    if (dbError) {
      console.warn(`[CATALOG_HOME_V2] db_error correlationId=${correlationId} error=${dbError}`);
    } else {
      console.log(`[CATALOG_HOME_V2] loaded ${sectionConfigs.length} sections from DB correlationId=${correlationId}`);
    }

    // Fetch items for each section in parallel
    const sectionPromises = sectionConfigs.map(async (config) => {
      const result = await fetchSectionItems(config, limitPerSection, correlationId, ebayToken);
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
    console.error(`[CATALOG_HOME_V2][FATAL] correlationId=${correlationId} error=${errorMessage}`);

    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      correlationId,
    });
  }
});
