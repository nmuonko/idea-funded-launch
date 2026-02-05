import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * catalog-home-v2 - Homepage sections from Admin Portal configuration
 * 
 * Uses 2-pass filtering: strict first, then relaxed fallback to ensure
 * each section returns 10-20 items without starving results.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ===== FILTERING CONSTANTS =====
const TARGET_ITEMS = 12; // Default items per section
const MIN_ITEMS_RATIO = 0.66; // At least 66% of target before fallback
const STRICT_FETCH_MULTIPLIER = 4; // Fetch 4x target for strict pass
const RELAX_FETCH_MULTIPLIER = 6; // Fetch 6x target for relaxed pass

// Calculate min items threshold
function getMinItems(target: number): number {
  return Math.max(8, Math.floor(target * MIN_ITEMS_RATIO));
}

// ===== TIERED EXCLUDE KEYWORDS =====
// exclude_hard: ALWAYS exclude (true accessories/parts)
// exclude_soft: Only exclude in strict pass

interface ExcludeConfig {
  hard: string[];
  soft: string[];
}

const SECTION_EXCLUDES: Record<string, ExcludeConfig> = {
  phones: {
    hard: ["case", "cover", "screen protector", "tempered glass", "digitizer", "lcd", "housing", "frame", "back glass", "repair kit", "replacement part", "charger only", "lot of", "bulk"],
    soft: ["holder", "stand", "mount", "cable", "adapter"]
  },
  gaming: {
    hard: ["repair", "screwdriver", "tool kit", "replacement part", "shell", "housing", "mod chip", "flex cable", "ribbon cable"],
    soft: ["controller skin", "thumb grip", "charging dock"]
  },
  computers: {
    hard: ["sleeve", "sticker", "decal", "skin", "keyboard cover", "trackpad protector", "vinyl", "screen protector"],
    soft: ["stand", "bag", "mousepad", "hub", "dock"]
  },
  vehicles: {
    // Vehicles are ALWAYS strict - never fallback to accessories
    hard: ["seat cover", "floor mat", "steering wheel cover", "sticker", "decal", "hook", "organizer", "trim", "emblem", "badge", "keychain", "air freshener", "tissue box", "phone holder", "cup holder", "visor", "sunshade", "cargo liner", "dash cover", "headrest", "cushion", "protector", "accessory kit", "parts only"],
    soft: [] // No soft excludes - all strict for vehicles
  },
  clothing: {
    hard: ["laces only", "insole", "cleaner", "protector spray", "brush", "polish", "shoe tree"],
    soft: ["storage", "organizer"]
  },
  home_garden: {
    hard: ["replacement part", "repair kit", "cover only"],
    soft: ["cleaner", "polish", "spray"]
  },
  refurbished: {
    hard: ["for parts", "as is", "broken", "not working", "parts only"],
    soft: []
  },
  parts_accessories: {
    hard: [], // This section IS for parts/accessories
    soft: []
  }
};

// Hardcoded fallback sections
const FALLBACK_SECTIONS: SectionConfig[] = [
  { 
    key: "phones", title_fr: "Téléphones", title_en: "Phones", 
    ebay_category: "9355", min_price: 50, is_vehicle: false,
    include_keywords: ["iphone","samsung","galaxy","pixel","smartphone","unlocked","android","5g"],
    strict: true, seed_queries: ["iphone pro max", "samsung galaxy", "google pixel unlocked"]
  },
  { 
    key: "gaming", title_fr: "Gaming", title_en: "Gaming", 
    ebay_category: "1249", min_price: 20, is_vehicle: false,
    include_keywords: ["ps5","playstation","xbox","nintendo","switch","console","game","controller"],
    strict: true, seed_queries: ["ps5 console", "xbox series x", "nintendo switch oled"]
  },
  { 
    key: "computers", title_fr: "Ordinateurs", title_en: "Computers", 
    ebay_category: "58058", min_price: 100, is_vehicle: false,
    include_keywords: ["laptop","macbook","thinkpad","dell","hp","lenovo","surface","notebook","desktop","pc","computer"],
    strict: true, seed_queries: ["macbook pro", "dell xps laptop", "hp notebook"]
  },
  { 
    key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", 
    ebay_category: "6000", min_price: 1000, is_vehicle: true,
    include_keywords: ["toyota","honda","ford","bmw","mercedes","chevy","nissan","truck","suv","sedan","car","vehicle"],
    strict: true, seed_queries: ["toyota camry", "honda accord", "ford f150 truck"]
  },
  { 
    key: "clothing", title_fr: "Vêtements & Chaussures", title_en: "Clothing & Shoes", 
    ebay_category: "63889", min_price: 15, is_vehicle: false,
    include_keywords: ["shoes","sneakers","nike","adidas","jordan","dress","shirt","jacket","pants","jeans","boots"],
    strict: true, seed_queries: ["nike air max", "adidas ultraboost", "jordan retro"]
  },
  { 
    key: "home_garden", title_fr: "Maison & Jardin", title_en: "Home & Garden", 
    ebay_category: "11700", min_price: 10, is_vehicle: false,
    include_keywords: ["furniture","sofa","table","chair","lamp","decor","garden","patio","outdoor"],
    strict: true, seed_queries: ["patio furniture set", "home decor", "garden tools"]
  },
  { 
    key: "refurbished", title_fr: "Reconditionné", title_en: "Refurbished", 
    ebay_category: "11800", min_price: 50, is_vehicle: false,
    include_keywords: ["refurbished","renewed","certified","like new"],
    strict: true, seed_queries: ["refurbished iphone", "renewed macbook", "certified refurbished"]
  },
  { 
    key: "parts_accessories", title_fr: "Pièces & Accessoires", title_en: "Parts & Accessories", 
    ebay_category: "6028", min_price: 5, is_vehicle: false,
    include_keywords: ["parts","accessories","replacement","oem","aftermarket"],
    strict: false, seed_queries: ["car parts", "phone accessories", "laptop parts"]
  },
];

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
    ebayTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };
    return ebayTokenCache.token;
  } catch (err) {
    console.error(`[CATALOG_HOME_V2] eBay OAuth exception: ${err}`);
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

function getExcludeConfig(sectionKey: string): ExcludeConfig {
  return SECTION_EXCLUDES[sectionKey] || { hard: [], soft: [] };
}

/**
 * Build query with negative keywords for eBay
 */
function buildEnhancedQuery(seedQuery: string, excludeKeywords: string[], maxNegatives = 6): string {
  if (!excludeKeywords || excludeKeywords.length === 0) {
    return seedQuery;
  }
  
  // eBay supports "-term" to exclude
  const negatives = excludeKeywords.slice(0, maxNegatives).map(kw => `-${kw.replace(/\s+/g, '')}`);
  return `${seedQuery} ${negatives.join(' ')}`;
}

/**
 * Check if title contains any include keyword (for relevance boost)
 */
function hasIncludeKeyword(title: string, includeKeywords: string[]): boolean {
  if (!includeKeywords || includeKeywords.length === 0) return true;
  const lowerTitle = title.toLowerCase();
  return includeKeywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

interface FilterResult {
  kept: CatalogItem[];
  droppedHard: number;
  droppedSoft: number;
  droppedPrice: number;
  topDropped: string[];
}

/**
 * STRICT pass filter - applies all exclude rules
 */
function filterStrict(
  items: CatalogItem[],
  config: SectionConfig,
  excludeConfig: ExcludeConfig
): FilterResult {
  const { min_price, include_keywords = [], is_vehicle } = config;
  const { hard, soft } = excludeConfig;
  
  // Build patterns
  const hardPatterns = hard.map(kw => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  const softPatterns = soft.map(kw => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  
  // For non-vehicle sections, only apply accessory regex if item lacks include keywords
  const accessoryRegex = /(case|cover|sleeve|skin|sticker|decal|protector|replacement|repair|tool|kit|parts|holder|mount|stand|bag|pouch|wallet|strap|hook|organizer|mat|trim)/i;
  
  // Vehicle-specific strict filter
  const vehiclePartsRegex = /(seat cover|floor mat|steering wheel|dash|bumper|fender|mirror|hood|door panel|trunk|cargo|headlight|taillight|wheel cover|hub cap|antenna|emblem|badge|decal|sticker|air freshener|tissue|cup holder|phone holder|sun visor|key|remote|fob|charger|mount|stand|hook|organizer|liner|cushion|mat|cover|protector|parts only|accessory)/i;
  
  let droppedHard = 0;
  let droppedSoft = 0;
  let droppedPrice = 0;
  const topDropped: string[] = [];
  
  const kept = items.filter(item => {
    const title = (item.title || '').toLowerCase();
    const price = item.price_usd ?? item.priceUsd ?? 0;
    
    // Skip items with no title or image
    if (!item.title || (!item.image_url && !item.imageUrl)) {
      return false;
    }
    
    // Price floor check
    if (min_price && price > 0 && price < min_price) {
      droppedPrice++;
      if (topDropped.length < 5) topDropped.push(`price<${min_price}: ${title.substring(0,35)}`);
      return false;
    }
    
    // Hard exclude - always drop
    for (const pattern of hardPatterns) {
      if (pattern.test(title)) {
        droppedHard++;
        if (topDropped.length < 5) topDropped.push(`hard: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    // Soft exclude - only in strict pass
    for (const pattern of softPatterns) {
      if (pattern.test(title)) {
        droppedSoft++;
        if (topDropped.length < 5) topDropped.push(`soft: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    // Vehicle mode: extra strict - always filter parts
    if (is_vehicle && vehiclePartsRegex.test(title)) {
      droppedHard++;
      if (topDropped.length < 5) topDropped.push(`vehicle_part: ${title.substring(0,35)}`);
      return false;
    }
    
    // Accessory check: ONLY if title lacks include keywords
    // This prevents over-filtering actual products
    if (!is_vehicle && accessoryRegex.test(title)) {
      if (!hasIncludeKeyword(title, include_keywords)) {
        droppedSoft++;
        if (topDropped.length < 5) topDropped.push(`accessory_no_kw: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    return true;
  });
  
  return { kept, droppedHard, droppedSoft, droppedPrice, topDropped };
}

/**
 * RELAXED pass filter - only applies hard excludes
 */
function filterRelaxed(
  items: CatalogItem[],
  config: SectionConfig,
  excludeConfig: ExcludeConfig
): FilterResult {
  const { min_price, is_vehicle } = config;
  const { hard } = excludeConfig;
  
  const hardPatterns = hard.map(kw => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  
  // Vehicle parts - still strict for vehicles
  const vehiclePartsRegex = /(seat cover|floor mat|steering wheel|dash|bumper|fender|mirror|hood|door panel|headlight|taillight|emblem|badge|decal|sticker|air freshener|tissue|cup holder|phone holder|sun visor|parts only|accessory kit)/i;
  
  let droppedHard = 0;
  let droppedPrice = 0;
  const topDropped: string[] = [];
  
  const kept = items.filter(item => {
    const title = (item.title || '').toLowerCase();
    const price = item.price_usd ?? item.priceUsd ?? 0;
    
    if (!item.title || (!item.image_url && !item.imageUrl)) {
      return false;
    }
    
    // Price floor - slightly relaxed (80% of min_price)
    const relaxedMinPrice = min_price ? min_price * 0.8 : 0;
    if (relaxedMinPrice && price > 0 && price < relaxedMinPrice) {
      droppedPrice++;
      return false;
    }
    
    // Hard exclude only
    for (const pattern of hardPatterns) {
      if (pattern.test(title)) {
        droppedHard++;
        if (topDropped.length < 5) topDropped.push(`hard: ${title.substring(0,35)}`);
        return false;
      }
    }
    
    // Vehicle mode remains strict
    if (is_vehicle && vehiclePartsRegex.test(title)) {
      droppedHard++;
      return false;
    }
    
    return true;
  });
  
  return { kept, droppedHard, droppedSoft: 0, droppedPrice, topDropped };
}

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

function mapEbayItem(item: Record<string, unknown>): CatalogItem {
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
}

async function fetchEbayItems(
  query: string,
  category: string | undefined,
  limit: number,
  ebayToken: string,
  correlationId: string
): Promise<CatalogItem[]> {
  const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", String(Math.min(limit, 50)));
  
  if (category) {
    searchUrl.searchParams.set("category_ids", category);
  }

  const response = await fetch(searchUrl.toString(), {
    headers: {
      Authorization: `Bearer ${ebayToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!response.ok) {
    console.error(`[CATALOG_HOME_V2] eBay fetch error: ${response.status}`);
    return [];
  }

  const data = await response.json();
  const rawItems = data.itemSummaries || [];
  return rawItems.map(mapEbayItem);
}

/**
 * 2-PASS FETCH: Strict first, then relaxed fallback
 */
async function fetchSectionItems(
  sectionConfig: SectionConfig,
  targetLimit: number,
  correlationId: string,
  ebayToken: string | null
): Promise<{ items: CatalogItem[]; error?: string; ms: number }> {
  const startMs = Date.now();
  const { key, seed_queries, ebay_category, is_vehicle, include_keywords = [] } = sectionConfig;

  if (!ebayToken) {
    console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} error=NO_EBAY_TOKEN`);
    return { items: [], error: "eBay OAuth token not available", ms: Date.now() - startMs };
  }

  const excludeConfig = getExcludeConfig(key);
  const minItems = getMinItems(targetLimit);
  const strictFetchLimit = targetLimit * STRICT_FETCH_MULTIPLIER;
  const relaxFetchLimit = targetLimit * RELAX_FETCH_MULTIPLIER;

  try {
    // Pick a random seed query
    const randomSeed = seed_queries[Math.floor(Math.random() * seed_queries.length)] || seed_queries[0] || key;
    
    // ===== PASS 1: STRICT =====
    // Build query with both hard and soft excludes
    const allExcludes = [...excludeConfig.hard, ...excludeConfig.soft.slice(0, 3)];
    const strictQuery = buildEnhancedQuery(randomSeed, allExcludes, 6);
    
    console.log(`[SECTION_PASS] key=${key} pass=strict query="${strictQuery.substring(0, 60)}..." fetchLimit=${strictFetchLimit}`);
    
    const strictRaw = await fetchEbayItems(
      strictQuery,
      ebay_category || (is_vehicle ? "6000" : undefined),
      strictFetchLimit,
      ebayToken,
      correlationId
    );
    
    const strictResult = filterStrict(strictRaw, sectionConfig, excludeConfig);
    
    console.log(`[SECTION_PASS] key=${key} pass=strict fetched=${strictRaw.length} kept=${strictResult.kept.length} droppedHard=${strictResult.droppedHard} droppedSoft=${strictResult.droppedSoft} droppedPrice=${strictResult.droppedPrice}`);
    
    // If strict pass is sufficient, return
    if (strictResult.kept.length >= minItems) {
      const items = strictResult.kept.slice(0, targetLimit);
      const ms = Date.now() - startMs;
      console.log(`[SECTION_DONE] key=${key} returned=${items.length} source=strict ms=${ms}`);
      return { items, ms };
    }
    
    // ===== VEHICLES: NO FALLBACK =====
    // Vehicles must stay strict - try broader vehicle queries instead
    if (is_vehicle) {
      // Try additional vehicle queries
      const extraVehicleQueries = ["rav4", "camry", "corolla", "civic", "accord", "f150", "silverado", "tacoma"];
      const extraQuery = extraVehicleQueries[Math.floor(Math.random() * extraVehicleQueries.length)];
      const vehicleQuery = buildEnhancedQuery(extraQuery, excludeConfig.hard, 8);
      
      console.log(`[SECTION_PASS] key=${key} pass=vehicle_expand query="${vehicleQuery}"`);
      
      const extraRaw = await fetchEbayItems(vehicleQuery, "6000", relaxFetchLimit, ebayToken, correlationId);
      const extraResult = filterStrict(extraRaw, sectionConfig, excludeConfig);
      
      // Dedupe and combine
      const seenIds = new Set(strictResult.kept.map(i => i.id));
      const combined = [...strictResult.kept];
      for (const item of extraResult.kept) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          combined.push(item);
        }
      }
      
      const items = combined.slice(0, targetLimit);
      const ms = Date.now() - startMs;
      console.log(`[SECTION_DONE] key=${key} returned=${items.length} source=vehicle_expand ms=${ms}`);
      return { items, ms };
    }
    
    // ===== PASS 2: RELAXED (non-vehicles only) =====
    // Build query with only hard excludes
    const relaxQuery = buildEnhancedQuery(randomSeed, excludeConfig.hard, 4);
    
    console.log(`[SECTION_PASS] key=${key} pass=relax query="${relaxQuery.substring(0, 60)}..." fetchLimit=${relaxFetchLimit}`);
    
    const relaxRaw = await fetchEbayItems(
      relaxQuery,
      ebay_category,
      relaxFetchLimit,
      ebayToken,
      correlationId
    );
    
    const relaxResult = filterRelaxed(relaxRaw, sectionConfig, excludeConfig);
    
    console.log(`[SECTION_PASS] key=${key} pass=relax fetched=${relaxRaw.length} kept=${relaxResult.kept.length} droppedHard=${relaxResult.droppedHard}`);
    
    // Dedupe and combine strict + relaxed
    const seenIds = new Set(strictResult.kept.map(i => i.id));
    const combined = [...strictResult.kept];
    
    for (const item of relaxResult.kept) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        combined.push(item);
      }
    }
    
    const items = combined.slice(0, targetLimit);
    const ms = Date.now() - startMs;
    
    console.log(`[SECTION_DONE] key=${key} returned=${items.length} source=combined strictKept=${strictResult.kept.length} relaxKept=${relaxResult.kept.length} ms=${ms} topDropped=${JSON.stringify(strictResult.topDropped.slice(0,3))}`);
    
    return { items, ms };
  } catch (err) {
    const ms = Date.now() - startMs;
    console.error(`[CATALOG_HOME_V2][SECTION_ERROR] correlationId=${correlationId} key=${key} error=${err}`);
    return { items: [], error: String(err), ms };
  }
}

async function loadHomeSectionsAndSeeds(): Promise<{ sections: SectionConfig[] | null; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return { sections: null, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  try {
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

    const seedsMap = new Map<string, string[]>();
    for (const seed of seedsData) {
      if (!seedsMap.has(seed.section_key)) {
        seedsMap.set(seed.section_key, []);
      }
      seedsMap.get(seed.section_key)!.push(seed.query);
    }

    const sections: SectionConfig[] = sectionsData.map((section: Record<string, unknown>) => {
      const key = section.key as string;
      const seeds = seedsMap.get(key) || [];
      
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
        strict: section.strict !== false,
        seed_queries: seedQueries,
        see_all_query: section.see_all_query as string | undefined,
      };
    });

    console.log(`[CATALOG_HOME_V2] Loaded ${sections.length} sections from home_sections with ${seedsData.length} total seeds`);
    return { sections };
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
    let limitPerSection = TARGET_ITEMS;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        locale = body.locale || "fr";
        currency = body.currency || "USD";
        limitPerSection = Math.min(Math.max(body.limitPerSection || TARGET_ITEMS, 1), 50);
      } catch {
        // Use defaults
      }
    } else {
      const url = new URL(req.url);
      locale = url.searchParams.get("locale") || url.searchParams.get("lang") || "fr";
      currency = url.searchParams.get("currency") || "USD";
      const limitParam = url.searchParams.get("limitPerSection") || url.searchParams.get("limit");
      if (limitParam) {
        limitPerSection = Math.min(Math.max(parseInt(limitParam, 10) || TARGET_ITEMS, 1), 50);
      }
    }

    console.log(`[CATALOG_HOME_V2] correlationId=${correlationId} locale=${locale} limitPerSection=${limitPerSection}`);

    // Load sections from Admin Portal tables
    const { sections: dbSections, error: dbError } = await loadHomeSectionsAndSeeds();
    
    if (dbError) {
      console.warn(`[CATALOG_HOME_V2] DB load warning: ${dbError}, using fallback sections`);
    }

    const sections = dbSections || FALLBACK_SECTIONS;
    
    // Get eBay token
    const ebayToken = await getEbayToken();
    if (!ebayToken) {
      console.error(`[CATALOG_HOME_V2] correlationId=${correlationId} error=NO_EBAY_TOKEN`);
      return jsonResponse({ ok: false, error: "eBay authentication failed", sections: [] }, 500);
    }

    // Fetch all sections in parallel
    const sectionPromises = sections.map(async (section) => {
      const { items, error, ms } = await fetchSectionItems(section, limitPerSection, correlationId, ebayToken);
      
      return {
        key: section.key,
        title: locale === "fr" ? section.title_fr : section.title_en,
        title_fr: section.title_fr,
        title_en: section.title_en,
        items,
        see_all: {
          q: section.see_all_query || section.key,
          category_key: section.key,
        },
        error,
        ms,
      };
    });

    const results = await Promise.all(sectionPromises);
    
    // Filter out empty sections (but log them)
    const nonEmptySections = results.filter(r => {
      if (r.items.length === 0) {
        console.warn(`[CATALOG_HOME_V2] Section ${r.key} returned 0 items`);
        return false;
      }
      return true;
    });

    const totalMs = Date.now() - startTime;
    console.log(`[CATALOG_HOME_V2] correlationId=${correlationId} totalSections=${nonEmptySections.length} totalMs=${totalMs}`);

    return jsonResponse({
      ok: true,
      sections: nonEmptySections,
      ttlSeconds: 1800,
      correlationId,
    });
  } catch (err) {
    console.error(`[CATALOG_HOME_V2] correlationId=${correlationId} error=${err}`);
    return jsonResponse({ ok: false, error: String(err), sections: [] }, 500);
  }
});
