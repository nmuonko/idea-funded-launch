import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home - Homepage sections from Admin Portal configuration
 * 
 * This endpoint reads from home_sections and home_section_seeds tables
 * managed via the Admin Portal "Home Curation" interface.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Hardcoded fallback sections matching Admin Portal structure (used if DB read fails)
const FALLBACK_SECTIONS: SectionConfig[] = [
  { 
    key: "phones", title_fr: "Téléphones", title_en: "Phones", 
    ebay_category: "9355", min_price: 50, is_vehicle: false,
    include_keywords: ["iphone","samsung","galaxy","pixel","smartphone","unlocked"],
    exclude_keywords: ["case","cover","screen protector","charger","parts","repair","lot","lcd","holder","stand"],
    strict: true, seed_queries: ["iphone pro max", "samsung galaxy", "google pixel"]
  },
  { 
    key: "gaming", title_fr: "Gaming", title_en: "Gaming", 
    ebay_category: "1249", min_price: 20, is_vehicle: false,
    include_keywords: ["ps5","playstation","xbox","nintendo","switch","console","game"],
    exclude_keywords: ["repair","tool","kit","screwdriver","shell","housing","replacement","mod","parts"],
    strict: true, seed_queries: ["ps5 console", "xbox series", "nintendo switch"]
  },
  { 
    key: "computers", title_fr: "Ordinateurs", title_en: "Computers", 
    ebay_category: "58058", min_price: 100, is_vehicle: false,
    include_keywords: ["laptop","macbook","thinkpad","dell","hp","lenovo","surface","notebook","desktop","pc"],
    exclude_keywords: ["case","sleeve","skin","sticker","decal","bag","cover","stand","mousepad","charger"],
    strict: true, seed_queries: ["macbook pro", "dell laptop", "hp notebook"]
  },
  { 
    key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", 
    ebay_category: "6000", min_price: 1000, is_vehicle: true,
    include_keywords: ["toyota","honda","ford","bmw","mercedes","chevy","nissan","truck","suv","sedan"],
    exclude_keywords: ["seat cover","floor mat","sticker","decal","hook","organizer","trim","parts","accessories"],
    strict: true, seed_queries: ["toyota camry", "honda accord", "ford f150"]
  },
  { 
    key: "clothing", title_fr: "Vêtements & Chaussures", title_en: "Clothing & Shoes", 
    ebay_category: "63889", min_price: 15, is_vehicle: false,
    include_keywords: ["shoes","sneakers","nike","adidas","jordan","dress","shirt","jacket","pants","jeans"],
    exclude_keywords: ["laces","insole","cleaner","protector","spray","brush","polish"],
    strict: true, seed_queries: ["nike sneakers", "adidas shoes", "jordan retro"]
  },
  { 
    key: "home_garden", title_fr: "Maison & Jardin", title_en: "Home & Garden", 
    ebay_category: "11700", min_price: 10, is_vehicle: false,
    include_keywords: ["furniture","sofa","table","chair","lamp","decor","garden","patio"],
    exclude_keywords: ["cover","protector","cleaner","spray","polish","replacement","parts"],
    strict: true, seed_queries: ["patio furniture", "home decor", "garden tools"]
  },
  { 
    key: "refurbished", title_fr: "Reconditionné", title_en: "Refurbished", 
    ebay_category: "11800", min_price: 50, is_vehicle: false,
    include_keywords: ["refurbished","renewed","certified","like new"],
    exclude_keywords: ["parts","repair","broken","for parts","as is"],
    strict: true, seed_queries: ["refurbished iphone", "renewed laptop", "certified refurbished"]
  },
  { 
    key: "parts_accessories", title_fr: "Pièces & Accessoires", title_en: "Parts & Accessories", 
    ebay_category: "6028", min_price: 5, is_vehicle: false,
    include_keywords: ["parts","accessories","replacement","oem","aftermarket"],
    exclude_keywords: [],
    strict: false, seed_queries: ["car parts", "phone accessories", "laptop parts"]
  },
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
    ebayTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };
    return ebayTokenCache.token;
  } catch (err) {
    console.error(`[CATALOG_HOME] eBay OAuth exception: ${err}`);
    return null;
  }
}

interface SectionConfig {
  key: string;
  title_fr: string;
  title_en: string;
  ebay_category?: string;
  min_price?: number;
  is_vehicle?: boolean;
  include_keywords?: string[];
  exclude_keywords?: string[];
  strict?: boolean;
  seed_queries: string[];
  see_all_query?: string;
}

interface CatalogItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  priceUsd: number | null;
  currency: string;
  image_url: string | null;
  imageUrl: string | null;
  product_url: string | null;
  productUrl: string | null;
  in_stock: boolean;
}

/**
 * Build enhanced query with negative keywords for eBay
 * Uses a random seed query from available seeds for variety
 */
function buildEnhancedQuery(seedQueries: string[], excludeKeywords: string[]): string {
  // Pick a random seed query for variety (instead of OR-joining which returns 0 results)
  const randomIndex = Math.floor(Math.random() * seedQueries.length);
  const baseQuery = seedQueries[randomIndex] || seedQueries[0] || '';
  
  if (!excludeKeywords || excludeKeywords.length === 0) {
    return baseQuery;
  }
  
  // eBay supports "-term" to exclude (limit to ~8 for best results)
  const negatives = excludeKeywords.slice(0, 8).map(kw => `-${kw.replace(/\s+/g, '')}`);
  return `${baseQuery} ${negatives.join(' ')}`;
}

/**
 * Filter items for relevance based on section config
 */
function filterRelevantItems(
  items: CatalogItem[],
  config: SectionConfig,
  correlationId: string
): { filtered: CatalogItem[]; excluded: number; topExcluded: string[] } {
  const { key, exclude_keywords = [], min_price, strict = true, is_vehicle } = config;
  
  const excludePatterns = exclude_keywords.map(kw => 
    new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
  );
  
  // Common accessory patterns
  const accessoryRegex = /(case|cover|sleeve|skin|sticker|decal|protector|replacement|repair|tool|kit|parts|holder|mount|stand|charger|cable|adapter|bag|pouch|wallet|strap|hook|organizer|mat|trim|emblem|badge|keychain|freshener|liner|cushion|headrest|visor|sunshade)/i;
  
  // Vehicle-specific filter
  const vehiclePartsRegex = /(seat cover|floor mat|steering wheel|dash|bumper|fender|mirror|hood|door panel|trunk|cargo|headlight|taillight|wheel cover|hub cap|antenna|emblem|badge|decal|sticker|air freshener|tissue|cup holder|phone holder|sun visor|key|remote|fob|cable|charger|mount|stand|hook|organizer|liner|cushion|mat|cover|protector)/i;
  
  const topExcluded: string[] = [];
  
  const filtered = items.filter(item => {
    const title = (item.title || '').toLowerCase();
    const price = item.price_usd ?? item.priceUsd ?? 0;
    
    // Price floor check
    if (min_price && price > 0 && price < min_price) {
      if (topExcluded.length < 5) topExcluded.push(`price<${min_price}: ${title.substring(0,40)}`);
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
    if (is_vehicle) {
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
  if (excludedCount > 0 || is_vehicle) {
    console.log(`[SECTION_RELEVANCE] key=${key} before=${items.length} after=${filtered.length} excluded=${excludedCount} topExcluded=${JSON.stringify(topExcluded)}`);
  }
  
  return { filtered, excluded: excludedCount, topExcluded };
}

/**
 * Extract price from eBay item
 */
function extractPriceFromItem(item: Record<string, unknown>): number | null {
  const priceObj = item.price as Record<string, unknown> | undefined;
  if (priceObj?.value !== undefined) {
    const val = typeof priceObj.value === "string" ? parseFloat(priceObj.value) : priceObj.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) return val;
  }
  
  const currentPrice = item.currentPrice as Record<string, unknown> | undefined;
  if (currentPrice?.value !== undefined) {
    const val = typeof currentPrice.value === "string" ? parseFloat(currentPrice.value) : currentPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) return val;
  }
  
  const pricingSummary = item.pricingSummary as Record<string, unknown> | undefined;
  const summaryPrice = pricingSummary?.price as Record<string, unknown> | undefined;
  if (summaryPrice?.value !== undefined) {
    const val = typeof summaryPrice.value === "string" ? parseFloat(summaryPrice.value) : summaryPrice.value;
    if (typeof val === "number" && !isNaN(val) && val > 0) return val;
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
  const { key, seed_queries, ebay_category, exclude_keywords = [], is_vehicle } = sectionConfig;

  if (!ebayToken) {
    console.error(`[CATALOG_HOME][SECTION_ERROR] correlationId=${correlationId} key=${key} error=NO_EBAY_TOKEN`);
    return { items: [], error: "eBay OAuth token not available", ms: Date.now() - startMs };
  }

  try {
    const enhancedQuery = buildEnhancedQuery(seed_queries, exclude_keywords);
    
    const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    searchUrl.searchParams.set("q", enhancedQuery);
    searchUrl.searchParams.set("limit", String(Math.min(limit * 3, 50)));
    
    if (ebay_category) {
      searchUrl.searchParams.set("category_ids", ebay_category);
    } else if (is_vehicle) {
      searchUrl.searchParams.set("category_ids", "6000");
    }

    console.log(`[CATALOG_HOME][SECTION] correlationId=${correlationId} key=${key} query="${enhancedQuery}" category=${ebay_category || 'none'}`);

    const response = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${ebayToken}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CATALOG_HOME][SECTION_ERROR] correlationId=${correlationId} key=${key} error=HTTP_${response.status}`);
      return { items: [], error: `eBay API error: ${response.status}`, ms: Date.now() - startMs };
    }

    const data = await response.json();
    const rawItems = data.itemSummaries || [];
    
    const mappedItems: CatalogItem[] = rawItems.map((item: Record<string, unknown>) => {
      const priceUsd = extractPriceFromItem(item);
      const imageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || null;
      const productUrl = (item.itemWebUrl as string) || null;
      const priceObj = item.price as Record<string, unknown> | undefined;
      
      return {
        id: `ebay_${item.itemId}`,
        provider: "ebay",
        provider_product_id: item.itemId as string,
        title: (item.title as string) || "Unknown",
        price_usd: priceUsd,
        priceUsd: priceUsd,
        currency: (priceObj?.currency as string) || "USD",
        image_url: imageUrl,
        imageUrl: imageUrl,
        product_url: productUrl,
        productUrl: productUrl,
        in_stock: true,
      };
    });
    
    const { filtered } = filterRelevantItems(mappedItems, sectionConfig, correlationId);
    const items = filtered.slice(0, limit);
    
    const ms = Date.now() - startMs;
    console.log(`[CATALOG_HOME][SECTION] correlationId=${correlationId} key=${key} rawCount=${rawItems.length} filteredCount=${items.length} ms=${ms}`);
    return { items, ms };
  } catch (err) {
    const ms = Date.now() - startMs;
    console.error(`[CATALOG_HOME][SECTION_ERROR] correlationId=${correlationId} key=${key} error=${err}`);
    return { items: [], error: String(err), ms };
  }
}

/**
 * Load sections from Admin Portal tables: home_sections + home_section_seeds
 */
async function loadHomeSectionsAndSeeds(): Promise<{ sections: SectionConfig[] | null; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return { sections: null, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  try {
    // Fetch enabled sections from home_sections (Admin Portal table)
    const sectionsRes = await fetch(
      `${supabaseUrl}/rest/v1/home_sections?enabled=eq.true&order=sort_order.asc&select=key,title_fr,title_en,ebay_category,min_price,is_vehicle,see_all_query,include_keywords,exclude_keywords,strict`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!sectionsRes.ok) {
      const errorText = await sectionsRes.text();
      return { sections: null, error: `home_sections error: ${sectionsRes.status} ${errorText.substring(0, 100)}` };
    }

    const sectionsData = await sectionsRes.json();
    if (!Array.isArray(sectionsData) || sectionsData.length === 0) {
      return { sections: null, error: "No enabled sections found in home_sections" };
    }

    // Fetch enabled seed queries from home_section_seeds
    const seedsRes = await fetch(
      `${supabaseUrl}/rest/v1/home_section_seeds?enabled=eq.true&select=section_key,query`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    let seedsData: Array<{ section_key: string; query: string }> = [];
    if (seedsRes.ok) {
      seedsData = await seedsRes.json();
    }

    // Group seeds by section_key
    const seedsMap = new Map<string, string[]>();
    for (const seed of seedsData) {
      if (!seedsMap.has(seed.section_key)) {
        seedsMap.set(seed.section_key, []);
      }
      seedsMap.get(seed.section_key)!.push(seed.query);
    }

    // Combine sections with their seeds
    const sections: SectionConfig[] = sectionsData.map((section: Record<string, unknown>) => {
      const key = section.key as string;
      const seeds = seedsMap.get(key) || [];
      
      // If no seeds configured, use the see_all_query as fallback
      const seedQueries = seeds.length > 0 
        ? seeds 
        : (section.see_all_query ? [section.see_all_query as string] : [key]);
      
      return {
        key,
        title_fr: section.title_fr as string,
        title_en: section.title_en as string,
        ebay_category: section.ebay_category as string | undefined,
        min_price: section.min_price as number | undefined,
        is_vehicle: section.is_vehicle as boolean | undefined,
        include_keywords: section.include_keywords as string[] || [],
        exclude_keywords: section.exclude_keywords as string[] || [],
        strict: section.strict !== false,
        seed_queries: seedQueries,
        see_all_query: section.see_all_query as string | undefined,
      };
    });

    console.log(`[CATALOG_HOME] Loaded ${sections.length} sections from home_sections with ${seedsData.length} total seeds`);
    return { sections };
  } catch (err) {
    return { sections: null, error: err instanceof Error ? err.message : String(err) };
  }
}

serve(async (req) => {
  const correlationId = generateCorrelationId();
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[CATALOG_HOME] start correlationId=${correlationId}`);

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

    const ebayToken = await getEbayToken();

    // Load sections from Admin Portal tables (home_sections + home_section_seeds)
    const { sections: dbSections, error: dbError } = await loadHomeSectionsAndSeeds();
    const sectionConfigs: SectionConfig[] = dbSections || FALLBACK_SECTIONS;

    if (dbError) {
      console.warn(`[CATALOG_HOME] db_error correlationId=${correlationId} error=${dbError} using_fallback=true`);
    }

    // Fetch items for each section in parallel
    const sectionPromises = sectionConfigs.map(async (config) => {
      const result = await fetchSectionItems(config, limitPerSection, correlationId, ebayToken);
      const title = locale === "en" ? config.title_en : config.title_fr;
      return {
        key: config.key,
        title,
        items: result.items,
        see_all: {
          q: config.see_all_query || config.seed_queries[0] || config.key,
          category_key: config.key,
        },
        _timing: result.ms,
      };
    });

    const sections = await Promise.all(sectionPromises);
    
    // Filter out empty sections
    const nonEmptySections = sections.filter(s => s.items.length > 0);

    const totalMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME] complete correlationId=${correlationId} sections=${nonEmptySections.length}/${sections.length} totalMs=${totalMs}`);

    return jsonResponse({
      ok: true,
      sections: nonEmptySections,
      meta: {
        locale,
        currency,
        correlationId,
        totalMs,
        sectionCount: nonEmptySections.length,
      },
      ttlSeconds: 1800,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[CATALOG_HOME] fatal correlationId=${correlationId} error=${errorMessage}`);
    return jsonResponse({ ok: false, error: errorMessage, sections: [] }, 500);
  }
});
