/**
 * Catalog Search Endpoint with Caching + French Query Translation
 * Search products via Rainforest API with server-side cache
 * GET /catalog-search?env=staging&q=iphone&page=1&pageSize=20&amazon_domain=amazon.com&fast=1
 * 
 * Cache behavior:
 * - Fresh cache (<=30 min): return immediately
 * - Stale cache (>30 min): refresh then return (unless fast=1)
 * - fast=1: return stale cache immediately if available
 * 
 * French support:
 * - Detects French queries via stopwords/accents
 * - Translates common ecommerce terms to English
 * - Searches up to 3 query variants and merges/dedupes results
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { searchRainforest, formatCatalogItem } from "../_shared/rainforestAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=60",
};

// Cache TTL in seconds (30 minutes)
const CACHE_TTL_SECONDS = 30 * 60;

// French stopwords for language detection
const FRENCH_STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "pour",
  "avec", "dans", "sur", "par", "en", "au", "aux", "ce", "cette", "ces",
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre",
  "votre", "leur", "qui", "que", "quoi", "dont", "où", "je", "tu", "il",
  "elle", "nous", "vous", "ils", "elles", "est", "sont", "a", "ont", "être",
  "avoir", "faire", "aller", "voir", "venir", "prendre", "très", "plus",
  "moins", "bien", "bon", "bonne", "meilleur", "nouveau", "nouvelle", "petit",
  "grand", "sans", "tout", "tous", "toute", "toutes", "autre", "autres"
]);

// French to English ecommerce translation dictionary
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
  "étui": "phone case",
  "etui": "phone case",
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
  
  // General
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

// Remove accents from string
function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Normalize query: trim, lowercase, remove accents, collapse spaces
function normalizeQuery(q: string): string {
  return removeAccents(q.trim().toLowerCase()).replace(/\s+/g, " ");
}

// Detect if query is likely French
function isFrenchQuery(q: string): boolean {
  const normalized = normalizeQuery(q);
  const words = normalized.split(/\s+/);
  
  // Check for French stopwords
  const hasFrenchStopword = words.some(word => FRENCH_STOPWORDS.has(word));
  if (hasFrenchStopword) return true;
  
  // Check for accented characters in original
  const hasAccents = /[àâäéèêëïîôùûüÿçœæ]/i.test(q);
  if (hasAccents) return true;
  
  // Check if any word matches French dictionary
  const normalizedWords = normalized.split(/\s+/);
  const hasFrenchWord = normalizedWords.some(word => 
    FRENCH_TO_ENGLISH[word] !== undefined
  );
  if (hasFrenchWord) return true;
  
  return false;
}

// Translate French query to English using dictionary
function translateFrenchToEnglish(q: string): string | null {
  const normalized = normalizeQuery(q);
  
  // Try exact phrase match first (for multi-word terms)
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

// Build query variants for French queries
function buildQueryVariants(originalQuery: string): string[] {
  const variants: string[] = [];
  const normalized = normalizeQuery(originalQuery);
  
  // Always include the normalized original
  variants.push(normalized);
  
  // If not French, just return the original
  if (!isFrenchQuery(originalQuery)) {
    return variants;
  }
  
  // Try full phrase translation
  const phraseTranslation = translateFrenchToEnglish(originalQuery);
  if (phraseTranslation && !variants.includes(phraseTranslation)) {
    variants.push(phraseTranslation);
  }
  
  // Also try without accents as a variant
  const noAccents = removeAccents(originalQuery.trim().toLowerCase());
  if (noAccents !== normalized && !variants.includes(noAccents)) {
    // Check if this version translates differently
    const noAccentTranslation = translateFrenchToEnglish(noAccents);
    if (noAccentTranslation && !variants.includes(noAccentTranslation)) {
      variants.push(noAccentTranslation);
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

interface CatalogSearchResponse {
  status: "success" | "error";
  env: string;
  query: string;
  queryVariants?: string[];
  page: number;
  pageSize: number;
  total: number | null;
  items: any[];
  cached: boolean;
  stale?: boolean;
  cacheAgeSec?: number;
  usedVariantCount?: number;
  error: { code: string; message: string } | null;
}

function getCacheAge(updatedAt: string): number {
  return Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000);
}

function isCacheFresh(updatedAt: string): boolean {
  return getCacheAge(updatedAt) <= CACHE_TTL_SECONDS;
}

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
  const query = normalizeQuery(rawQuery);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  const fastMode = url.searchParams.get("fast") === "1";
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);
  
  // Build query variants for French support
  const queryVariants = buildQueryVariants(qOriginal);
  const isFrench = queryVariants.length > 1;

  console.log("[CATALOG_SEARCH]", JSON.stringify({
    q: query,
    qOriginal,
    queryVariants,
    isFrench,
    page,
    pageSize,
    env: envName,
    domain: amazonDomain,
    fastMode,
  }));

  // Default empty response for empty query
  if (!query) {
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: "",
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
        query,
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
    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return empty success
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_SEARCH] Catalog not enabled for env=${envName}`);
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query,
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

    // ========== CACHE LOOKUP ==========
    const { data: cacheRow } = await supabase
      .from("catalog_search_cache")
      .select("*")
      .eq("provider", "rainforest")
      .eq("query", query)
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
          q: query,
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
          query,
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
    // For French queries, search multiple variants in parallel and merge results
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

    // If we got results, update cache and return
    if (mergedItems.length > 0) {
      // Cache the merged results under the original query
      const cacheData = {
        provider: "rainforest",
        query,
        page,
        page_size: pageSize,
        amazon_domain: amazonDomain,
        response: { items: mergedItems, total: totalEstimate },
        updated_at: new Date().toISOString(),
      };

      // Upsert cache (use ON CONFLICT)
      const { error: upsertError } = await supabase
        .from("catalog_search_cache")
        .upsert(cacheData, {
          onConflict: "provider,query,page,page_size,amazon_domain",
        });

      if (upsertError) {
        console.warn("[CATALOG_SEARCH] Cache upsert failed:", upsertError.message);
      } else {
        console.log("[CATALOG_SEARCH] Cache updated for:", query);
      }

      console.log("[CATALOG_SEARCH]", JSON.stringify({
        q: query,
        qOriginal,
        queryVariants: variantsToSearch,
        usedVariantCount,
        page,
        env: envName,
        status: "success",
        source: isFrench ? "rainforest-multi-variant" : "rainforest-live",
        itemCount: mergedItems.length,
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query: qOriginal,
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
        q: query,
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
        query,
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
      .ilike("title", `%${query}%`)
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
        q: query,
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
        query,
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
      q: query,
      qOriginal,
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
      q: query,
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
      query,
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
