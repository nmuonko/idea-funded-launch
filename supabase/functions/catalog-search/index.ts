/**
 * Catalog Search Endpoint - Smart 3-Layer Caching
 * 
 * GET /catalog-search?q=iphone&page=1&pageSize=20
 * 
 * 3-Layer "Avoid Rainforest" Pipeline:
 * 1. Exact cache lookup (fastest)
 * 2. Family cache reuse (smart - "iphone 13" reuses "iphone" cache)
 * 3. DB-first search (catalog_items trigram)
 * 4. Live Rainforest (only as last resort)
 * 
 * French Query Expansion (expand=1):
 * - Detects French vs English queries
 * - Translates French to English for better Amazon results
 * - Max 3 query variants
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { searchRainforest, formatCatalogItem } from "../_shared/rainforestAdapter.ts";
import { getDeviceId } from "../_shared/catalogCache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=60",
};

// Minimum results before trying next layer
const MIN_RESULTS_FOR_CACHE_REUSE = 8;
const MIN_RESULTS_FOR_DB = 5;
const FAMILY_CACHE_SIZE = 50;

// Stopwords to remove when extracting family tokens
const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "is", "it", "as",
  // French  
  "le", "la", "les", "un", "une", "des", "et", "ou", "de", "du", "au", "aux", "en", "dans", "sur", "pour", "avec", "par",
  // Common modifiers
  "new", "nouveau", "nouvelle", "best", "meilleur", "top", "pro", "max", "plus", "ultra", "mini", "lite",
]);

// ==================== LANGUAGE DETECTION ====================

const FRENCH_KEYWORDS = new Set([
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
  "manette", "manettes", "console", "consoles",
  "jeux", "jeu", "vidéo", "video",
  "télévision", "television", "télé", "tele", "téléviseur", "televiseur",
  "lampe", "lampes", "ventilateur", "ventilateurs",
  "climatiseur", "réfrigérateur", "refrigerateur",
  "coque", "coques", "étui", "etui",
  "accessoire", "accessoires", "sac", "sacs", "sacoche",
  "protection", "protecteur", "verre", "trempé", "trempe",
  "sans", "fil", "bluetooth", "solaire",
  "nouveau", "nouvelle", "meilleur", "meilleure",
  "pas", "cher", "bon", "marché", "marche",
  "qualité", "qualite", "original", "originaux",
]);

const FRENCH_TO_ENGLISH: Record<string, string> = {
  "téléphone": "phone", "telephone": "phone", "téléphones": "phones", "telephones": "phones",
  "portable": "mobile phone", "portables": "mobile phones",
  "coque": "phone case", "coques": "phone cases", "étui": "case", "etui": "case",
  "chargeur": "charger", "chargeurs": "chargers",
  "câble": "cable", "cable": "cable", "câbles": "cables", "cables": "cables",
  "écouteurs": "earbuds", "ecouteurs": "earbuds",
  "casque": "headphones", "casques": "headphones",
  "enceinte": "speaker", "enceintes": "speakers", "haut-parleur": "speaker",
  "ordinateur": "computer", "ordinateurs": "computers",
  "ordinateur portable": "laptop", "pc portable": "laptop",
  "clavier": "keyboard", "claviers": "keyboards",
  "souris": "mouse",
  "écran": "monitor", "ecran": "monitor", "écrans": "monitors", "ecrans": "monitors",
  "moniteur": "monitor", "moniteurs": "monitors",
  "imprimante": "printer", "imprimantes": "printers",
  "batterie": "battery", "batteries": "batteries",
  "batterie externe": "power bank", "powerbank": "power bank",
  "manette": "controller", "manettes": "controllers",
  "console": "console", "consoles": "consoles",
  "jeux": "games", "jeu": "game", "jeux vidéo": "video games", "jeux video": "video games",
  "télévision": "television", "television": "television",
  "télé": "tv", "tele": "tv", "tv": "tv",
  "montre": "watch", "montres": "watches",
  "montre connectée": "smartwatch", "montre connectee": "smartwatch",
  "tablette": "tablet", "tablettes": "tablets",
  "accessoire": "accessory", "accessoires": "accessories",
  "sans fil": "wireless", "bluetooth": "bluetooth",
};

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

// ==================== QUERY NORMALIZATION ====================

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeQuery(q: string): string {
  return removeAccents(q.trim().toLowerCase()).replace(/\s+/g, " ");
}

function hasAccents(q: string): boolean {
  return /[àâäéèêëïîôùûüÿçœæ]/i.test(q);
}

function tokenize(q: string): string[] {
  return q.split(/\s+/).filter(t => t.length > 0);
}

function extractFamilyTokens(tokens: string[]): string[] {
  // Remove stopwords and numbers
  return tokens.filter(t => !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function extractNumbers(tokens: string[]): string[] {
  // Extract numbers (like "13", "14", "17")
  return tokens.filter(t => /^\d+$/.test(t));
}

function buildFamilyQuery(tokens: string[]): string {
  const familyTokens = extractFamilyTokens(tokens);
  return familyTokens.join(" ");
}

// ==================== LANGUAGE HELPERS ====================

function detectQueryLanguage(q: string): "fr" | "en" | "unknown" {
  const normalized = normalizeQuery(q);
  const words = normalized.split(/\s+/);
  
  if (hasAccents(q)) return "fr";
  if (words.some(word => FRENCH_KEYWORDS.has(word))) return "fr";
  if (words.some(word => FRENCH_TO_ENGLISH[word] !== undefined)) return "fr";
  
  return "unknown";
}

function translateFrenchToEnglish(q: string): string | null {
  const normalized = normalizeQuery(q);
  if (FRENCH_TO_ENGLISH[normalized]) return FRENCH_TO_ENGLISH[normalized];
  
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
  
  return hasTranslation ? translatedWords.join(" ") : null;
}

function getSynonymVariant(englishQuery: string): string | null {
  const normalized = normalizeQuery(englishQuery);
  const words = normalized.split(/\s+/);
  
  for (const word of words) {
    const synonyms = SYNONYM_MAP[word];
    if (synonyms && synonyms.length > 0) {
      const newWords = words.map(w => w === word ? synonyms[0] : w);
      return newWords.join(" ");
    }
  }
  return null;
}

function buildQueryVariants(originalQuery: string, expand: boolean): string[] {
  const variants: string[] = [];
  const qNorm = normalizeQuery(originalQuery);
  
  if (!expand) {
    variants.push(qNorm);
    return variants;
  }
  
  const detectedLang = detectQueryLanguage(originalQuery);
  
  if (detectedLang === "fr" || detectedLang === "unknown") {
    variants.push(qNorm);
    const englishTranslation = translateFrenchToEnglish(originalQuery);
    if (englishTranslation && !variants.includes(englishTranslation)) {
      variants.push(englishTranslation);
      const synonymVariant = getSynonymVariant(englishTranslation);
      if (synonymVariant && !variants.includes(synonymVariant)) {
        variants.push(synonymVariant);
      }
    }
  } else {
    variants.push(qNorm);
    const cleaned = qNorm.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned !== qNorm && cleaned.length > 0 && !variants.includes(cleaned)) {
      variants.push(cleaned);
    }
  }
  
  return variants.slice(0, 3);
}

// ==================== TYPES ====================

interface CatalogItem {
  id: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  reviewCount?: number | null;
  brand?: string | null;
  category?: string | null;
}

interface CacheSettings {
  search_stale_minutes: number;
  search_expires_minutes: number;
  negative_expires_seconds: number;
}

function mapDbItemToResponse(item: any): CatalogItem {
  return {
    id: item.id,
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: item.image_url,
    images: item.images || [],
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    reviewCount: item.review_count,
    brand: item.brand,
    category: item.category,
  };
}

// ==================== CACHE HELPERS ====================

function buildExactCacheKey(qNorm: string, page: number, pageSize: number, expand: boolean, domain: string): string {
  return `search:v3:q=${qNorm}:page=${page}:size=${pageSize}:expand=${expand ? 1 : 0}:domain=${domain}`;
}

function buildFamilyCacheKey(familyQuery: string, domain: string): string {
  return `search_family:v3:q=${familyQuery}:page=1:size=${FAMILY_CACHE_SIZE}:domain=${domain}`;
}

async function getCacheSettings(supabase: any): Promise<CacheSettings> {
  const { data } = await supabase
    .from("catalog_cache_settings")
    .select("search_stale_minutes, search_expires_minutes, negative_expires_seconds")
    .eq("key", "default")
    .single();
  
  return data || {
    search_stale_minutes: 240,
    search_expires_minutes: 2880,
    negative_expires_seconds: 120,
  };
}

async function getFromCache(supabase: any, cacheKey: string): Promise<{ items: CatalogItem[] | null; stale: boolean; cacheAgeSeconds: number }> {
  const { data } = await supabase
    .from("catalog_cache")
    .select("response, stale_at, updated_at")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .single();
  
  if (!data) {
    return { items: null, stale: false, cacheAgeSeconds: 0 };
  }
  
  const now = new Date();
  const staleAt = new Date(data.stale_at);
  const updatedAt = new Date(data.updated_at);
  const cacheAgeSeconds = Math.floor((now.getTime() - updatedAt.getTime()) / 1000);
  
  return {
    items: data.response?.items || null,
    stale: now > staleAt,
    cacheAgeSeconds,
  };
}

async function saveToCache(
  supabase: any,
  cacheKey: string,
  items: CatalogItem[],
  settings: CacheSettings,
  isNegative: boolean = false
): Promise<void> {
  const now = new Date();
  const staleMinutes = isNegative ? 1 : settings.search_stale_minutes;
  const expiresMinutes = isNegative ? Math.ceil(settings.negative_expires_seconds / 60) : settings.search_expires_minutes;
  
  const staleAt = new Date(now.getTime() + staleMinutes * 60 * 1000);
  const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000);
  
  await supabase
    .from("catalog_cache")
    .upsert({
      cache_key: cacheKey,
      cache_type: "search",
      response: { items },
      stale_at: staleAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: "cache_key" });
}

// ==================== FAMILY CACHE FILTERING ====================

function filterItemsByTokens(items: CatalogItem[], originalTokens: string[], numbers: string[]): CatalogItem[] {
  // Filter cached items to match original query tokens
  const nonStopTokens = originalTokens.filter(t => !STOPWORDS.has(t));
  
  return items.filter(item => {
    const titleLower = (item.title || "").toLowerCase();
    
    // All non-stopword tokens must appear in title
    const tokensMatch = nonStopTokens.every(token => titleLower.includes(token));
    
    // If original query has numbers, at least one must appear
    const numbersMatch = numbers.length === 0 || numbers.some(num => titleLower.includes(num));
    
    return tokensMatch && numbersMatch;
  });
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const rawQuery = url.searchParams.get("q") || "";
  const qOriginal = rawQuery.trim();
  const qNorm = normalizeQuery(rawQuery);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  const expand = url.searchParams.get("expand") !== "0";
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);
  const deviceId = getDeviceId(req);

  // Tokenize for family matching
  const tokens = tokenize(qNorm);
  const familyTokens = extractFamilyTokens(tokens);
  const familyQuery = familyTokens.join(" ");
  const queryNumbers = extractNumbers(tokens);
  const queryVariants = buildQueryVariants(qOriginal, expand);

  console.log("[CATALOG_SEARCH]", { 
    q: qOriginal, 
    qNorm, 
    familyQuery, 
    queryNumbers, 
    queryVariants, 
    page, 
    env: envName 
  });

  if (!qNorm) {
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: "",
      lang,
      expand: expand ? 1 : 0,
      queryVariants: [],
      familyQuery: null,
      page,
      pageSize,
      total: 0,
      items: [],
      source: "empty",
      cached: false,
      stale: false,
      cacheAgeSec: 0,
      reusedFrom: null,
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
      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        query: qOriginal,
        items: [],
        error: { code: "CONFIG_ERROR", message: "Backend unavailable" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) {
      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        query: qOriginal,
        items: [],
        error: { code: "CATALOG_DISABLED", message: "Catalog not enabled" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load cache settings
    const cacheSettings = await getCacheSettings(supabase);
    
    let resultItems: CatalogItem[] = [];
    let reusedFrom: string | null = null;
    let cached = false;
    let stale = false;
    let cacheAgeSec = 0;
    let usedLiveFallback = false;

    // ==================== STEP 1: EXACT CACHE ====================
    const exactCacheKey = buildExactCacheKey(qNorm, page, pageSize, expand, amazonDomain);
    const exactCache = await getFromCache(supabase, exactCacheKey);
    
    if (exactCache.items && exactCache.items.length > 0) {
      console.log(`[CATALOG_SEARCH] Step 1: Exact cache hit (${exactCache.items.length} items, stale=${exactCache.stale})`);
      resultItems = exactCache.items;
      reusedFrom = "exact_cache";
      cached = true;
      stale = exactCache.stale;
      cacheAgeSec = exactCache.cacheAgeSeconds;
    }

    // ==================== STEP 2: FAMILY CACHE REUSE ====================
    if (resultItems.length === 0 && familyQuery.length >= 2 && familyQuery !== qNorm) {
      const familyCacheKey = buildFamilyCacheKey(familyQuery, amazonDomain);
      const familyCache = await getFromCache(supabase, familyCacheKey);
      
      if (familyCache.items && familyCache.items.length > 0) {
        // Filter family cache to match original tokens
        const filtered = filterItemsByTokens(familyCache.items, tokens, queryNumbers);
        console.log(`[CATALOG_SEARCH] Step 2: Family cache has ${familyCache.items.length} items, filtered to ${filtered.length}`);
        
        if (filtered.length >= MIN_RESULTS_FOR_CACHE_REUSE) {
          resultItems = filtered.slice(0, pageSize);
          reusedFrom = "family_cache";
          cached = true;
          stale = familyCache.stale;
          cacheAgeSec = familyCache.cacheAgeSeconds;
        }
      }
    }

    // ==================== STEP 3: DB SEARCH ====================
    if (resultItems.length < MIN_RESULTS_FOR_DB) {
      console.log(`[CATALOG_SEARCH] Step 3: DB search (current=${resultItems.length})`);
      
      // Search using trigram on search_text
      const searchTerms = queryVariants.map(v => `%${v}%`);
      const { data: dbItems } = await supabase
        .from("catalog_items")
        .select("*")
        .or(searchTerms.map(t => `search_text.ilike.${t}`).join(","))
        .order("rating", { ascending: false, nullsFirst: false })
        .limit(pageSize);

      if (dbItems && dbItems.length > 0) {
        const mapped = dbItems.map(mapDbItemToResponse);
        
        // Merge with any existing results
        if (resultItems.length > 0) {
          const existingIds = new Set(resultItems.map(i => i.id));
          const newItems = mapped.filter(i => !existingIds.has(i.id));
          resultItems = [...resultItems, ...newItems].slice(0, pageSize);
        } else {
          resultItems = mapped;
          reusedFrom = "db";
        }
        
        console.log(`[CATALOG_SEARCH] Step 3: DB found ${dbItems.length} items, total now ${resultItems.length}`);
      }
      
      // Also try title/category search if needed
      if (resultItems.length < MIN_RESULTS_FOR_DB) {
        const { data: titleItems } = await supabase
          .from("catalog_items")
          .select("*")
          .or(`title.ilike.%${qNorm}%,category.ilike.%${qNorm}%`)
          .order("rating", { ascending: false, nullsFirst: false })
          .limit(pageSize - resultItems.length);
        
        if (titleItems && titleItems.length > 0) {
          const existingIds = new Set(resultItems.map(i => i.id));
          const newItems = titleItems.filter(i => !existingIds.has(i.id)).map(mapDbItemToResponse);
          resultItems = [...resultItems, ...newItems];
        }
      }
    }

    // ==================== STEP 4: LIVE RAINFOREST (last resort) ====================
    if (resultItems.length < MIN_RESULTS_FOR_DB) {
      console.log(`[CATALOG_SEARCH] Step 4: Live Rainforest fallback (current=${resultItems.length})`);
      usedLiveFallback = true;

      // Only search first 2 variants to limit API calls
      const variantsToSearch = queryVariants.slice(0, 2);
      const liveItems: CatalogItem[] = [];

      for (const variant of variantsToSearch) {
        try {
          const { products, error: rainforestError } = await searchRainforest(
            variant,
            1, // Only page 1
            Math.min(20, pageSize),
            amazonDomain
          );

          if (!rainforestError && products.length > 0) {
            const formatted = products.map(formatCatalogItem);
            liveItems.push(...formatted);

            // Cache to catalog_items
            const toUpsert = formatted.map(item => ({
              id: item.id,
              provider: "rainforest",
              provider_product_id: item.providerProductId,
              title: item.title,
              price_usd: item.priceUsd,
              image_url: item.imageUrl,
              images: item.images,
              product_url: item.productUrl,
              in_stock: item.inStock,
              rating: item.rating,
              category: "uncategorized",
              tags: [qNorm, ...familyTokens],
              updated_at: new Date().toISOString(),
            }));

            await supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
          }
        } catch (err) {
          console.warn(`[CATALOG_SEARCH] Live search error for "${variant}":`, err);
        }
      }

      // Merge with existing results
      const existingIds = new Set(resultItems.map(i => i.id));
      const newLiveItems = liveItems.filter(i => !existingIds.has(i.id));
      resultItems = [...resultItems, ...newLiveItems].slice(0, pageSize);
      
      if (!reusedFrom) {
        reusedFrom = "rainforest";
      }

      // Store exact cache (for future exact queries)
      if (resultItems.length > 0) {
        await saveToCache(supabase, exactCacheKey, resultItems, cacheSettings, false);
      } else {
        // Negative cache (short TTL)
        await saveToCache(supabase, exactCacheKey, [], cacheSettings, true);
      }

      // Store/update family cache with larger result set
      if (liveItems.length > 0 && familyQuery.length >= 2) {
        const familyCacheKey = buildFamilyCacheKey(familyQuery, amazonDomain);
        const existingFamily = await getFromCache(supabase, familyCacheKey);
        
        let familyItems = liveItems;
        if (existingFamily.items && existingFamily.items.length > 0) {
          // Merge with existing family cache
          const existingIds = new Set(existingFamily.items.map(i => i.id));
          const newItems = liveItems.filter(i => !existingIds.has(i.id));
          familyItems = [...existingFamily.items, ...newItems].slice(0, FAMILY_CACHE_SIZE);
        }
        
        await saveToCache(supabase, familyCacheKey, familyItems, cacheSettings, false);
      }
    }

    // ==================== CACHE EXACT RESULT (if from cache/db layers) ====================
    if (!usedLiveFallback && resultItems.length > 0 && !cached) {
      // Cache DB results for exact query
      await saveToCache(supabase, exactCacheKey, resultItems, cacheSettings, false);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[CATALOG_SEARCH] Done: ${resultItems.length} items, reusedFrom=${reusedFrom}, cached=${cached}, stale=${stale}, durationMs=${durationMs}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: qOriginal,
      lang,
      expand: expand ? 1 : 0,
      queryVariants,
      familyQuery: familyQuery.length >= 2 ? familyQuery : null,
      page,
      pageSize,
      total: resultItems.length,
      items: resultItems,
      source: usedLiveFallback ? "db+rainforest" : (reusedFrom || "db"),
      cached,
      stale,
      cacheAgeSec,
      reusedFrom,
      durationMs,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_SEARCH] Error:", errorMessage);
    
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      query: qOriginal,
      lang,
      expand: expand ? 1 : 0,
      queryVariants: [],
      familyQuery: null,
      page,
      pageSize,
      total: null,
      items: [],
      cached: false,
      stale: false,
      cacheAgeSec: 0,
      reusedFrom: null,
      error: { code: "INTERNAL_ERROR", message: "Search service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
