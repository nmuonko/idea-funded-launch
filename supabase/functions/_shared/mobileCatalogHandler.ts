/**
 * Mobile Catalog Handler - Guaranteed 8-section mobile response
 * 
 * PRODUCTION HOTFIX: This module ensures mobile NEVER sees "Catalogue Indisponible"
 * - Always returns ok:true with 8 sections
 * - 4-tier fallback: Fresh Cache → Stale Cache → Env Fallback → DB Bootstrap
 * - If all fails, returns 8 empty sections (still ok:true)
 */

// ============= TYPES =============

export interface CatalogItem {
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
  segment?: string;
}

export interface MobileSectionResponse {
  key: string;
  title: string;
  title_fr: string;
  title_en: string;
  items: CatalogItem[];
}

export interface MobileResponse {
  ok: true; // ALWAYS true for mobile
  sections: MobileSectionResponse[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasMore: boolean;
  hasMoreCached: boolean;
  ttlSeconds: number;
  correlationId: string;
  meta: {
    client: "mobile";
    envUsed: string;
    envRequested: string;
    source: string;
    isStale: boolean;
    correlationId: string;
    ts: number;
  };
}

// ============= CONSTANTS =============

// EXACT 8 SECTIONS expected by mobile app - DO NOT CHANGE
export const MOBILE_SECTIONS = [
  { 
    key: "phones", 
    title_fr: "Téléphones", 
    title_en: "Phones",
    keywords: ["iphone", "samsung", "galaxy", "pixel", "phone", "smartphone", "android", "mobile", "unlocked"],
    target: 20 
  },
  { 
    key: "electronics", 
    title_fr: "Électronique", 
    title_en: "Electronics",
    keywords: ["laptop", "airpods", "headphones", "camera", "tv", "monitor", "charger", "tablet", "speaker", "earbuds", "audio", "bluetooth"],
    target: 20 
  },
  { 
    key: "vehicles", 
    title_fr: "Véhicules", 
    title_en: "Vehicles",
    keywords: ["car", "toyota", "honda", "bmw", "mercedes", "ford", "suv", "truck", "motorcycle", "vehicle", "auto"],
    target: 20 
  },
  { 
    key: "video_games", 
    title_fr: "Jeux Vidéo", 
    title_en: "Video Games",
    keywords: ["playstation", "ps5", "xbox", "nintendo", "switch", "console", "controller", "gaming", "game"],
    target: 20 
  },
  { 
    key: "clothing_fashion", 
    title_fr: "Vêtements et Mode", 
    title_en: "Clothing & Fashion",
    keywords: ["shoes", "sneakers", "nike", "adidas", "jacket", "hoodie", "jeans", "dress", "jordan", "shirt"],
    target: 20 
  },
  { 
    key: "home_garden", 
    title_fr: "Maison et Jardin", 
    title_en: "Home & Garden",
    keywords: ["sofa", "table", "chair", "bed", "kitchen", "furniture", "decor", "garden", "home", "lamp"],
    target: 20 
  },
  { 
    key: "toys", 
    title_fr: "Jouets", 
    title_en: "Toys",
    keywords: ["lego", "toy", "kids", "doll", "puzzle", "barbie", "figure", "children"],
    target: 20 
  },
  { 
    key: "sporting_goods", 
    title_fr: "Articles de Sport", 
    title_en: "Sporting Goods",
    keywords: ["gym", "fitness", "soccer", "basketball", "tennis", "sport", "running", "exercise", "yoga", "football"],
    target: 20 
  },
];

const DEFAULT_TTL_SECONDS = 172800; // 2 days

// ============= CORS HEADERS =============

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-afrishop-client, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type, x-correlation-id",
};

// ============= MOBILE DETECTION =============

/**
 * ROBUST mobile detection - treat as mobile if ANY condition is true
 */
export function isMobileClient(req: Request): boolean {
  const userAgent = (req.headers.get("user-agent") || "").toLowerCase();
  const clientInfo = (req.headers.get("x-supabase-client-info") || req.headers.get("x-client-info") || "").toLowerCase();
  const platform = (req.headers.get("x-supabase-client-platform") || "").toLowerCase();
  const afrishopClient = (req.headers.get("x-afrishop-client") || "").toLowerCase();
  
  return (
    userAgent.includes("okhttp") ||
    userAgent.includes("expo") ||
    userAgent.includes("reactnative") ||
    userAgent.includes("react-native") ||
    clientInfo.includes("expo") ||
    clientInfo.includes("react-native") ||
    clientInfo.includes("reactnative") ||
    platform === "android" ||
    platform === "ios" ||
    afrishopClient.includes("mobile")
  );
}

// ============= ENVIRONMENT NORMALIZATION =============

export function normalizeEnv(req: Request): { envRequested: string; envUsed: string } {
  const url = new URL(req.url);
  
  let envRequested = url.searchParams.get("env") 
    || req.headers.get("X-Afrishop-Environment") 
    || req.headers.get("x-afrishop-environment")
    || "production";
  
  envRequested = envRequested.toLowerCase().trim();
  
  let envUsed = envRequested;
  
  // Normalize "prod" -> "production"
  if (envUsed === "prod") {
    envUsed = "production";
  }
  
  // Validate - default to production
  if (envUsed !== "production" && envUsed !== "staging" && envUsed !== "dev") {
    envUsed = "production";
  }
  
  return { envRequested, envUsed };
}

// ============= BUILD SECTIONS FROM ITEMS =============

/**
 * Build 8 sections from items pool - ALWAYS returns 8 sections
 */
export function buildMobileSections(items: CatalogItem[], locale: string = "fr"): MobileSectionResponse[] {
  const sections: MobileSectionResponse[] = [];
  const usedItems = new Set<string>();
  
  // Always create all 8 sections
  for (const sectionDef of MOBILE_SECTIONS) {
    const sectionItems: CatalogItem[] = [];
    
    // Try to find items matching keywords
    if (items && items.length > 0) {
      for (const item of items) {
        if (usedItems.has(item.id)) continue;
        if (sectionItems.length >= sectionDef.target) break;
        
        const titleLower = (item.title || "").toLowerCase();
        const matchesKeyword = sectionDef.keywords.some(kw => titleLower.includes(kw));
        
        if (matchesKeyword) {
          sectionItems.push(item);
          usedItems.add(item.id);
        }
      }
    }
    
    sections.push({
      key: sectionDef.key,
      title: locale === "fr" ? sectionDef.title_fr : sectionDef.title_en,
      title_fr: sectionDef.title_fr,
      title_en: sectionDef.title_en,
      items: sectionItems,
    });
  }
  
  // If most sections are empty but we have items, redistribute evenly
  const sectionsWithItems = sections.filter(s => s.items.length > 0);
  if (sectionsWithItems.length < 3 && items && items.length > 0) {
    // Clear and redistribute
    const itemsPerSection = Math.ceil(items.length / MOBILE_SECTIONS.length);
    let offset = 0;
    
    for (let i = 0; i < sections.length; i++) {
      const sectionDef = MOBILE_SECTIONS[i];
      const sectionItems = items.slice(offset, offset + Math.min(itemsPerSection, sectionDef.target));
      offset += itemsPerSection;
      
      sections[i].items = sectionItems;
    }
  }
  
  return sections;
}

// ============= 4-TIER FALLBACK =============

interface CacheResult {
  items: CatalogItem[];
  source: string;
  isStale: boolean;
}

/**
 * TIER A: Fresh cache (not expired)
 */
async function getFreshCache(env: string, category: string = "all"): Promise<CacheResult | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !serviceRoleKey) return null;
  
  const cacheKey = `${env}:${category}`;
  
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/catalog_home_cache?id=eq.${encodeURIComponent(cacheKey)}&expires_at=gt.${new Date().toISOString()}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );
    
    if (res.ok && res.status !== 406) {
      const data = await res.json();
      if (data && data.items && data.items.length > 0) {
        return { items: data.items, source: "cache", isStale: false };
      }
    }
  } catch (e) {
    console.warn(`[MOBILE_HANDLER] Fresh cache error: ${e}`);
  }
  
  return null;
}

/**
 * TIER B: Stale cache (expired but still has data)
 */
async function getStaleCache(env: string, category: string = "all"): Promise<CacheResult | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !serviceRoleKey) return null;
  
  const cacheKey = `${env}:${category}`;
  
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/catalog_home_cache?id=eq.${encodeURIComponent(cacheKey)}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );
    
    if (res.ok && res.status !== 406) {
      const data = await res.json();
      if (data && data.items && data.items.length > 0) {
        return { items: data.items, source: "stale_cache", isStale: true };
      }
    }
  } catch (e) {
    console.warn(`[MOBILE_HANDLER] Stale cache error: ${e}`);
  }
  
  return null;
}

/**
 * TIER D: Bootstrap from catalog_items table (CRITICAL SAFETY NET)
 */
async function bootstrapFromDatabase(correlationId: string): Promise<CacheResult | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !serviceRoleKey) return null;
  
  try {
    console.log(`[MOBILE_HANDLER] Bootstrap from DB correlationId=${correlationId}`);
    
    const res = await fetch(
      `${supabaseUrl}/rest/v1/catalog_items?provider=in.(amazon,ebay)&price_usd=gt.0&image_url=neq.null&is_disallowed=eq.false&order=updated_at.desc.nullslast,created_at.desc&limit=300`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );
    
    if (!res.ok) {
      console.error(`[MOBILE_HANDLER] DB bootstrap failed: ${res.status}`);
      return null;
    }
    
    const rows = await res.json() as Array<Record<string, unknown>>;
    
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn(`[MOBILE_HANDLER] No items in catalog_items`);
      return null;
    }
    
    const items: CatalogItem[] = rows.map(row => ({
      id: `${row.provider}_${row.provider_product_id}`,
      provider: row.provider as string,
      provider_product_id: row.provider_product_id as string,
      title: row.title as string || "Product",
      price_usd: row.price_usd as number | null,
      priceUsd: row.price_usd as number | null,
      currency: "USD",
      image_url: row.image_url as string | null,
      imageUrl: row.image_url as string | null,
      product_url: row.product_url as string | null,
      productUrl: row.product_url as string | null,
      in_stock: true,
    })).filter(item => item.title && item.image_url && item.price_usd && item.price_usd > 0);
    
    console.log(`[MOBILE_HANDLER] Bootstrap got ${items.length} items`);
    
    return { items, source: "db_bootstrap", isStale: true };
  } catch (e) {
    console.error(`[MOBILE_HANDLER] Bootstrap exception: ${e}`);
    return null;
  }
}

/**
 * MAIN: Get mobile data using 4-tier fallback
 * ALWAYS returns items (empty array if all tiers fail)
 */
export async function getMobileData(
  envRequested: string,
  envUsed: string,
  correlationId: string
): Promise<CacheResult> {
  // TIER A: Fresh cache for requested env
  let result = await getFreshCache(envUsed, "all");
  if (result) {
    console.log(`[MOBILE_HANDLER] correlationId=${correlationId} tier=A fresh_cache env=${envUsed} items=${result.items.length}`);
    return result;
  }
  
  // TIER B: Stale cache for requested env
  result = await getStaleCache(envUsed, "all");
  if (result) {
    console.log(`[MOBILE_HANDLER] correlationId=${correlationId} tier=B stale_cache env=${envUsed} items=${result.items.length}`);
    return result;
  }
  
  // TIER C: Env fallback - try production if we requested something else
  if (envUsed !== "production") {
    result = await getFreshCache("production", "all");
    if (result) {
      console.log(`[MOBILE_HANDLER] correlationId=${correlationId} tier=C env_fallback_fresh items=${result.items.length}`);
      return { ...result, source: "env_fallback_fresh" };
    }
    
    result = await getStaleCache("production", "all");
    if (result) {
      console.log(`[MOBILE_HANDLER] correlationId=${correlationId} tier=C env_fallback_stale items=${result.items.length}`);
      return { ...result, source: "env_fallback_stale" };
    }
  }
  
  // TIER D: Bootstrap from database
  result = await bootstrapFromDatabase(correlationId);
  if (result) {
    console.log(`[MOBILE_HANDLER] correlationId=${correlationId} tier=D db_bootstrap items=${result.items.length}`);
    return result;
  }
  
  // ALL TIERS FAILED: Return empty but ok:true
  console.warn(`[MOBILE_HANDLER] correlationId=${correlationId} ALL_TIERS_FAILED returning empty`);
  return { items: [], source: "empty_fallback", isStale: true };
}

// ============= BUILD GUARANTEED MOBILE RESPONSE =============

/**
 * Build the GUARANTEED mobile response - ALWAYS ok:true with 8 sections
 */
export function buildMobileResponse(
  items: CatalogItem[],
  locale: string,
  correlationId: string,
  source: string,
  isStale: boolean,
  envUsed: string,
  envRequested: string
): MobileResponse {
  const sections = buildMobileSections(items, locale);
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  
  return {
    ok: true, // ALWAYS TRUE
    sections,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    totalItems,
    hasMore: false,
    hasMoreCached: false,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    correlationId,
    meta: {
      client: "mobile",
      envUsed,
      envRequested,
      source,
      isStale,
      correlationId,
      ts: Date.now(),
    },
  };
}

// ============= MAIN HANDLER =============

/**
 * Handle a mobile catalog request with 4-tier fallback
 * GUARANTEED to return ok:true with 8 sections
 */
export async function handleMobileCatalogRequest(
  req: Request,
  correlationId: string,
  functionName: string = "CATALOG_HOME"
): Promise<Response> {
  const { envRequested, envUsed } = normalizeEnv(req);
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") || "fr";
  const ua = req.headers.get("user-agent") || "";
  
  console.log(`[${functionName}] correlationId=${correlationId} path=${url.pathname} isMobile=true ua=${ua.substring(0, 50)} envReq=${envRequested} envUsed=${envUsed}`);
  
  try {
    const { items, source, isStale } = await getMobileData(envRequested, envUsed, correlationId);
    const response = buildMobileResponse(items, locale, correlationId, source, isStale, envUsed, envRequested);
    
    const totalItems = response.sections.reduce((sum, s) => sum + s.items.length, 0);
    console.log(`[${functionName}] correlationId=${correlationId} tier=${source} sections=8 itemsTotal=${totalItems}`);
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    // CRITICAL: Even on exception, return ok:true with empty sections
    console.error(`[${functionName}][ERROR] correlationId=${correlationId} error=${err}`);
    
    const response = buildMobileResponse([], locale, correlationId, "exception_fallback", true, envUsed, envRequested);
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

/**
 * Generate a correlation ID with prefix
 */
export function generateCorrelationId(prefix: string = "ch"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
