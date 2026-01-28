/**
 * Catalog Search Endpoint - DB-First with Optional Live Fallback
 * 
 * GET /catalog-search?q=iphone&source=db&page=1&pageSize=20
 * 
 * DB-First Strategy:
 * - Default: Search catalog_items table (instant, free)
 * - Live fallback: Only if source=live OR db results < 5
 * - Live results cached immediately to catalog_items
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

// Minimum DB results before triggering live fallback
const MIN_DB_RESULTS = 5;

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

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeQuery(q: string): string {
  return removeAccents(q.trim().toLowerCase()).replace(/\s+/g, " ");
}

function hasAccents(q: string): boolean {
  return /[àâäéèêëïîôùûüÿçœæ]/i.test(q);
}

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
  const source = url.searchParams.get("source") || "db"; // db | live | auto
  const envName = getEnvironmentFromRequest(req);
  const deviceId = getDeviceId(req);

  const queryVariants = buildQueryVariants(qOriginal, expand);

  console.log("[CATALOG_SEARCH]", { q: qOriginal, qNorm, source, queryVariants, page, env: envName });

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
      source: "empty",
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

    let dbItems: CatalogItem[] = [];
    let usedLiveFallback = false;

    // ========== DB SEARCH ==========
    if (source === "db" || source === "auto") {
      // Search all query variants against DB
      const searchTerms = queryVariants.map(v => `%${v}%`);
      
      // Build OR conditions for title search
      const { data: items, count } = await supabase
        .from("catalog_items")
        .select("*", { count: "exact" })
        .or(searchTerms.map(t => `title.ilike.${t}`).join(","))
        .order("rating", { ascending: false, nullsFirst: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (items && items.length > 0) {
        dbItems = items.map(mapDbItemToResponse);
      }

      // Also search by tags and category
      if (dbItems.length < pageSize) {
        const { data: tagItems } = await supabase
          .from("catalog_items")
          .select("*")
          .or(`category.ilike.%${qNorm}%,tags.cs.{${qNorm}}`)
          .order("rating", { ascending: false, nullsFirst: false })
          .limit(pageSize - dbItems.length);

        if (tagItems && tagItems.length > 0) {
          const existingIds = new Set(dbItems.map(i => i.id));
          const newItems = tagItems
            .filter(i => !existingIds.has(i.id))
            .map(mapDbItemToResponse);
          dbItems = [...dbItems, ...newItems];
        }
      }

      console.log(`[CATALOG_SEARCH] DB search found ${dbItems.length} items`);
    }

    // ========== LIVE FALLBACK (if needed) ==========
    if ((source === "live") || (source === "auto" && dbItems.length < MIN_DB_RESULTS)) {
      console.log(`[CATALOG_SEARCH] Using live fallback (source=${source}, dbItems=${dbItems.length})`);
      usedLiveFallback = true;

      // Only search first 2 variants to limit API calls
      const variantsToSearch = queryVariants.slice(0, 2);
      const liveItems: CatalogItem[] = [];

      for (const variant of variantsToSearch) {
        try {
          const { products, error: rainforestError } = await searchRainforest(
            variant,
            1, // Only page 1
            Math.min(20, pageSize), // Max 20 per variant
            amazonDomain
          );

          if (!rainforestError && products.length > 0) {
            const formatted = products.map(formatCatalogItem);
            liveItems.push(...formatted);

            // Cache results to catalog_items immediately
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
              tags: [qNorm],
              updated_at: new Date().toISOString(),
            }));

            await supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
          }
        } catch (err) {
          console.warn(`[CATALOG_SEARCH] Live search error for "${variant}":`, err);
        }
      }

      // Merge with DB results, dedupe by ID
      const existingIds = new Set(dbItems.map(i => i.id));
      const newLiveItems = liveItems.filter(i => !existingIds.has(i.id));
      dbItems = [...dbItems, ...newLiveItems].slice(0, pageSize);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[CATALOG_SEARCH] Returning ${dbItems.length} items, usedLive=${usedLiveFallback}, durationMs=${durationMs}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: qOriginal,
      lang,
      expand: expand ? 1 : 0,
      queryVariants,
      page,
      pageSize,
      total: dbItems.length,
      items: dbItems,
      source: usedLiveFallback ? "db+live" : "db",
      cached: !usedLiveFallback,
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
