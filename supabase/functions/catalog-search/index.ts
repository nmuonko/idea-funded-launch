/**
 * Catalog Search Endpoint with Smart French Query Expansion
 * Search products via Rainforest API with server-side cache
 * 
 * GET /catalog-search?q=écouteurs bluetooth&expand=1&lang=fr&page=1&pageSize=20
 * 
 * Smart expansion (expand=1):
 * - Detects if query is French vs English
 * - French queries: translates to English + adds synonyms (max 3 variants)
 * - English queries: uses original + cleaned variant (max 2 variants)
 * - Merges/dedupes results by ASIN
 * 
 * Caching:
 * - Cache by normalized query + expand + page/pageSize + amazon_domain
 * - Repeated searches return in <300ms from cache
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { searchRainforest, formatCatalogItem } from "../_shared/rainforestAdapter.ts";
import { 
  buildCacheKey, 
  getCache, 
  setCache, 
  checkRateLimit, 
  rateLimitResponse, 
  getDeviceId,
} from "../_shared/catalogCache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=60",
};

// Cache TTL in seconds (30 minutes)
const CACHE_TTL_SECONDS = 30 * 60;

// ==================== LANGUAGE DETECTION ====================

// French commerce keywords (with and without accents)
const FRENCH_KEYWORDS = new Set([
  // Electronics
  "téléphone", "telephone", "téléphones", "telephones",
  "écouteurs", "ecouteurs", "casque", "casques",
  "ordinateur", "ordinateurs", "portable", "portables",
  "chargeur", "chargeurs", "câble", "cable", "câbles", "cables",
  "écran", "ecran", "écrans", "ecrans",
  "souris", "clavier", "claviers",
  "enceinte", "enceintes", "haut-parleur",
  "tablette", "tablettes",
  "montre", "montres", "connectée", "connectee",
  "batterie", "batteries", "pile", "piles",
  "imprimante", "imprimantes",
  "webcam", "micro", "microphone",
  // Gaming
  "manette", "manettes", "console", "consoles",
  "jeux", "jeu", "vidéo", "video",
  // Home
  "télévision", "television", "télé", "tele", "téléviseur", "televiseur",
  "lampe", "lampes", "ventilateur", "ventilateurs",
  "climatiseur", "réfrigérateur", "refrigerateur",
  // Accessories
  "coque", "coques", "étui", "etui",
  "accessoire", "accessoires", "sac", "sacs", "sacoche",
  "protection", "protecteur", "verre", "trempé", "trempe",
  // Descriptors
  "sans", "fil", "bluetooth", "solaire",
  "nouveau", "nouvelle", "meilleur", "meilleure",
  "pas", "cher", "bon", "marché", "marche",
  "qualité", "qualite", "original", "originaux",
]);

// French stopwords for additional detection
const FRENCH_STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "pour",
  "avec", "dans", "sur", "par", "en", "au", "aux", "ce", "cette", "ces",
]);

// English-only terms (model numbers, brands that indicate English context)
const ENGLISH_INDICATORS = new Set([
  "iphone", "samsung", "galaxy", "pixel", "macbook", "airpods",
  "playstation", "xbox", "nintendo", "switch", "ps5", "ps4",
  "kindle", "alexa", "echo", "gopro", "dyson", "roomba",
  "wireless", "bluetooth", "charger", "case", "cover", "screen",
  "laptop", "tablet", "headphones", "earbuds", "speaker", "monitor",
  "keyboard", "mouse", "printer", "camera", "smartwatch", "phone",
]);

// ==================== TRANSLATION DICTIONARY ====================

// French to English translation dictionary (commerce terms)
const FRENCH_TO_ENGLISH: Record<string, string> = {
  // Phones & Mobile
  "téléphone": "phone",
  "telephone": "phone",
  "téléphones": "phones",
  "telephones": "phones",
  "portable": "mobile phone",
  "portables": "mobile phones",
  "smartphone": "smartphone",
  "smartphones": "smartphones",
  "coque": "phone case",
  "coques": "phone cases",
  "étui": "case",
  "etui": "case",
  "chargeur": "charger",
  "chargeurs": "chargers",
  "câble": "cable",
  "cable": "cable",
  "câbles": "cables",
  "cables": "cables",
  
  // Audio
  "écouteurs": "earbuds",
  "ecouteurs": "earbuds",
  "casque": "headphones",
  "casques": "headphones",
  "enceinte": "speaker",
  "enceintes": "speakers",
  "haut-parleur": "speaker",
  "haut parleur": "speaker",
  "micro": "microphone",
  "microphone": "microphone",
  
  // Computers
  "ordinateur": "computer",
  "ordinateurs": "computers",
  "ordinateur portable": "laptop",
  "pc portable": "laptop",
  "laptop": "laptop",
  "clavier": "keyboard",
  "claviers": "keyboards",
  "souris": "mouse",
  "écran": "monitor",
  "ecran": "monitor",
  "écrans": "monitors",
  "ecrans": "monitors",
  "moniteur": "monitor",
  "moniteurs": "monitors",
  "imprimante": "printer",
  "imprimantes": "printers",
  "disque dur": "hard drive",
  "ssd": "ssd",
  "mémoire": "memory",
  "memoire": "memory",
  "ram": "ram",
  "processeur": "processor",
  "carte graphique": "graphics card",
  "webcam": "webcam",
  
  // Power
  "batterie": "battery",
  "batteries": "batteries",
  "batterie externe": "power bank",
  "powerbank": "power bank",
  "power bank": "power bank",
  "pile": "battery",
  "piles": "batteries",
  "adaptateur": "adapter",
  "adaptateurs": "adapters",
  
  // Gaming
  "jeux": "games",
  "jeu": "game",
  "jeux vidéo": "video games",
  "jeux video": "video games",
  "manette": "controller",
  "manettes": "controllers",
  "console": "console",
  "consoles": "consoles",
  
  // Home & Electronics
  "télévision": "television",
  "television": "television",
  "télé": "tv",
  "tele": "tv",
  "tv": "tv",
  "téléviseur": "tv",
  "televiseur": "tv",
  "montre": "watch",
  "montres": "watches",
  "montre connectée": "smartwatch",
  "montre connectee": "smartwatch",
  "smartwatch": "smartwatch",
  "tablette": "tablet",
  "tablettes": "tablets",
  "lampe": "lamp",
  "lampes": "lamps",
  "ventilateur": "fan",
  "ventilateurs": "fans",
  "climatiseur": "air conditioner",
  "refrigerateur": "refrigerator",
  "réfrigérateur": "refrigerator",
  
  // Accessories
  "accessoire": "accessory",
  "accessoires": "accessories",
  "sac": "bag",
  "sacs": "bags",
  "sacoche": "bag",
  "étiquette": "tag",
  "support": "stand",
  "supports": "stands",
  "protection": "protector",
  "protecteur": "protector",
  "film": "screen protector",
  "verre trempé": "tempered glass",
  "verre trempe": "tempered glass",
  
  // Descriptors
  "nouveau": "new",
  "nouvelle": "new",
  "meilleur": "best",
  "meilleure": "best",
  "pas cher": "cheap",
  "bon marché": "affordable",
  "bon marche": "affordable",
  "qualité": "quality",
  "qualite": "quality",
  "original": "original",
  "originaux": "original",
  "sans fil": "wireless",
  "bluetooth": "bluetooth",
  "usb": "usb",
  "led": "led",
  "solaire": "solar",
};

// Synonym expansion for better coverage
const SYNONYM_MAP: Record<string, string[]> = {
  "earbuds": ["earphones", "wireless earbuds"],
  "headphones": ["headset", "over-ear headphones"],
  "phone": ["smartphone", "mobile phone"],
  "laptop": ["notebook", "portable computer"],
  "charger": ["charging cable", "power adapter"],
  "speaker": ["bluetooth speaker", "portable speaker"],
  "smartwatch": ["smart watch", "fitness watch"],
  "tablet": ["ipad", "android tablet"],
  "mouse": ["wireless mouse", "computer mouse"],
  "keyboard": ["wireless keyboard", "mechanical keyboard"],
};

// ==================== UTILITY FUNCTIONS ====================

// Remove accents from string
function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Normalize query: trim, lowercase, remove accents, collapse spaces
function normalizeQuery(q: string): string {
  return removeAccents(q.trim().toLowerCase()).replace(/\s+/g, " ");
}

// Check if query contains accented characters
function hasAccents(q: string): boolean {
  return /[àâäéèêëïîôùûüÿçœæ]/i.test(q);
}

// Detect if query is likely French
function detectQueryLanguage(q: string): "fr" | "en" | "unknown" {
  const normalized = normalizeQuery(q);
  const words = normalized.split(/\s+/);
  
  // Check for accents in original (strong French signal)
  if (hasAccents(q)) {
    return "fr";
  }
  
  // Check for French stopwords
  const hasFrenchStopword = words.some(word => FRENCH_STOPWORDS.has(word));
  if (hasFrenchStopword) {
    return "fr";
  }
  
  // Check for French commerce keywords
  const hasFrenchKeyword = words.some(word => FRENCH_KEYWORDS.has(word));
  if (hasFrenchKeyword) {
    return "fr";
  }
  
  // Check if normalized words match French dictionary
  const hasFrenchWord = words.some(word => FRENCH_TO_ENGLISH[word] !== undefined);
  if (hasFrenchWord) {
    return "fr";
  }
  
  // Check for English-only indicators
  const hasEnglishIndicator = words.some(word => ENGLISH_INDICATORS.has(word));
  if (hasEnglishIndicator) {
    return "en";
  }
  
  // Check for model numbers (alphanumeric patterns like "s23", "14 pro", etc.)
  const looksLikeModelNumber = /\b(pro|max|plus|ultra|mini|lite|se)\b/i.test(normalized) ||
    /\b\d{1,2}\b/.test(normalized);
  if (looksLikeModelNumber) {
    return "en";
  }
  
  return "unknown";
}

// Translate French query to English using dictionary
function translateFrenchToEnglish(q: string): string | null {
  const normalized = normalizeQuery(q);
  
  // Try exact phrase match first (for multi-word terms like "ordinateur portable")
  if (FRENCH_TO_ENGLISH[normalized]) {
    return FRENCH_TO_ENGLISH[normalized];
  }
  
  // Try word-by-word translation
  const words = normalized.split(/\s+/);
  let hasTranslation = false;
  const translatedWords = words.map(word => {
    const translation = FRENCH_TO_ENGLISH[word];
    if (translation) {
      hasTranslation = true;
      return translation;
    }
    return word;
  });
  
  if (hasTranslation) {
    return translatedWords.join(" ");
  }
  
  return null;
}

// Get synonym variant for an English term
function getSynonymVariant(englishQuery: string): string | null {
  const normalized = normalizeQuery(englishQuery);
  const words = normalized.split(/\s+/);
  
  // Find first word with synonyms
  for (const word of words) {
    const synonyms = SYNONYM_MAP[word];
    if (synonyms && synonyms.length > 0) {
      // Replace word with first synonym
      const newWords = words.map(w => w === word ? synonyms[0] : w);
      return newWords.join(" ");
    }
  }
  
  return null;
}

// Build query variants based on language detection
function buildQueryVariants(originalQuery: string, expand: boolean): string[] {
  const variants: string[] = [];
  const qNorm = normalizeQuery(originalQuery);
  
  // If expansion disabled, return only normalized original
  if (!expand) {
    variants.push(qNorm);
    return variants;
  }
  
  const detectedLang = detectQueryLanguage(originalQuery);
  
  if (detectedLang === "fr" || detectedLang === "unknown") {
    // French-likely or unknown: expand with translations
    
    // v1: Original (normalized, for French users who might find French-titled products)
    variants.push(qNorm);
    
    // v2: English translation
    const englishTranslation = translateFrenchToEnglish(originalQuery);
    if (englishTranslation && !variants.includes(englishTranslation)) {
      variants.push(englishTranslation);
      
      // v3: Synonym of English translation (optional)
      const synonymVariant = getSynonymVariant(englishTranslation);
      if (synonymVariant && !variants.includes(synonymVariant)) {
        variants.push(synonymVariant);
      }
    }
  } else {
    // English-likely: minimal expansion
    
    // v1: Original (normalized)
    variants.push(qNorm);
    
    // v2: Cleaned variant (remove extra punctuation)
    const cleaned = qNorm.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned !== qNorm && cleaned.length > 0 && !variants.includes(cleaned)) {
      variants.push(cleaned);
    }
  }
  
  // Limit to max 3 variants
  return variants.slice(0, 3);
}

// Merge and dedupe results by ASIN, preserving order preference
function mergeAndDedupeResults(variantResults: Array<{ variant: string; items: any[] }>): any[] {
  const seen = new Map<string, any>();
  
  for (const { items } of variantResults) {
    for (const item of items) {
      const asin = item.providerProductId || item.id;
      if (asin && !seen.has(asin)) {
        seen.set(asin, item);
      }
    }
  }
  
  return Array.from(seen.values());
}

// ==================== TYPES ====================

interface CacheRow {
  id: string;
  provider: string;
  query: string;
  page: number;
  page_size: number;
  amazon_domain: string;
  response: {
    items: any[];
    total: number | null;
  };
  updated_at: string;
}

function getCacheAge(updatedAt: string): number {
  return Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000);
}

function isCacheFresh(updatedAt: string): boolean {
  return getCacheAge(updatedAt) <= CACHE_TTL_SECONDS;
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Parse query params
  const url = new URL(req.url);
  const rawQuery = url.searchParams.get("q") || "";
  const qOriginal = rawQuery.trim();
  const qNorm = normalizeQuery(rawQuery);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  const fastMode = url.searchParams.get("fast") === "1";
  const deviceId = getDeviceId(req);
  
  // NEW: expand and lang parameters
  const expand = url.searchParams.get("expand") !== "0"; // default true
  const lang = url.searchParams.get("lang") || "fr"; // default "fr"
  
  // Provider parameter for filtering
  const providerParam = url.searchParams.get("provider") || null;
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);
  const isStaging = envName === "staging";
  
  // Build query variants for smart expansion
  const queryVariants = buildQueryVariants(qOriginal, expand);
  const detectedLang = detectQueryLanguage(qOriginal);

  console.log("[CATALOG_SEARCH]", JSON.stringify({
    q: qOriginal,
    qNorm,
    lang,
    expand,
    detectedLang,
    queryVariants,
    page,
    pageSize,
    env: envName,
    domain: amazonDomain,
    fastMode,
  }));

  // Default empty response for empty query
  if (!qNorm) {
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: "",
      lang,
      expand: expand ? 1 : 0,
      queryVariants: [],
      page,
      pageSize,
      total: 0,
      items: [],
      cached: false,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[CATALOG_SEARCH] Missing Supabase credentials");
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query: qOriginal,
        lang,
        expand: expand ? 1 : 0,
        queryVariants: [],
        page,
        pageSize,
        total: 0,
        items: [],
        cached: false,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Rate limiting
    const rateLimit = await checkRateLimit(supabase, deviceId, "search");
    if (!rateLimit.allowed) {
      console.log(`[CATALOG_SEARCH] Rate limited device=${deviceId} count=${rateLimit.count}`);
      return new Response(JSON.stringify(rateLimitResponse(rateLimit.resetAt)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return empty success
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_SEARCH] Catalog not enabled for env=${envName}`);
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query: qOriginal,
        lang,
        expand: expand ? 1 : 0,
        queryVariants: [],
        page,
        pageSize,
        total: 0,
        items: [],
        providersUsed: [],
        cached: false,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Check active providers
    let activeProviders: string[] = [];
    const { data: providers } = await supabase
      .from("catalog_providers")
      .select("name, adapter_name, requires_keys, enabled")
      .eq("enabled", true)
      .or(`environment.eq.all,environment.eq.${envName}`)
      .order("priority", { ascending: false });
    
    for (const p of (providers || [])) {
      let requiredSecret: string | null = null;
      if (p.requires_keys?.apiKeySecret) {
        requiredSecret = p.requires_keys.apiKeySecret;
      }
      if (!requiredSecret || (Deno.env.get(requiredSecret)?.trim())) {
        activeProviders.push(p.name);
      }
    }
    
    // If specific provider requested, validate it's active
    if (providerParam && providerParam !== "all") {
      if (!activeProviders.includes(providerParam)) {
        return new Response(JSON.stringify({
          status: "error",
          env: envName,
          query: qOriginal,
          lang,
          expand: expand ? 1 : 0,
          queryVariants: [],
          page,
          pageSize,
          total: 0,
          items: [],
          providersUsed: [],
          cached: false,
          error: { code: "PROVIDER_INACTIVE", message: `Provider '${providerParam}' not available` },
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      activeProviders = [providerParam];
    }
    
    const providersUsed = activeProviders.filter(p => p === "amazon" || p === "rainforest").slice(0, 2);

    // ========== UNIFIED CACHE LOOKUP ==========
    // Cache key uses normalized query for consistency
    const cacheKey = buildCacheKey("search", {
      env: envName,
      domain: amazonDomain,
      query: qNorm,
      expand,
      page,
      pageSize,
    });
    
    const unifiedCache = await getCache(supabase, cacheKey);
    
    if (unifiedCache.hit && unifiedCache.data?.items?.length > 0) {
      console.log(`[CATALOG_SEARCH] Unified cache hit: key=${cacheKey} stale=${unifiedCache.stale} age=${unifiedCache.cacheAgeSec}s`);
      
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query: qOriginal,
        lang,
        expand: expand ? 1 : 0,
        queryVariants: unifiedCache.data.queryVariants || queryVariants,
        page,
        pageSize,
        total: unifiedCache.data.total,
        items: unifiedCache.data.items,
        providersUsed,
        cached: true,
        stale: unifiedCache.stale,
        cacheAgeSec: unifiedCache.cacheAgeSec,
        usedVariantCount: unifiedCache.data.usedVariantCount || 1,
        ...(isStaging && { cacheKey }),
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== LEGACY CACHE LOOKUP (catalog_search_cache) ==========
    const { data: cacheRow } = await supabase
      .from("catalog_search_cache")
      .select("*")
      .eq("provider", "rainforest")
      .eq("query", qNorm)
      .eq("page", page)
      .eq("page_size", pageSize)
      .eq("amazon_domain", amazonDomain)
      .maybeSingle();

    const typedCache = cacheRow as CacheRow | null;

    // If cache exists
    if (typedCache && typedCache.response?.items?.length > 0) {
      const cacheAgeSec = getCacheAge(typedCache.updated_at);
      const isFresh = isCacheFresh(typedCache.updated_at);
      
      // Fast mode: return stale immediately
      if (fastMode || isFresh) {
        console.log("[CATALOG_SEARCH]", JSON.stringify({
          q: qOriginal,
          qNorm,
          page,
          env: envName,
          status: "success",
          source: isFresh ? "cache-fresh" : "cache-stale",
          cacheAgeSec,
          itemCount: typedCache.response.items.length,
          durationMs: Date.now() - startTime,
        }));

        return new Response(JSON.stringify({
          status: "success",
          env: envName,
          query: qOriginal,
          lang,
          expand: expand ? 1 : 0,
          queryVariants,
          page,
          pageSize,
          total: typedCache.response.total,
          items: typedCache.response.items,
          cached: true,
          stale: !isFresh,
          cacheAgeSec,
          error: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Stale cache, not fast mode: fetch fresh data
      console.log("[CATALOG_SEARCH] Cache stale, refreshing...");
    }

    // ========== FETCH FROM RAINFOREST WITH VARIANT SUPPORT ==========
    // Search multiple variants in parallel and merge results
    const variantResults: Array<{ variant: string; items: any[]; total: number | null }> = [];
    let combinedError: string | null = null;
    
    // Limit variants to search (max 3 for performance)
    const variantsToSearch = queryVariants.slice(0, 3);
    
    console.log("[CATALOG_SEARCH] Searching variants:", variantsToSearch);
    
    // Search all variants in parallel
    const searchPromises = variantsToSearch.map(async (variant) => {
      try {
        const { products, total, error: rainforestError } = await searchRainforest(
          variant,
          page,
          pageSize,
          amazonDomain
        );
        
        if (rainforestError) {
          console.warn(`[CATALOG_SEARCH] Variant "${variant}" error:`, rainforestError);
          return { variant, items: [], total: null, error: rainforestError };
        }
        
        const items = products.map(formatCatalogItem);
        return { variant, items, total, error: null };
      } catch (err) {
        console.warn(`[CATALOG_SEARCH] Variant "${variant}" exception:`, err);
        return { variant, items: [], total: null, error: String(err) };
      }
    });
    
    const searchResults = await Promise.all(searchPromises);
    
    // Collect successful results
    for (const result of searchResults) {
      if (result.items.length > 0) {
        variantResults.push({ variant: result.variant, items: result.items, total: result.total });
      } else if (result.error && !combinedError) {
        combinedError = result.error;
      }
    }
    
    // Merge and dedupe results
    const mergedItems = mergeAndDedupeResults(variantResults);
    const usedVariantCount = variantResults.length;
    const totalEstimate = variantResults.length > 0 ? variantResults[0].total : null;

    // Cache results
    const cachePayload = { 
      items: mergedItems, 
      total: totalEstimate, 
      usedVariantCount,
      queryVariants: variantsToSearch,
    };
    
    await setCache(supabase, "search", cacheKey, cachePayload, {
      provider: "rainforest",
      query: qNorm,
      page,
      pageSize,
      amazonDomain,
    });

    // Also update legacy cache for backwards compatibility
    if (mergedItems.length > 0) {
      const legacyCacheData = {
        provider: "rainforest",
        query: qNorm,
        page,
        page_size: pageSize,
        amazon_domain: amazonDomain,
        response: { items: mergedItems, total: totalEstimate },
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("catalog_search_cache")
        .upsert(legacyCacheData, {
          onConflict: "provider,query,page,page_size,amazon_domain",
        });

      if (upsertError) {
        console.warn("[CATALOG_SEARCH] Legacy cache upsert failed:", upsertError.message);
      }
    }

    console.log("[CATALOG_SEARCH]", JSON.stringify({
      q: qOriginal,
      qNorm,
      queryVariants: variantsToSearch,
      usedVariantCount,
      page,
      env: envName,
      status: mergedItems.length > 0 ? "success" : "empty",
      source: queryVariants.length > 1 ? "rainforest-multi-variant" : "rainforest-live",
      itemCount: mergedItems.length,
      durationMs: Date.now() - startTime,
    }));

    // If we got results, return success
    if (mergedItems.length > 0) {
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query: qOriginal,
        lang,
        expand: expand ? 1 : 0,
        queryVariants: variantsToSearch,
        page,
        pageSize,
        total: totalEstimate,
        items: mergedItems,
        cached: false,
        usedVariantCount,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== FALLBACK: STALE CACHE OR CATALOG_PRODUCTS ==========
    
    // Try stale cache first
    if (typedCache && typedCache.response?.items?.length > 0) {
      const cacheAgeSec = getCacheAge(typedCache.updated_at);
      console.log("[CATALOG_SEARCH]", JSON.stringify({
        q: qOriginal,
        qNorm,
        page,
        env: envName,
        status: "success",
        source: "cache-stale-fallback",
        cacheAgeSec,
        itemCount: typedCache.response.items.length,
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query: qOriginal,
        lang,
        expand: expand ? 1 : 0,
        queryVariants,
        page,
        pageSize,
        total: typedCache.response.total,
        items: typedCache.response.items,
        cached: true,
        stale: true,
        cacheAgeSec,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback to catalog_products table
    const { data: cachedProducts } = await supabase
      .from("catalog_products")
      .select("*")
      .gt("expires_at", new Date().toISOString())
      .ilike("title", `%${qNorm}%`)
      .order("rating", { ascending: false })
      .limit(pageSize);

    if (cachedProducts && cachedProducts.length > 0) {
      const cachedItems = cachedProducts.map((p: any) => ({
        id: `rainforest:${p.provider_product_id}`,
        provider: "rainforest",
        providerProductId: p.provider_product_id,
        title: p.title || "",
        priceUsd: (p.price_usd && p.price_usd > 0) ? p.price_usd : null,
        imageUrl: p.image_url || null,
        images: p.raw?.images?.map((img: any) => img.link || img) || [],
        productUrl: p.product_url || null,
        inStock: p.in_stock ?? null,
        rating: p.rating || null,
      }));

      console.log("[CATALOG_SEARCH]", JSON.stringify({
        q: qOriginal,
        qNorm,
        page,
        env: envName,
        status: "success",
        source: "catalog-products-fallback",
        itemCount: cachedItems.length,
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query: qOriginal,
        lang,
        expand: expand ? 1 : 0,
        queryVariants,
        page,
        pageSize,
        total: cachedItems.length,
        items: cachedItems,
        cached: true,
        stale: true,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No cache available, return error status but still 200
    console.log("[CATALOG_SEARCH]", JSON.stringify({
      q: qOriginal,
      qNorm,
      page,
      env: envName,
      status: "error",
      error: combinedError || "No results",
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      query: qOriginal,
      lang,
      expand: expand ? 1 : 0,
      queryVariants,
      page,
      pageSize,
      total: null,
      items: [],
      cached: false,
      usedVariantCount: 0,
      error: { code: "RAINFOREST_ERROR", message: "Search unavailable" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_SEARCH]", JSON.stringify({
      q: qOriginal,
      qNorm,
      page,
      env: envName,
      status: "error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
    }));
    
    // Even on error, return 200 with stable shape
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      query: qOriginal,
      lang,
      expand: expand ? 1 : 0,
      queryVariants: [],
      page,
      pageSize,
      total: null,
      items: [],
      cached: false,
      error: { code: "INTERNAL_ERROR", message: "Search service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
