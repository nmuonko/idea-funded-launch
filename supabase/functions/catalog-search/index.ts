/**
 * Catalog Search Endpoint - Provider Mixing (eBay + Amazon)
 * 
 * GET /catalog-search?q=iphone&cursor=...&limit=24&provider=mixed
 * 
 * THIN ORCHESTRATOR: Heavy logic is delegated to shared modules.
 * Provider fetchers are lazy-imported to reduce bundle graph.
 * 
 * ALWAYS returns HTTP 200 with stable JSON
 */

import { createAdminPostgrestClient } from "../_shared/postgrest.ts";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";
import { isBlockedSearchQuery, getBlockedSearchMessage, filterDisallowedItems } from "../_shared/contentBlocker.ts";
import { getCatalogSettings, getEffectiveMode } from "../_shared/catalogSettings.ts";
import {
  mixProviderItems, encodeMixerCursor, decodeMixerCursor, getInitialCursor,
  logMixerDebug, ProviderItem, buildProviderStats,
} from "../_shared/providerMixer.ts";
import { buildCacheKey, getCache, setCache } from "../_shared/catalogCache.ts";
import { rewriteSearchQuery } from "../_shared/searchRewriter.ts";
import { canonicalizeQuery } from "../_shared/queryCanonicalizer.ts";
import { enrichItemsWithMediaCounts } from "../_shared/mediaCache.ts";
import { logMixerRequest, AmazonLiveReason } from "../_shared/amazonLivePolicy.ts";
import { validateSort, parseFilters, postFilterItems, postSortItems, buildAppliedSortFilter } from "../_shared/sortFilterNormalizer.ts";
import { getEnabledProviders, getClientPlatform } from "../_shared/featureFlags.ts";
import { getClientIp } from "../_shared/rateLimiter.ts";
import {
  VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS, isVehicleQuery, isVehicleMakeModelQuery,
  hasVehicleBuyingIntent, isAmbiguousQuery, VehicleProbeResult,
  isHeavyEquipmentQuery, classifySearchIntent,
} from "../_shared/vehicleDetection.ts";
import type { SearchIntent } from "../_shared/vehicleDetection.ts";
import { scoreAndRankItems } from "../_shared/searchIntentScorer.ts";
import { refineQueryWithAi, AiRefineResult } from "../_shared/searchAiExpand.ts";
import { probeEbayVehicleCategory } from "../_shared/vehicleProbe.ts";
import { resolveCategoryWithDb } from "../_shared/categoryRegistry.ts";
import { applyVehicleGuardrails, isVehicleLikeQuery as isVehicleLikeQueryGuardrail } from "../_shared/vehicleGuardrails.ts";
import { lookupTranslationCache, callOpenAiTranslation, writeTranslationCache } from "../_shared/queryTranslator.ts";
import { findNearMatch, assertGlobalCacheKey, removeStopwords } from "../_shared/searchCacheSimilarity.ts";
import { FR_EN_MAP } from "../_shared/frenchEnglishMap.ts";
import { preNormalizeQuery } from "../_shared/queryPreNormalizer.ts";

// Extracted modules
import { expandQueryWithAi } from "../_shared/searchAiExpand.ts";
import { CatalogItem } from "../_shared/catalogItemMapper.ts";
import { searchDbFirst } from "../_shared/searchDbFirst.ts";
import { validateCacheHit, filterCachedItems } from "../_shared/searchCacheGuard.ts";
import {
  buildEmptyResponse, buildResponseHeaders, corsHeaders,
  SearchResponse, SearchMeta,
} from "../_shared/searchResponseBuilder.ts";
import type { SearchTimings } from "../_shared/searchResponseBuilder.ts";

const DEFAULT_LIMIT = 100;   // Default page size
const MAX_LIMIT = 100;       // Max page size (eBay hard limit = 100)
const SESSION_LIMIT = 500;   // Max items per search session (5 pages × 100)
const MAX_PAGES = 5;         // Maximum number of pages per search session

// ─── TIME BUDGET CONSTANTS ─────────────────────────────────────────────────
const PAGE0_DEADLINE_MS = 1800;  // Hard deadline for page 0 (leave ~200ms for JSON/edge)
const TOTAL_BUDGET_MS = 4000;    // Budget for page > 0
const FAST_MIN_FIRST_PAGE = 60;  // Return page 0 as soon as we have this many items
const REWRITE_BUDGET_MS = 600;   // Tighter rewrite budget
const DB_BUDGET_MS_P0 = 400;     // DB budget on page 0
const DB_BUDGET_MS = 500;        // DB budget on page > 0
const PROVIDER_TIMEOUT_P0 = 1200; // Provider timeout on page 0
const PROVIDER_TIMEOUT_PN = 3000; // Provider timeout on page > 0
const AI_TIMEOUT_P0 = 300;       // AI refiner/translator timeout on page 0
const ALT_QUERIES_MAX = 1;

// ─── FAST PATH: DIRECT QUERY DETECTION ─────────────────────────────────────
const MODEL_TOKENS = new Set([
  "iphone","samsung","tecno","infinix","pixel","playstation","ps5","ps4","xbox",
  "macbook","thinkpad","galaxy","redmi","oppo","vivo","huawei","camon","spark",
  "hot","note","nintendo","switch","airpods","ipad","dell","hp","lenovo","asus",
  "acer","msi","razer","jbl","sony","lg","hisense","bose","canon","nikon",
  "gopro","garmin","fitbit","dyson","karcher","bosch","makita","dewalt",
]);
const BROAD_SINGLE_TERMS = new Set([
  "telephone","téléphone","tv","frigo","vetement","vêtement","chaussure",
  "ordinateur","voiture","cuisiniere","cuisinière","montre","casque","tablette",
  // Fashion (EN + FR) — skip AI refiner for these
  "skirt","dress","shirt","pants","jeans","jacket","shoes","boots","sneakers",
  "heels","clothing","hat","belt","hoodie","sweater","coat",
  "jupe","robe","chemise","pantalon","chaussures","bottes","vêtements",
  "sandales","baskets","manteau","veste","pull",
]);

function isDirectQuery(q: string): boolean {
  const words = q.trim().split(/\s+/);
  if (words.length > 6) return false;
  // Single broad term → NOT direct
  if (words.length === 1 && BROAD_SINGLE_TERMS.has(words[0].toLowerCase())) return false;
  const qLow = q.toLowerCase();
  // Contains digit → direct
  if (/\d/.test(qLow)) return true;
  // Contains known model token → direct
  for (const w of words) {
    if (MODEL_TOKENS.has(w.toLowerCase())) return true;
  }
  return false;
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  const timings: SearchTimings = { rewrite: 0, aiRefine: 0, dbFirst: 0, providers: 0, altQueries: 0, postProcess: 0, total: 0 };
  const url = new URL(req.url);

  const rawQuery = url.searchParams.get("q") || "";
  const qOriginal = rawQuery.trim();
  const cursor = url.searchParams.get("cursor") || null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") || url.searchParams.get("pageSize") || String(DEFAULT_LIMIT), 10)));
  const pageParam = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10));
  const isFirstPage = pageParam === 0;
  const providerParam = url.searchParams.get("provider") || null;
  const rawCategoryKey = url.searchParams.get("category_key") || url.searchParams.get("categoryKey") || url.searchParams.get("category") || url.searchParams.get("_recipeKey") || url.searchParams.get("recipeKey") || null;
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);

  // ─── CATEGORY RESOLUTION (deferred to parallel block below) ──────────────
  // Treat home/accueil/all as no category filter
  const IGNORED_CATS = new Set(["all", "home", "accueil", ""]);
  let categoryKey = (rawCategoryKey && !IGNORED_CATS.has(rawCategoryKey.toLowerCase())) ? rawCategoryKey : null;

  // ─── FIX A: ENV FALLBACK — public clients auto-use production ───────────
  const authHeader = req.headers.get("authorization") || "";
  const isAdminJwt = authHeader.startsWith("Bearer ") && authHeader.length > 200; // service/admin JWTs are long
  const effectiveEnv = (envName !== "production" && !isAdminJwt) ? "production" : envName;
  if (effectiveEnv !== envName) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} env_auto_fallback: ${envName} → ${effectiveEnv}`);
  }

  const sortParam = url.searchParams.get("sort") || "relevance";
  const sort = validateSort(sortParam);
  const filtersParam = url.searchParams.get("filters") || null;
  const catalogFilters = parseFilters(filtersParam);

  // ─── DEFERRED: Canonicalization + intent detection moved AFTER translation ──
  // This prevents fuzzy corruption of French tokens (e.g., "talon" → "tahoe")
  // before they get translated to English.
  // Placeholders — will be set after translation layer below.
  let qCanonicalized = qOriginal;
  let isHeavyEquipment = false;
  let hasBuyingIntent = false;
  let hasMakeModel = false;
  let vehicleProbeResult: VehicleProbeResult | null = null;
  let earlyIntent: SearchIntent = { intentKey: "general", vehicleListingIntent: false, confidence: 0 };

  let searchMeta: SearchMeta = {
    originalQuery: qOriginal,
    normalizedQuery: qOriginal.toLowerCase().replace(/\s+/g, " "),
    rewrittenQuery: qOriginal.toLowerCase().replace(/\s+/g, " "),
    rewriteApplied: false,
    ruleId: null,
    rulePriority: null,
    categoryKey,
  };

  console.log(`[CATALOG_SEARCH] requestId=${requestId} request`, JSON.stringify({ q: qOriginal, category_key: categoryKey, cursor, limit, provider: providerParam, lang }));

  // Empty query
  if (!qOriginal) {
    return new Response(JSON.stringify(buildEmptyResponse(qOriginal, envName, searchMeta, startTime)), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Blocked content
  if (isBlockedSearchQuery(qOriginal)) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} BLOCKED query: "${qOriginal}"`);
    return new Response(JSON.stringify({
      ...buildEmptyResponse(qOriginal, envName, searchMeta, startTime),
      warning: { message: getBlockedSearchMessage(lang), code: "BLOCKED_CONTENT" },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ─── PRE-NORMALIZER (deterministic, runs before AI) ──────────────────────
  const preNorm = preNormalizeQuery(qOriginal, categoryKey);
  let preNormSkipAI = preNorm.skipAI;
  if (preNorm.matched) {
    // Use pre-normalizer's effective query as the working query
    qCanonicalized = preNorm.effectiveQuery;
    searchMeta.rewrittenQuery = preNorm.effectiveQuery;
    searchMeta.rewriteApplied = true;
    // Only infer category if user didn't explicitly set one
    if (!categoryKey && preNorm.inferredCategory) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} preNorm_inferred_category: ${preNorm.inferredCategory} (rule: ${preNorm.matchRule})`);
    }
    console.log(`[CATALOG_SEARCH] requestId=${requestId} preNorm_matched: "${qOriginal}" → "${preNorm.effectiveQuery}" rule=${preNorm.matchRule} skipAI=${preNorm.skipAI}`);
  }

  try {
    const supabase = createAdminPostgrestClient();
    const perfLog = { rewrite_ms: 0, settings_ms: 0, cache_ms: 0, flags_ms: 0 };

    // ─── FEATURE FLAGS ────────────────────────────────────────────────────────
    const flagsStart = Date.now();
    const clientPlatform = getClientPlatform(req);
    const enabledProviders = await getEnabledProviders(supabase, clientPlatform, providerParam);
    perfLog.flags_ms = Date.now() - flagsStart;

    // ─── RATE LIMITING ────────────────────────────────────────────────────────
    const clientIp = getClientIp(req);
    const rateLimitKey = `ip:${clientIp}:catalog-search`;
    const { data: rateLimitResult, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
      p_key: rateLimitKey, p_limit: 60, p_window_minutes: 5,
    });

    if (!rateLimitError && rateLimitResult && !rateLimitResult.allowed) {
      return new Response(JSON.stringify({
        ...buildEmptyResponse(qOriginal, envName, searchMeta, startTime, { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests." }),
        retry_after: rateLimitResult.reset_at,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": rateLimitResult.reset_at || "" },
      });
    }

    // ─── PARALLEL: REWRITE + SETTINGS + CATEGORY (with timeout budget) ────────
    const rewriteStart = Date.now();
    let settings: any;
    try {
      const rewriteTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("REWRITE_TIMEOUT")), REWRITE_BUDGET_MS)
      );
      const categoryPromise = rawCategoryKey
        ? resolveCategoryWithDb(createAdminPostgrestClient(), rawCategoryKey, requestId)
        : Promise.resolve(null);
      const [searchMetaResult2, settingsResult, catResult] = await Promise.race([
        Promise.all([
          rewriteSearchQuery(supabase, qOriginal, { lang, categoryKey, requestId }),
          getCatalogSettings(supabase),
          categoryPromise,
        ]),
        rewriteTimeout.then(() => { throw new Error("REWRITE_TIMEOUT"); }) as never,
      ]);
      searchMeta = searchMetaResult2;
      settings = settingsResult;
      if (catResult && categoryKey) {
        if (catResult.resolved) {
          categoryKey = catResult.resolved;
          if (categoryKey !== rawCategoryKey) {
            console.log(`[CATALOG_SEARCH] requestId=${requestId} category_resolved: "${rawCategoryKey}" → "${categoryKey}" (${catResult.method})`);
          }
        } else {
          // FAIL-OPEN: unknown category → remove filter instead of returning 0
          console.log(`[CATALOG_SEARCH] requestId=${requestId} category_unresolved: "${rawCategoryKey}" — fail-open, clearing category filter`);
          categoryKey = null;
        }
      }
    } catch {
      console.warn(`[CATALOG_SEARCH] requestId=${requestId} rewrite_timeout — using defaults`);
      settings = await getCatalogSettings(supabase);
    }
    timings.rewrite = Date.now() - rewriteStart;
    perfLog.rewrite_ms = timings.rewrite;
    let qNorm = searchMeta.rewrittenQuery;

    // If preNormalizer already matched, use its effectiveQuery as qNorm and skip translation
    if (preNorm.matched) {
      qNorm = preNorm.effectiveQuery;
      searchMeta.rewrittenQuery = preNorm.effectiveQuery;
      searchMeta.rewriteApplied = true;
    }

    if (searchMeta.rewriteApplied && !preNorm.matched) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} Query rewritten: "${qOriginal}" → "${qNorm}"`);
    }

    // ─── FIX #1: FAST BILINGUAL REWRITE FALLBACK ─────────────────────────────
    // If rewrite table didn't match, apply shared FR→EN map
    const FR_EN_FALLBACK = FR_EN_MAP;

    // Detect if query might be French: accented chars, lang=fr, or matches FR terms
    const qNormLower = qNorm.toLowerCase().replace(/\s+/g, " ").trim();
    const removeAccentsFn = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const qNoAccents = removeAccentsFn(qNormLower);
    const hasAccents = qNormLower !== qNoAccents;
    const isFrenchLikely = lang === "fr" || hasAccents;

    // ─── FR STOP-WORD REMOVAL for better static map matching ────────────────
    // "jupes pour dames" → "jupes dames", "robe de soirée" → "robe soirée"
    const FR_STOP_WORDS = new Set(["pour", "de", "du", "des", "le", "la", "les", "un", "une", "en", "a", "à"]);
    const qNormNoStops = qNormLower.split(/\s+/).filter(w => !FR_STOP_WORDS.has(w)).join(" ");
    const qNoAccentsNoStops = qNoAccents.split(/\s+/).filter(w => !FR_STOP_WORDS.has(w)).join(" ");

    let frFallbackApplied = false;
    const originalQNormBeforeFrFallback = qNorm;

    // ─── TRANSLATION LAYER (DB cache → static fallback → OpenAI) ─────────
    // Skip entirely if preNormalizer already produced an English query
    let translateStatus = preNorm.matched ? "PRE_NORM" : "SKIP";
    let translateMs = 0;
    let translateProvider = preNorm.matched ? "preNormalizer" : "";
    const translateStart = Date.now();

    if (!preNorm.matched && (!searchMeta.rewriteApplied || qNorm === qNormLower)) {
      // [Step 1] DB translation cache lookup
      const cacheHit = await lookupTranslationCache(qNormLower, requestId);
      if (cacheHit) {
        qNorm = cacheHit.translatedQuery;
        searchMeta.rewrittenQuery = cacheHit.translatedQuery;
        searchMeta.rewriteApplied = true;
        frFallbackApplied = true;
        translateStatus = "HIT";
        translateProvider = cacheHit.provider;
        translateMs = Date.now() - translateStart;
      } else {
        // [Step 2] Static FR_EN_FALLBACK (existing logic)
        // Try exact match, then without accents, then without stop words
        const directMatch = FR_EN_FALLBACK[qNormLower] || FR_EN_FALLBACK[qNoAccents]
          || FR_EN_FALLBACK[qNormNoStops] || FR_EN_FALLBACK[qNoAccentsNoStops];
        if (directMatch) {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} fr_fallback: "${qNorm}" → "${directMatch}"`);
          qNorm = directMatch;
          searchMeta.rewrittenQuery = directMatch;
          searchMeta.rewriteApplied = true;
          frFallbackApplied = true;
          translateStatus = "STATIC";
          translateProvider = "static";
          // Write static translation to cache (fire-and-forget)
          writeTranslationCache(qNormLower, directMatch, "fr", "static", requestId);
        } else if (isFrenchLikely) {
          // Sort by key length descending so multi-word phrases match before single words
          const sortedEntries = Object.entries(FR_EN_FALLBACK)
            .sort((a, b) => b[0].length - a[0].length);
          let translated = qNormNoStops; // Use stop-word-stripped version for better matching
          let anyMatch = false;
          for (const [frTerm, enTerm] of sortedEntries) {
            const frTermNoAccents = removeAccentsFn(frTerm);
            if (translated.includes(frTerm)) {
              translated = translated.replace(frTerm, enTerm);
              anyMatch = true;
            } else if (translated.includes(frTermNoAccents)) {
              translated = translated.replace(frTermNoAccents, enTerm);
              anyMatch = true;
            }
          }
          if (anyMatch) {
            qNorm = translated.trim().replace(/\s+/g, " ");
            searchMeta.rewrittenQuery = qNorm;
            searchMeta.rewriteApplied = true;
            frFallbackApplied = true;
            translateStatus = "STATIC";
            translateProvider = "static";
            console.log(`[CATALOG_SEARCH] requestId=${requestId} fr_fallback_multi: "${qNormLower}" => "${qNorm}"`);
            // Write multi-match static translation to cache
            writeTranslationCache(qNormLower, qNorm, "fr", "static", requestId);
          }
        }

        // [Step 3] OpenAI translation if still French-likely and no translation yet
        // On page 0: race with AI_TIMEOUT_P0 to avoid blocking
        if (isFrenchLikely && !frFallbackApplied) {
          const aiTranslateTimeout = isFirstPage ? AI_TIMEOUT_P0 : 2000;
          const aiTranslatePromise = callOpenAiTranslation(qNormLower, requestId);
          const aiResult = await Promise.race([
            aiTranslatePromise,
            new Promise<null>(r => setTimeout(() => r(null), aiTranslateTimeout)),
          ]);
          if (aiResult) {
            if (!aiResult.unchanged) {
              qNorm = aiResult.translated_query;
              searchMeta.rewrittenQuery = aiResult.translated_query;
              searchMeta.rewriteApplied = true;
              frFallbackApplied = true;
              translateStatus = "MISS";
              translateProvider = "openai:gpt-4o-mini:v1";
              writeTranslationCache(qNormLower, aiResult.translated_query, aiResult.source_lang, "openai:gpt-4o-mini:v1", requestId);
              console.log(`[CATALOG_SEARCH] requestId=${requestId} openai_translate: "${qNormLower}" → "${aiResult.translated_query}"`);
            } else {
              translateStatus = "SKIP";
              translateProvider = "openai:gpt-4o-mini:v1";
            }
          } else {
            translateStatus = "TIMEOUT";
            translateProvider = "";
            console.log(`[CATALOG_SEARCH] requestId=${requestId} openai_translate_timeout (${aiTranslateTimeout}ms) — using raw query`);
          }
        }
      }
      translateMs = Date.now() - translateStart;
    }

    // ─── CANONICALIZATION + INTENT DETECTION (post-translation) ──────────────
    // Runs AFTER translation so French tokens are already English.
    // Prevents fuzzy corruption like "talon" → "tahoe" before translation.
    qCanonicalized = canonicalizeQuery(qNorm);
    const qNormForIntent = qCanonicalized.toLowerCase().replace(/\s+/g, " ");
    isHeavyEquipment = isHeavyEquipmentQuery(qNormForIntent);

    earlyIntent = classifySearchIntent(qNormForIntent);
    console.log(`[CATALOG_SEARCH] requestId=${requestId} intent=${earlyIntent.intentKey} (post-translate)`);

    if (qCanonicalized !== qNorm) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} query_canonicalized: "${qNorm}" → "${qCanonicalized}"`);
      qNorm = qCanonicalized;
      searchMeta.rewrittenQuery = qNorm;
    }

    if (isHeavyEquipment) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} HEAVY_EQUIPMENT detected`);
    }

    hasBuyingIntent = hasVehicleBuyingIntent(qCanonicalized);
    hasMakeModel = isVehicleMakeModelQuery(qCanonicalized);

    if (earlyIntent.vehicleListingIntent && !hasBuyingIntent) {
      hasBuyingIntent = true;
      console.log(`[CATALOG_SEARCH] requestId=${requestId} FORCED hasBuyingIntent=true via vehicle_listing intent`);
    }

    const hasAccessoryInQuery = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw =>
      qCanonicalized.toLowerCase().includes(kw)
    );

    if (!hasBuyingIntent && !hasAccessoryInQuery && !isHeavyEquipment && !earlyIntent.vehicleListingIntent && isAmbiguousQuery(qCanonicalized)) {
      try {
        const supabaseForProbe = createAdminPostgrestClient();
        vehicleProbeResult = await probeEbayVehicleCategory(supabaseForProbe, qCanonicalized, requestId);
        if (vehicleProbeResult.vehicleMode) {
          hasBuyingIntent = true;
        }
      } catch (e) {
        console.warn(`[VEHICLE_PROBE] requestId=${requestId} probe failed:`, (e as Error).message);
      }
    }

    // ─── AI QUERY REFINER ──────────────────────────────────────────────────────
    // Skip AI entirely when preNormalizer matched (deterministic fast path)
    // On page 0: race AI with AI_TIMEOUT_P0 to never block
    const directQuery = isDirectQuery(qNorm) || preNormSkipAI;
    const aiRefinePromise = preNormSkipAI
      ? Promise.resolve(null)
      : refineQueryWithAi(supabase, qNorm, qOriginal, lang, requestId);
    if (directQuery) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} FAST_PATH: directQuery=${isDirectQuery(qNorm)} preNormSkipAI=${preNormSkipAI}, skipping AI refiner await + DB-first`);
    }

    // ─── EFFECTIVE MODE ───────────────────────────────────────────────────────
    const baseEffectiveMode = getEffectiveMode(settings, providerParam || undefined);
    const effectiveMode = {
      ...baseEffectiveMode,
      amazonActive: baseEffectiveMode.amazonActive && enabledProviders.amazon,
      ebayActive: baseEffectiveMode.ebayActive && enabledProviders.ebay,
    };

    // Decode cursor
    let mixerCursor = getInitialCursor();
    if (cursor) {
      const decoded = decodeMixerCursor(cursor);
      if (decoded) mixerCursor = decoded;
    }

    // ─── INTENT CLASSIFICATION (re-classify after rewrite for final intent) ──
    const searchIntent = classifySearchIntent(qNorm);
    // Use early intent for vehicle routing (pre-rewrite is more accurate for make/model)
    let effectiveIntent = earlyIntent.intentKey !== "general" ? earlyIntent : searchIntent;

    // Force vehicle_listing intent when Vehicles tab is active
    const isVehiclesTab = categoryKey === "vehicles" || categoryKey === "vehicles_cars_trucks" || categoryKey === "vehicles_motorcycles";
    if (isVehiclesTab) {
      effectiveIntent = { ...effectiveIntent, intentKey: "vehicle_listing", vehicleListingIntent: true };
      hasBuyingIntent = true;
      console.log(`[CATALOG_SEARCH] requestId=${requestId} FORCED vehicle_listing intent via category=${categoryKey}`);
    }

    // ─── CACHE CHECK (GLOBAL — no user identifiers) ─────────────────────────
    const cacheStart = Date.now();
    let globalCacheKey = buildCacheKey("search", {
      env: effectiveEnv, query: qNorm, provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit,
      minPrice: catalogFilters.minPrice, maxPrice: catalogFilters.maxPrice,
      brand: catalogFilters.brand?.join(","), rating: catalogFilters.rating,
      condition: catalogFilters.condition, sort, vehicleMode: hasBuyingIntent,
      intentKey: effectiveIntent.intentKey,
    });
    // ASSERTION: Ensure no user identifiers leaked into cache key
    globalCacheKey = assertGlobalCacheKey(globalCacheKey, requestId);

    let cacheResult = await getCache(supabase, globalCacheKey);
    const envUsed = effectiveEnv;
    perfLog.cache_ms = Date.now() - cacheStart;

    // Validate cache
    cacheResult = validateCacheHit({ cacheResult, qNorm, hasBuyingIntent, catalogFilters, requestId });

    // Track cache status for headers
    let finalCacheStatus = "MISS";
    let cacheMatchedQuery: string | null = null;
    let cacheTtlRemaining = 0;

    // ─── FRESH CACHE HIT ──────────────────────────────────────────────────────
    if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
      const cachedResponse = cacheResult.data;
      const cachedItems = filterCachedItems(cachedResponse.items || [], hasBuyingIntent, catalogFilters, requestId, effectiveIntent.intentKey);
      finalCacheStatus = "HIT";
      // Compute TTL remaining
      const expiresAt = cacheResult.data?._meta?.cachedAt ? new Date(cacheResult.data._meta.cachedAt).getTime() + 7 * 24 * 60 * 60 * 1000 : 0;
      cacheTtlRemaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      const hitHeaders = buildResponseHeaders(cachedItems.length, 3600, { cacheStatus: "HIT", cacheAgeSec: cacheResult.cacheAgeSec, responseTimeMs: Date.now() - startTime });
      hitHeaders["X-Cache-TTL-Remaining"] = String(cacheTtlRemaining);
      hitHeaders["X-Results-Count"] = String(cachedItems.length);
      hitHeaders["X-Next-Cursor"] = cachedResponse.nextCursor ? "present" : "absent";
      hitHeaders["X-Translate"] = translateStatus;
      hitHeaders["X-Translate-Ms"] = String(translateMs);
      if (translateProvider) hitHeaders["X-Translate-Provider"] = translateProvider;
      hitHeaders["Access-Control-Expose-Headers"] = "x-afrishop-search-debug, x-afrishop-search-intent, X-Cache-Status, X-Cache-Age, X-Cache-TTL-Remaining, X-Results-Count, X-Next-Cursor, X-Cache-Match, X-Response-Time, X-Search-T-Total, X-Search-T-Rewrite, X-Search-T-Db, X-Search-T-Upstream, X-Search-T-AltQueries, X-Search-T-PostProcess, X-Translate, X-Translate-Ms, X-Translate-Provider";
      // Structured log
      console.log(JSON.stringify({ event: "search_cache", canonicalQuery: qNorm, cacheStatus: "HIT", matchedQuery: null, provider: providerParam || "all", ttlRemaining: cacheTtlRemaining, resultsCount: cachedItems.length, totalMs: Date.now() - startTime, upstreamMs: 0, requestId }));
      return new Response(JSON.stringify({
        ...cachedResponse, items: cachedItems, total: cachedItems.length,
        query: qOriginal, env: envName, durationMs: Date.now() - startTime,
        _cacheHit: true, _cacheAgeSec: cacheResult.cacheAgeSec,
        meta: { source: "cache", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      }), { status: 200, headers: hitHeaders });
    }

    // ─── NEAR-MATCH LOOKUP (global similarity cache) ──────────────────────────
    if (!cacheResult.hit || cacheResult.negativeCached) {
      const nearMatch = await findNearMatch(supabase, qNorm, {
        provider: providerParam || "all",
        vehicleMode: hasBuyingIntent,
        categoryKey: categoryKey || undefined,
        intentKey: effectiveIntent.intentKey,
        sort,
        page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
      }, requestId);

      if (nearMatch.hit && nearMatch.data) {
        const nearItems = filterCachedItems(nearMatch.data.items || [], hasBuyingIntent, catalogFilters, requestId, effectiveIntent.intentKey);
        if (nearItems.length > 0) {
          finalCacheStatus = "NEAR_HIT";
          cacheMatchedQuery = nearMatch.matchedQuery;
          const nearHeaders = buildResponseHeaders(nearItems.length, 3600, { cacheStatus: "NEAR_HIT", cacheAgeSec: nearMatch.cacheAgeSec, responseTimeMs: Date.now() - startTime });
          nearHeaders["X-Cache-TTL-Remaining"] = String(nearMatch.ttlRemainingSec);
          nearHeaders["X-Results-Count"] = String(nearItems.length);
          nearHeaders["X-Next-Cursor"] = nearMatch.data.nextCursor ? "present" : "absent";
          nearHeaders["X-Cache-Match"] = nearMatch.matchedQuery || "";
          nearHeaders["X-Translate"] = translateStatus;
          nearHeaders["X-Translate-Ms"] = String(translateMs);
          if (translateProvider) nearHeaders["X-Translate-Provider"] = translateProvider;
          nearHeaders["Access-Control-Expose-Headers"] = "x-afrishop-search-debug, x-afrishop-search-intent, X-Cache-Status, X-Cache-Age, X-Cache-TTL-Remaining, X-Results-Count, X-Next-Cursor, X-Cache-Match, X-Response-Time, X-Search-T-Total, X-Search-T-Rewrite, X-Search-T-Db, X-Search-T-Upstream, X-Search-T-AltQueries, X-Search-T-PostProcess, X-Translate, X-Translate-Ms, X-Translate-Provider";
          // Structured log
          console.log(JSON.stringify({ event: "search_cache", canonicalQuery: qNorm, cacheStatus: "NEAR_HIT", matchedQuery: nearMatch.matchedQuery, provider: providerParam || "all", ttlRemaining: nearMatch.ttlRemainingSec, resultsCount: nearItems.length, totalMs: Date.now() - startTime, upstreamMs: 0, similarity: nearMatch.similarity, requestId }));
          return new Response(JSON.stringify({
            ...nearMatch.data, items: nearItems, total: nearItems.length,
            query: qOriginal, env: envName, durationMs: Date.now() - startTime,
            _cacheHit: true, _cacheAgeSec: nearMatch.cacheAgeSec, _nearMatch: true,
            _matchedQuery: nearMatch.matchedQuery, _similarity: nearMatch.similarity,
            meta: { source: "near_match", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString(), matchedQuery: nearMatch.matchedQuery, similarity: nearMatch.similarity },
          }), { status: 200, headers: nearHeaders });
        }
      }
    }

    // ─── STALE-WHILE-REVALIDATE ───────────────────────────────────────────────
    const isStaleCache = cacheResult.hit && cacheResult.stale && !cacheResult.negativeCached;
    const staleItemCount = cacheResult.data?.items?.length ?? 0;

    if (isStaleCache && cacheResult.data && staleItemCount > 0) {
      const staleItems = filterCachedItems(cacheResult.data.items || [], hasBuyingIntent, catalogFilters, requestId, effectiveIntent.intentKey);
      const staleDuration = Date.now() - startTime;

      // Fire-and-forget background refresh
      (async () => {
        try {
          const bgId = requestId + "-bg";
          const { fetchAmazonItems } = await import("../_shared/amazonFetcher.ts");
          const { fetchEbayItems } = await import("../_shared/ebayFetcher.ts");
          const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;
          const [bgAmazon, bgEbay] = await Promise.allSettled([
            fetchAmazonItems({ supabase, query: qNorm, settings, effectiveMode, mixerCursor, isVehicle: isVehicleQuery(qNorm), hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId: bgId }),
            fetchEbayItems({ supabase, query: qNorm, effectiveMode, isVehicle: isVehicleQuery(qNorm), hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId: bgId }),
          ]);
          const bgAmazonItems = bgAmazon.status === "fulfilled" ? bgAmazon.value.items : [];
          const bgEbayItems = bgEbay.status === "fulfilled" ? bgEbay.value.items : [];

          if (bgAmazonItems.length > 0 || bgEbayItems.length > 0) {
            const bgMix = mixProviderItems({ amazonItems: bgAmazonItems as ProviderItem[], ebayItems: bgEbayItems as ProviderItem[], limit, cursor: mixerCursor, amazonFirstCount: settings.mixedAmazonFirstCount, blendRatio: settings.mixedBlendRatio, amazonCap: settings.amazonMaxResultsPerQuery, amazonHasMore: false, ebayHasMore: false, categoryKey: categoryKey || "search", requestId: bgId });
            const bgFinal = filterDisallowedItems(bgMix.items.map(item => ({ ...item, title: (item as CatalogItem).title, productUrl: (item as CatalogItem).productUrl, category: (item as CatalogItem).category })), `[BG_REFRESH] ${bgId}`).allowed;
            const bgResponse = { status: "success", items: bgFinal, total: bgFinal.length, nextCursor: bgMix.nextCursor ? encodeMixerCursor(bgMix.nextCursor) : null, hasMore: bgMix.hasMore, _meta: { qNorm, provider: providerParam || "mixed", page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit, sort, vehicleMode: hasBuyingIntent, minPriceUsed: hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0, cachedAt: new Date().toISOString() } };
            await setCache(supabase, "search", globalCacheKey, bgResponse, { provider: "mixed", query: qNorm, category: categoryKey || undefined, page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit, amazonDomain: "amazon.com" });
          }
        } catch (e) {
          console.warn(`[CATALOG_SEARCH] bg_refresh_fail requestId=${requestId}:`, (e as Error).message);
        }
      })();

      const staleHeaders = buildResponseHeaders(staleItems.length, 300, { cacheStatus: "STALE", cacheAgeSec: cacheResult.cacheAgeSec, responseTimeMs: staleDuration });
      staleHeaders["X-Cache-TTL-Remaining"] = "0";
      staleHeaders["X-Results-Count"] = String(staleItems.length);
      staleHeaders["X-Next-Cursor"] = cacheResult.data.nextCursor ? "present" : "absent";
      staleHeaders["X-Translate"] = translateStatus;
      staleHeaders["X-Translate-Ms"] = String(translateMs);
      if (translateProvider) staleHeaders["X-Translate-Provider"] = translateProvider;
      staleHeaders["Access-Control-Expose-Headers"] = "x-afrishop-search-debug, x-afrishop-search-intent, X-Cache-Status, X-Cache-Age, X-Cache-TTL-Remaining, X-Results-Count, X-Next-Cursor, X-Cache-Match, X-Response-Time, X-Search-T-Total, X-Search-T-Rewrite, X-Search-T-Db, X-Search-T-Upstream, X-Search-T-AltQueries, X-Search-T-PostProcess, X-Translate, X-Translate-Ms, X-Translate-Provider";
      console.log(JSON.stringify({ event: "search_cache", canonicalQuery: qNorm, cacheStatus: "STALE", matchedQuery: null, provider: providerParam || "all", ttlRemaining: 0, resultsCount: staleItems.length, totalMs: staleDuration, upstreamMs: 0, requestId }));
      return new Response(JSON.stringify({
        ...cacheResult.data, items: staleItems, total: staleItems.length,
        query: qOriginal, env: envName, durationMs: staleDuration,
        _cacheHit: true, _cacheAgeSec: cacheResult.cacheAgeSec,
        meta: { source: "stale", isStale: true, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      }), { status: 200, headers: staleHeaders });
    }

    const isVehicle = isVehicleQuery(qNorm);
    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    // ─── RESOLVE AI REFINER (skip await for fast path / page 0) ─────────────
    const aiRefineStart = Date.now();
    let aiRefineResult: AiRefineResult | null = null;
    let aiExpandedTerms: string[] | null = null;

    if (!directQuery && !isFirstPage) {
      // Page > 0: await AI refiner normally (already has internal timeout)
      aiRefineResult = await aiRefinePromise;
      aiExpandedTerms = aiRefineResult?.expandedTerms || null;
    } else {
      // Fast path OR page 0: race AI with short timeout, never block
      const raceTimeout = isFirstPage ? AI_TIMEOUT_P0 : 50;
      const raceResult = await Promise.race([
        aiRefinePromise,
        new Promise<null>((r) => setTimeout(() => r(null), raceTimeout)),
      ]);
      if (raceResult) {
        aiRefineResult = raceResult;
        aiExpandedTerms = raceResult.expandedTerms || null;
        console.log(`[CATALOG_SEARCH] requestId=${requestId} fast_path_ai_resolved_early (${Date.now() - aiRefineStart}ms)`);
      } else if (isFirstPage) {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} page0_ai_skipped (>${raceTimeout}ms) — using raw query`);
      }
    }
    timings.aiRefine = Date.now() - aiRefineStart;
    
    // Use AI refined query as primary, with vehicle poison safety check
    const POISON_SUFFIXES = ["accessories", "parts", "floor mats", "car parts", "case", "cover", "phone", "charger", "floor mat"];
    if (aiRefineResult && aiRefineResult.refined && aiRefineResult.refined !== qNorm) {
      if (isVehicleLikeQueryGuardrail(qOriginal)) {
        const addedWords = aiRefineResult.refined.toLowerCase().replace(qNorm.toLowerCase(), "").trim();
        if (POISON_SUFFIXES.some(p => addedWords.includes(p))) {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_refine_BLOCKED_vehicle_poison: "${aiRefineResult.refined}" (added="${addedWords}")`);
        } else {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_refine_override: "${qNorm}" → "${aiRefineResult.refined}"`);
          qNorm = aiRefineResult.refined;
          searchMeta.rewrittenQuery = aiRefineResult.refined;
          searchMeta.rewriteApplied = true;
        }
      } else {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_refine_override: "${qNorm}" → "${aiRefineResult.refined}"`);
        qNorm = aiRefineResult.refined;
        searchMeta.rewrittenQuery = aiRefineResult.refined;
        searchMeta.rewriteApplied = true;
      }
    }

    // ─── COMPUTE providerQuery — STRICT ENGLISH FOR PROVIDERS ─────────────────
    // Priority: FR_EN_FALLBACK rewrite > AI expansion > canonicalized > original
    // Ensure we never send French to providers when we have an English rewrite
    const qRewrite = searchMeta.rewriteApplied ? searchMeta.rewrittenQuery : null;
    let providerQuery = qRewrite || qCanonicalized || qOriginal;

    // Safety: if providerQuery still contains known French trigger tokens, force English
    const FR_FORCE_MAP = FR_EN_MAP;
    const pqTokens = providerQuery.toLowerCase().split(/\s+/);
    for (const token of pqTokens) {
      const stripped = token.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (FR_FORCE_MAP[token] || FR_FORCE_MAP[stripped]) {
        const enWord = FR_FORCE_MAP[token] || FR_FORCE_MAP[stripped];
        providerQuery = providerQuery.toLowerCase().replace(token, enWord);
        console.log(`[CATALOG_SEARCH] requestId=${requestId} providerQuery_force_en: "${token}" → "${enWord}" => providerQuery="${providerQuery}"`);
      }
    }
    // Deduplicate consecutive/repeated tokens (e.g., "refrigerator refrigerator samsung" → "refrigerator samsung")
    providerQuery = [...new Set(providerQuery.trim().split(/\s+/))].join(" ");

    console.log(`[CATALOG_SEARCH] requestId=${requestId} query_pipeline: qOriginal="${qOriginal}" qCanon="${qCanonicalized}" qRewrite="${qRewrite}" providerQuery="${providerQuery}"`);

    // ─── DB-FIRST SEARCH (skip for fast path + time budget) ─────────────────
    let dbFallbackItems: any[] | null = null;
    let dbCount = 0;
    const dbFirstStart = Date.now();

    if (!directQuery && !cursor && !hasBuyingIntent) {
      try {
        const dbTimeout = new Promise<null>((r) => setTimeout(() => r(null), isFirstPage ? DB_BUDGET_MS_P0 : DB_BUDGET_MS));
        const dbWork = searchDbFirst({
          supabase, qNorm, aiExpandedTerms, limit, categoryKey, requestId,
        });
        const dbResult = await Promise.race([dbWork, dbTimeout]);
        
        if (dbResult) {
          dbCount = dbResult.dbCount;

          if (dbResult.items) {
            let dbItems = dbResult.items;
            const SCORED_INTENTS = ["gaming", "phone_device", "vehicle_listing", "phone_accessory", "appliance_fridge"];
            if (SCORED_INTENTS.includes(effectiveIntent.intentKey)) {
              const dbQueryTokens = providerQuery.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
              const dbScoreResult = scoreAndRankItems(dbItems as unknown as Record<string, unknown>[], effectiveIntent, dbQueryTokens, limit);
              dbItems = dbScoreResult.items as any[];
              console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_${effectiveIntent.intentKey}_scored: before=${dbResult.items.length} after=${dbItems.length} dropped=${dbScoreResult.dropped}`);
              if (dbItems.length === 0) {
                console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_${effectiveIntent.intentKey}_empty_after_scoring — skipping DB-first`);
                dbFallbackItems = null;
              }
            }
            
            if (dbItems.length > 0) {
              dbFallbackItems = dbItems;
              console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_merge: ${dbItems.length} DB items will be merged with provider results`);
            }
          }

          if (!dbFallbackItems) {
            dbFallbackItems = dbResult.fallbackItems;
          }
        } else {
          console.warn(`[CATALOG_SEARCH] requestId=${requestId} db_first_timeout after ${DB_BUDGET_MS}ms`);
        }
      } catch (dbErr) {
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} db_first_error:`, (dbErr as Error).message);
      }
    }
    timings.dbFirst = Date.now() - dbFirstStart;

    // ─── LAZY IMPORT PROVIDERS ────────────────────────────────────────────────
    const { fetchAmazonItems } = await import("../_shared/amazonFetcher.ts");
    const { fetchEbayItems } = await import("../_shared/ebayFetcher.ts");

    // ─── PROVIDER DEBUG TRACKING ──────────────────────────────────────────────
    const ebayDebug = { ok: false, status: null as number | null, count: 0, ms: 0, error: null as string | null };
    const amazonDebug = { ok: false, status: null as number | null, count: 0, ms: 0, error: null as string | null };

    // ─── PARALLEL PROVIDER FETCH — uses providerQuery (English) ───────────────
    // Intent-based provider routing:
    // - gaming: eBay only (Amazon returns wrong results for console queries)
    // - All others (including vehicle_listing): both providers
    const skipAmazon = false; // True proxy mode: always call both providers


    const providerStartMs = Date.now();
    // ─── FAST-FIRST: tight timeouts on page 0, relaxed on page > 0 ──────────
    const isVehicleIntent = effectiveIntent.intentKey === "vehicle_listing" || effectiveIntent.intentKey === "vehicle_parts";
    const elapsedBeforeProviders = Date.now() - startTime;
    // Page 0: enforce hard deadline minus elapsed time; page > 0: generous
    const remainingBudget = isFirstPage
      ? Math.max(800, PAGE0_DEADLINE_MS - elapsedBeforeProviders - 100)
      : Math.max(2000, TOTAL_BUDGET_MS - elapsedBeforeProviders - 200);
    const PROVIDER_TIMEOUT_MS = isFirstPage
      ? Math.min(PROVIDER_TIMEOUT_P0, remainingBudget)
      : Math.min(isVehicleIntent ? 4000 : PROVIDER_TIMEOUT_PN, remainingBudget);

    // For vehicle_listing intent, force eBay Motors category
    const ebayParamsForIntent = { ...{ supabase, query: providerQuery, effectiveMode, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId } };

    // ─── TRUE HARD DEADLINE: non-blocking provider fetch ────────────────────
    // Track provider completion with flags + partial results.
    // On page 0, we NEVER await providers after the deadline — return immediately.
    let amazonDone = false;
    let ebayDone = false;
    let amazonResult: any = null;
    let ebayResult: any = null;
    let amazonError: string | null = null;
    let ebayError: string | null = null;
    let providerTimedOut = false;

    const amazonPromise = (skipAmazon
      ? Promise.resolve({ items: [], hasMore: false, cacheHit: false, budgetRemaining: null, status: "skipped_intent", liveUsed: false, liveReason: "disabled" as AmazonLiveReason })
      : fetchAmazonItems({ supabase, query: providerQuery, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId })
    ).then(r => { amazonResult = r; amazonDone = true; return r; })
     .catch(e => { amazonError = String(e?.message || "unknown").slice(0, 100); amazonDone = true; return null; });

    const ebayPromise = fetchEbayItems(ebayParamsForIntent)
      .then(r => { ebayResult = r; ebayDone = true; return r; })
      .catch(e => { ebayError = String(e?.message || "unknown").slice(0, 100); ebayDone = true; return null; });

    if (isFirstPage) {
      // ─── PAGE 0: Race providers against hard deadline, NEVER block after ───
      const deadlineTimer = new Promise<"DEADLINE">(r => setTimeout(() => r("DEADLINE"), PROVIDER_TIMEOUT_MS));
      
      // Race: wait until deadline OR both providers finish, whichever first
      const bothDone = Promise.all([amazonPromise, ebayPromise]).then(() => "DONE" as const);
      const raceResult = await Promise.race([bothDone, deadlineTimer]);
      
      if (raceResult === "DEADLINE") {
        providerTimedOut = true;
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} PAGE0_HARD_DEADLINE after ${PROVIDER_TIMEOUT_MS}ms — amazonDone=${amazonDone} ebayDone=${ebayDone}`);
        // DO NOT await providers — use whatever we have right now
      }
    } else {
      // ─── PAGE > 0: Standard timeout with allSettled ───────────────────────
      const timeoutPromise = new Promise<"TIMEOUT">(r => setTimeout(() => r("TIMEOUT"), PROVIDER_TIMEOUT_MS));
      const bothDone = Promise.all([amazonPromise, ebayPromise]).then(() => "DONE" as const);
      const raceResult = await Promise.race([bothDone, timeoutPromise]);
      if (raceResult === "TIMEOUT") {
        providerTimedOut = true;
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} PROVIDER_TIMEOUT after ${PROVIDER_TIMEOUT_MS}ms (page=${pageParam})`);
      }
    }

    const providerMs = Date.now() - providerStartMs;
    timings.providers = providerMs;

    // Extract results from flag-based provider tracking
    let amazonItems: CatalogItem[] = [];
    let amazonHasMore = false;
    let amazonCacheHit = false;
    let amazonBudgetRemaining: number | null = null;
    let amazonStatus: string = "disabled";
    let amazonLiveUsed = false;
    let amazonLiveReason: AmazonLiveReason = "disabled";

    if (amazonDone && amazonResult) {
      const r = amazonResult;
      amazonItems = r.items; amazonHasMore = r.hasMore; amazonCacheHit = r.cacheHit;
      amazonBudgetRemaining = r.budgetRemaining; amazonStatus = r.status;
      amazonLiveUsed = r.liveUsed; amazonLiveReason = r.liveReason;
      amazonDebug.ok = true; amazonDebug.count = r.items.length; amazonDebug.ms = providerMs;
    } else if (amazonDone && amazonError) {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} amazon_err:`, amazonError);
      amazonStatus = "error";
      amazonDebug.error = amazonError;
      amazonDebug.ms = providerMs;
    } else if (!amazonDone) {
      // Provider didn't finish before deadline
      amazonStatus = "timeout";
      amazonDebug.error = "deadline_exceeded";
      amazonDebug.ms = providerMs;
      console.log(`[CATALOG_SEARCH] requestId=${requestId} amazon_not_done_at_deadline`);
    }

    let ebayItems: CatalogItem[] = [];
    let ebayHasMore = false;
    let ebayTotal = 0;

    if (ebayDone && ebayResult) {
      const r = ebayResult;
      ebayItems = r.items; ebayHasMore = r.hasMore; ebayTotal = r.total;
      ebayDebug.ok = true; ebayDebug.count = r.items.length; ebayDebug.ms = providerMs;
      (ebayDebug as any).rawCount = r.rawCount ?? r.items.length;
      (ebayDebug as any).mappedCount = r.mappedCount ?? r.items.length;
      (ebayDebug as any).filteredCount = r.filteredCount ?? r.items.length;
      (ebayDebug as any).failOpenUsed = r.failOpenUsed ?? false;
    } else if (ebayDone && ebayError) {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} ebay_err:`, ebayError);
      ebayDebug.error = ebayError;
      ebayDebug.ms = providerMs;
    } else if (!ebayDone) {
      ebayDebug.error = "deadline_exceeded";
      ebayDebug.ms = providerMs;
      console.log(`[CATALOG_SEARCH] requestId=${requestId} ebay_not_done_at_deadline`);
    }

    const providerItemCount = amazonItems.length + ebayItems.length;
    console.log(`[CATALOG_SEARCH] requestId=${requestId} providers_ok providerQuery="${providerQuery}"`, JSON.stringify({ amazon: amazonItems.length, ebay: ebayItems.length, durationMs: providerMs }));

    // ─── ALT QUERIES (max 1, with time budget) ──────────────────────────────
    const altQueriesStart = Date.now();
    const totalProviderItems = amazonItems.length + ebayItems.length;
    const altQueries = aiRefineResult?.alt || [];
    const elapsedSoFar = Date.now() - startTime;
    const activeBudget = isFirstPage ? PAGE0_DEADLINE_MS : TOTAL_BUDGET_MS;
    const budgetExceeded = elapsedSoFar > activeBudget;
    
    // Page 0: NEVER run alt queries unless results are critically low (<10)
    // Page > 0: run alt queries if results are low and budget allows
    const skipAltOnPage0 = isFirstPage && totalProviderItems >= 10;
    const applianceIntentSufficient = effectiveIntent.intentKey === "appliance_fridge" && totalProviderItems >= 20;
    const fashionIntentSufficient = effectiveIntent.intentKey === "fashion" && totalProviderItems >= 20;
    if (!directQuery && totalProviderItems < 60 && !providerTimedOut && !budgetExceeded && !applianceIntentSufficient && !fashionIntentSufficient && !skipAltOnPage0) {
      let altAttempts = 0;
      for (const altQ of altQueries) {
        if (altAttempts >= ALT_QUERIES_MAX) break;
        if (amazonItems.length + ebayItems.length >= limit) break;
        if (altQ === providerQuery || altQ === qCanonicalized) continue;
        if (Date.now() - startTime > activeBudget) {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} alt_query_BUDGET_EXCEEDED — stopping`);
          break;
        }
        
        altAttempts++;
        console.log(`[CATALOG_SEARCH] requestId=${requestId} alt_query_attempt q="${altQ}" (${altAttempts}/${ALT_QUERIES_MAX})`);
        try {
          const altTimeout = Math.min(2000, activeBudget - (Date.now() - startTime));
          if (altTimeout <= 200) break;
          const altPromise = Promise.allSettled([
            skipAmazon
              ? Promise.resolve({ items: [], hasMore: false, cacheHit: false, budgetRemaining: null, status: "skipped_intent", liveUsed: false, liveReason: "disabled" as AmazonLiveReason })
              : fetchAmazonItems({ supabase, query: altQ, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId: requestId + "-alt" }),
            fetchEbayItems({ supabase, query: altQ, effectiveMode, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId: requestId + "-alt" }),
          ]);
          const altTimeoutP = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ALT_TIMEOUT")), altTimeout));
          const altSettled = await Promise.race([altPromise, altTimeoutP]) as [PromiseSettledResult<any>, PromiseSettledResult<any>];
          
          const existingIds = new Set([...amazonItems, ...ebayItems].map(i => i.id));
          if (!skipAmazon && altSettled[0].status === "fulfilled") {
            const newItems = altSettled[0].value.items.filter((i: any) => !existingIds.has(i.id));
            amazonItems = [...amazonItems, ...newItems];
            amazonDebug.count = amazonItems.length;
          }
          if (altSettled[1].status === "fulfilled") {
            const newItems = altSettled[1].value.items.filter((i: any) => !existingIds.has(i.id));
            ebayItems = [...ebayItems, ...newItems];
            ebayDebug.count = ebayItems.length;
          }
          console.log(`[CATALOG_SEARCH] requestId=${requestId} alt_results: amazon=${amazonItems.length} ebay=${ebayItems.length}`);
        } catch {
          console.warn(`[CATALOG_SEARCH] requestId=${requestId} alt_query_timeout`);
        }
      }
    } else if (isFirstPage && totalProviderItems >= 10) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} SKIPPING_ALT_QUERIES: page0 fast path (${totalProviderItems} items already)`);
    } else if (budgetExceeded) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} SKIPPING_ALT_QUERIES: budget exceeded (${elapsedSoFar}ms > ${activeBudget}ms)`);
    } else if (directQuery) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} SKIPPING_ALT_QUERIES: fast path`);
    }
    timings.altQueries = Date.now() - altQueriesStart;

    // ─── MIX RESULTS ──────────────────────────────────────────────────────────
    const postProcessStart = Date.now();
    const mixResult = mixProviderItems({
      amazonItems: amazonItems as ProviderItem[], ebayItems: ebayItems as ProviderItem[],
      limit, cursor: mixerCursor, amazonFirstCount: settings.mixedAmazonFirstCount,
      blendRatio: settings.mixedBlendRatio, amazonCap: settings.amazonMaxResultsPerQuery,
      amazonHasMore, ebayHasMore, categoryKey: categoryKey || "search", requestId,
    });

    if (!cursor) logMixerDebug(mixResult, requestId, categoryKey || "search");

    // ─── MERGE DB-FIRST ITEMS WITH PROVIDER RESULTS ──────────────────────────
    // Deduplicate by provider:id to combine DB + live results
    let mergedItems = [...mixResult.items] as CatalogItem[];
    if (dbFallbackItems && dbFallbackItems.length > 0) {
      const existingKeys = new Set(mergedItems.map(i => `${(i as any).provider}:${i.id}`));
      const newDbItems = dbFallbackItems.filter((item: any) => !existingKeys.has(`${item.provider}:${item.id}`));
      if (newDbItems.length > 0) {
        mergedItems = [...mergedItems, ...newDbItems as CatalogItem[]];
        console.log(`[CATALOG_SEARCH] requestId=${requestId} db_merge: added ${newDbItems.length} unique DB items (total=${mergedItems.length})`);
      }
      dbFallbackItems = null; // consumed, prevent double-use in fallback below
    }

    // Filter disallowed content
    const { allowed: filteredItems } = filterDisallowedItems(
      mergedItems.map(item => ({ ...item, title: (item as CatalogItem).title, productUrl: (item as CatalogItem).productUrl, category: (item as CatalogItem).category })),
      `[SEARCH] requestId=${requestId}`
    );
    const allowedIds = new Set(filteredItems.map(i => i.id));
    const filteredFinalItems = mergedItems.filter(item => allowedIds.has(item.id)) as CatalogItem[];

    // Enrich with media counts – skip blocking prefetch to avoid timeout cascade
    const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
      supabase, filteredFinalItems as unknown as Record<string, unknown>[],
      undefined, { skipPrefetch: true }
    );

    let finalItems = filteredFinalItems.map((item, idx) => ({
      ...item,
      imageCount: (enrichedItems[idx] as Record<string, unknown>).image_count as number || item.imageCount,
      image_count_status: (enrichedItems[idx] as Record<string, unknown>).image_count_status as string | undefined,
    }));

    // Post-filters
    const hasFilters = catalogFilters.minPrice !== undefined || catalogFilters.maxPrice !== undefined ||
      catalogFilters.brand !== undefined || catalogFilters.rating !== undefined;
    if (hasFilters) {
      const before = finalItems.length;
      finalItems = postFilterItems(finalItems, catalogFilters) as typeof finalItems;
      console.log(`[SEARCH] requestId=${requestId} PostFilter: ${before} → ${finalItems.length}`);
    }

    // ─── INTENT-BASED SCORING + RANKING ───────────────────────────────────────
    // Replaces old vehicle post-filter with unified scoring that handles all intents
    const queryTokens = providerQuery.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
    const beforeScoring = finalItems.length;
    const scoreResult = scoreAndRankItems(finalItems as unknown as Record<string, unknown>[], effectiveIntent, queryTokens, limit);
    finalItems = scoreResult.items as typeof finalItems;
    console.log(`[CATALOG_SEARCH][INTENT] requestId=${requestId} q="${qOriginal}" intentKey=${effectiveIntent.intentKey} beforeScoring=${beforeScoring} afterScoring=${finalItems.length} dropped=${scoreResult.dropped} topScores=${JSON.stringify(scoreResult.topScores)}`);

    // ─── VEHICLE GUARDRAILS (post-fetch, 3-tier safe fallback) ────────────────
    // Triggered by token-aware query detection, NOT intent classification alone
    const vehicleGuardrailActive = isVehiclesTab || isVehicleLikeQueryGuardrail(providerQuery);
    if (vehicleGuardrailActive) {
      const preGuardrail = finalItems.length;
      const guardrailResult = applyVehicleGuardrails(finalItems, providerQuery, filteredFinalItems, { hardMode: isVehiclesTab });
      finalItems = guardrailResult.items as typeof finalItems;
      console.log(`[CATALOG_SEARCH][VEHICLE_GUARDRAIL] requestId=${requestId} mode=${guardrailResult.mode} hardMode=${isVehiclesTab} before=${preGuardrail} after=${finalItems.length} dropped=${guardrailResult.dropped} reason=${guardrailResult.reason}`);
    }
    // ─── UNIVERSAL WRONG-CATEGORY HARD-DROP GATE ──────────────────────────────
    // Applies to ALL intents: drop items whose titles contain shoe/clothing keywords
    // that don't belong in the current intent's results
    const UNIVERSAL_WRONG_CAT_KW = [
      "shoe","shoes","sneaker","sneakers","nike","puma","adidas","jordan",
      "hoodie","shirt","pantalon","vêtement","chaussure","baskets",
      "dress","pants","shorts","jeans","jacket","coat",
      "necklace","bracelet","earring","pendant",
      "poster","wall art","canvas","blanket","towel","pillow","rug",
      "perfume","makeup","lipstick","mascara",
    ];
    // Vehicle/tech keywords to drop from fashion searches
    const FASHION_WRONG_CAT_KW = [
      "car","truck","suv","sedan","motorcycle","tractor","excavator","forklift",
      "engine","transmission","playstation","xbox","nintendo","console",
      "gpu","cpu","laptop","iphone","samsung","refrigerator","fridge",
    ];
    // Only apply the guard for intents that should NEVER return clothing/shoes
    const GUARDED_INTENTS = ["gaming", "phone_device", "phone_accessory", "vehicle_listing", "vehicle_parts", "heavy_equipment", "appliance_fridge", "fashion"];
    if (GUARDED_INTENTS.includes(effectiveIntent.intentKey) && finalItems.length > 0) {
      const beforeGuard = finalItems.length;
      const wrongCatList = effectiveIntent.intentKey === "fashion" ? FASHION_WRONG_CAT_KW : UNIVERSAL_WRONG_CAT_KW;
      finalItems = finalItems.filter(item => {
        const t = ((item as any).title || "").toLowerCase();
        // Use word-boundary matching for short tokens to avoid false drops (e.g. "carhartt")
        return !wrongCatList.some(kw => kw.length <= 4 ? new RegExp(`\\b${kw}\\b`, 'i').test(t) : t.includes(kw));
      });
      const guardDropped = beforeGuard - finalItems.length;
      if (guardDropped > 0) {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} CATEGORY_GUARD(${effectiveIntent.intentKey}): dropped ${guardDropped} wrong-category items`);
      }
    }
    // Sort (only if explicit sort requested — scoring already ranks by relevance)
    if (sort !== "relevance") {
      finalItems = postSortItems(finalItems, sort) as typeof finalItems;
    }
    timings.postProcess = Date.now() - postProcessStart;

    // Early cache write removed — final cache write below handles everything
    // Provider stats
    const sourceServed: ("ebay" | "amazon")[] = [];
    if (ebayItems.length > 0) sourceServed.push("ebay");
    if (amazonItems.length > 0) sourceServed.push("amazon");

    const providerStats = {
      ...buildProviderStats({
        mode: effectiveMode.mode, amazonEnabled: effectiveMode.amazonActive, ebayEnabled: effectiveMode.ebayActive,
        amazonCacheHit, amazonBudgetRemaining, amazonReturned: mixResult.amazonReturned,
        amazonCap: settings.amazonMaxResultsPerQuery, amazonStatus, ebayReturned: mixResult.ebayReturned,
        mixingPhase: mixResult.mixingPhase, amazonFirstCount: settings.mixedAmazonFirstCount, blendRatio: settings.mixedBlendRatio,
      }),
      amazonLiveUsed, amazonLiveReason, sourceServed,
      sourceRequested: providerParam || "mixed",
      platformGating: { clientPlatform: clientPlatform || "all", amazonGated: !enabledProviders.amazon, ebayGated: !enabledProviders.ebay },
    };

    logMixerRequest({ mode: effectiveMode.mode, query: qNorm, amazonLiveUsed, amazonLiveReason, amazonReturned: mixResult.amazonReturned, ebayReturned: mixResult.ebayReturned, budgetRemaining: amazonBudgetRemaining, amazonCacheHit, requestId });

    const nextCursor = mixResult.nextCursor ? encodeMixerCursor(mixResult.nextCursor) : null;
    const durationMs = Date.now() - startTime;

    // ─── FIX: Robust hasMore logic ──────────────────────────────────────────
    // If a provider timed out or didn't finish, we can't know if there are more — assume yes
    const incomplete = providerTimedOut || !amazonDone || !ebayDone ||
      (amazonDone && !!amazonError) || (ebayDone && !!ebayError);
    
    // Per-provider hasMore
    const ebayProviderHasMore = ebayHasMore || !ebayDone || (ebayDone && !!ebayError);
    const amazonProviderHasMore = amazonHasMore || !amazonDone || (amazonDone && !!amazonError);
    
    // Overall hasMore: true if any provider has more OR if incomplete (timeout)
    const robustHasMore = (pageParam < (maxPages - 1)) && (
      mixResult.hasMore || ebayProviderHasMore || amazonProviderHasMore || incomplete
    );

    // Cache TTL from settings
    let cacheTtlSeconds = 3600;
    try {
      const { data: cacheSettings } = await supabase
        .from("catalog_cache_settings").select("search_expires_minutes").eq("key", "default").single();
      if (cacheSettings?.search_expires_minutes) cacheTtlSeconds = cacheSettings.search_expires_minutes * 60;
    } catch { /* default */ }

    const DEV = Deno.env.get("ENVIRONMENT") !== "production";

    // ─── FIX: Safe maxPages computation (never undefined) ─────────────────────
    const HARD_MAX_ITEMS = 500;
    const maxPages = Math.max(1, Math.ceil(HARD_MAX_ITEMS / limit));

    // Build searchDebug for meta
    const finalCount = finalItems.length;
    const searchSource = finalCount > 0 ? "providers" : (dbFallbackItems?.length ? "fallback" : "empty");
    const searchDebug: Record<string, unknown> = {
      qOriginal, qCanon: qCanonicalized, qRewrite: qRewrite || null, providerQuery,
      usedQueryForProviders: providerQuery, intentKey: effectiveIntent.intentKey,
      dbCount, ebay: ebayDebug, amazon: amazonDebug,
      finalCount, source: searchSource,
      isVehicle, isHeavyEquipment, hasBuyingIntent,
      scoring: { dropped: scoreResult.dropped, topScores: scoreResult.topScores },
    };
    // DEV-only pre-normalizer + deadline debug
    if (DEV) {
      searchDebug.preNorm = {
        qRaw: qOriginal,
        qNormalizedNoStops: preNorm.qNormalizedNoStops || null,
        effectiveQuery: preNorm.effectiveQuery,
        usedStaticMap: preNorm.matched,
        matchRule: preNorm.matchRule || null,
        inferredCategory: preNorm.inferredCategory,
        skipAI: preNorm.skipAI,
        category_key_applied: categoryKey || null,
      };
      searchDebug.deadline = {
        deadlineHit: providerTimedOut,
        elapsedMs: Date.now() - startTime,
        counts: { db: dbCount, amazon: amazonItems.length, ebay: ebayItems.length, finalUnique: finalCount },
        providersDone: { amazonDone, ebayDone },
        incomplete,
      };
    }

    // Compute explicit page from cursor for response
    const pageForResponse = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    const response: SearchResponse = {
      status: "success", env: envName, query: qOriginal, items: finalItems,
      nextCursor, hasMore: robustHasMore,
      total: Math.max(ebayTotal, amazonItems.length, finalItems.length),
      appliedFilters: buildAppliedSortFilter(sort, catalogFilters, sort !== "relevance"),
      providerStats, searchMeta,
      mediaStats: DEV ? mediaStats : undefined,
      durationMs, ttlSeconds: finalItems.length > 0 ? cacheTtlSeconds : 0, error: null,
      // Pagination fields
      page: pageForResponse,
      pageSize: limit,
      returnedCount: finalItems.length,
      totalAvailableEstimate: Math.max(ebayTotal, amazonItems.length + ebayItems.length, finalItems.length),
      providersStatus: {
        ebay: { ok: ebayDebug.ok, count: ebayDebug.count, timedOut: !ebayDone || (providerTimedOut && !ebayDebug.ok), hasMore: ebayProviderHasMore },
        amazon: { ok: amazonDebug.ok, count: amazonDebug.count, timedOut: !amazonDone || (providerTimedOut && !amazonDebug.ok), hasMore: amazonProviderHasMore },
      },
      qRefined: searchMeta.rewriteApplied ? searchMeta.rewrittenQuery : undefined,
      sourcesUsed: sourceServed,
      partial: incomplete || undefined,
      incomplete: incomplete || undefined,
      meta: { source: searchSource, isStale: false, envUsed, cacheEnvUsed: effectiveEnv, envRequested: envName, correlationId: requestId, ts: new Date().toISOString(), providerTimedOut: providerTimedOut || undefined, searchDebug } as any,
    };

    // ─── DB FALLBACK — never return empty if DB had anything ──────────────────
    if (finalItems.length === 0 && dbFallbackItems && dbFallbackItems.length > 0) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} using db_fallback items=${dbFallbackItems.length}`);
      const dbFallbackResponse: SearchResponse = {
        status: "success", env: envName, query: qOriginal,
        items: dbFallbackItems as unknown as CatalogItem[],
        nextCursor: null, hasMore: false, total: dbFallbackItems.length,
        providerStats, searchMeta, durationMs: Date.now() - startTime,
        ttlSeconds: 1800, error: null,
        meta: { source: "db_fallback", isStale: false, envUsed, cacheEnvUsed: effectiveEnv, envRequested: envName, correlationId: requestId, ts: new Date().toISOString(), searchDebug: { ...searchDebug, source: "fallback", finalCount: dbFallbackItems.length } } as any,
      };
      const fbDebugObj = { providerQuery, dbCount: dbFallbackItems.length, ebayStatus: ebayDebug.ok ? "ok" : ebayDebug.error, amazonStatus: amazonDebug.ok ? "ok" : amazonDebug.error, finalCount: dbFallbackItems.length, source: "fallback" };
      const fbHeaders = buildResponseHeaders(dbFallbackItems.length, 1800);
      fbHeaders["x-afrishop-search-debug"] = btoa(JSON.stringify(fbDebugObj)).slice(0, 200);
      fbHeaders["Access-Control-Expose-Headers"] = "x-afrishop-search-debug";
      return new Response(JSON.stringify(dbFallbackResponse), { status: 200, headers: fbHeaders });
    }

    // ─── FINAL RELATED DB FALLBACK — intent-specific only ──────────────────
    // CRITICAL: Do NOT use a generic "popular_db" fallback that returns random
    // unrelated items (shoes for phone searches). Only use intent-specific fallbacks.
    let fallbackReason: string | null = null;

    if (finalItems.length === 0) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} all_sources_empty, attempting related_db fallback`);

      // Detect broad intent categories from qNorm and qOriginal
      const qBoth = `${qNorm} ${qOriginal}`.toLowerCase();
      const TRACTOR_TERMS = ["tracteur","tractor","farm tractor","agricole","agricultural","john deere","kubota","massey","case ih","excavator","loader","backhoe"];
      const isTractorIntent = TRACTOR_TERMS.some(t => qBoth.includes(t));

      // Build related OR-based search
      let relatedItems: CatalogItem[] = [];

      if (isTractorIntent) {
        // Related heavy equipment search with OR logic
        const orTerms = ["%tractor%","%farm%","%agricultural%","%john deere%","%kubota%","%massey%","%excavator%","%loader%","%backhoe%","%skid steer%"];
        const orFilter = orTerms.map(t => `title.ilike.${t}`).join(",");
        const { data: relData } = await supabase
          .from("catalog_items")
          .select("*")
          .or(orFilter)
          .in("provider", ["rainforest", "amazon", "ebay"])
          .gt("price_usd", 0)
          .filter("image_url", "not.is", "null")
          .eq("is_disallowed", false)
          .order("updated_at", { ascending: false })
          .limit(40);
        if (relData && relData.length > 0) {
          relatedItems = relData.map((item: any) => ({
            id: item.id, provider: item.provider, providerProductId: item.provider_product_id,
            title: item.title, priceUsd: item.price_usd, currency: "USD",
            mainImageUrl: item.image_url, imageUrl: item.image_url,
            images: item.images || (item.image_url ? [item.image_url] : []),
            imageUrls: item.images || (item.image_url ? [item.image_url] : []),
            imageCount: item.images?.length || 1,
            productUrl: item.product_url, inStock: item.in_stock ?? true,
            rating: item.rating, category: item.unified_category || categoryKey || undefined,
          }));
          fallbackReason = "related_db";
          console.log(`[CATALOG_SEARCH] requestId=${requestId} related_db fallback: ${relatedItems.length} tractor/equipment items`);
        }
      }

      // ─── NO UNIVERSAL "popular_db" FALLBACK ──────────────────────────────────
      // Previously we returned random popular items here. This caused shoe contamination
      // in phone/vehicle/gaming searches. Instead, return empty with proper status.
      if (relatedItems.length === 0) {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} NO_FALLBACK: returning empty results (no popular_db contamination)`);
        fallbackReason = null;
      }

      if (relatedItems.length > 0) {
        // Apply limit slicing
        const slicedItems = relatedItems.slice(0, limit);
        const fbResponse: SearchResponse = {
          status: "success", env: envName, query: qOriginal,
          items: slicedItems,
          nextCursor: null, hasMore: relatedItems.length > limit, total: relatedItems.length,
          providerStats, searchMeta, durationMs: Date.now() - startTime,
          ttlSeconds: 300, error: null,
          meta: { source: fallbackReason as string, isStale: false, envUsed, cacheEnvUsed: effectiveEnv, envRequested: envName, correlationId: requestId, ts: new Date().toISOString(), fallbackReason } as any,
        };
        const fbHeaders = buildResponseHeaders(slicedItems.length, 300);
        const truncate2 = (s: string, n = 40) => s.length > n ? s.slice(0, n) : s;
        fbHeaders["x-afrishop-search-debug"] = `env=${envUsed};q=${truncate2(qOriginal)};q2=${truncate2(qNorm)};db=0;prov=0;source=${fallbackReason}`;
        fbHeaders["Access-Control-Expose-Headers"] = "x-afrishop-search-debug";
        console.log(`[CATALOG_SEARCH] q="${qOriginal}" q2="${qNorm}" envUsed=${envUsed} db=0 providers=0 cache=miss source=${fallbackReason} correlationId=${requestId}`);
        return new Response(JSON.stringify(fbResponse), { status: 200, headers: fbHeaders });
      }
    }

    // ─── FINAL CACHE WRITE (overwrite early cache with complete response) ────
    const cacheMeta = {
      qNorm, provider: providerParam || "mixed",
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit, sort,
      category_key: categoryKey || undefined, vehicleMode: hasBuyingIntent,
      minPriceUsed: hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0,
    };

    if (finalItems.length > 0) {
      setCache(supabase, "search", globalCacheKey, { ...response, _meta: { ...cacheMeta, cachedAt: new Date().toISOString() } }, {
        provider: "mixed", query: qNorm, category: categoryKey || undefined,
        page: cacheMeta.page, pageSize: limit, amazonDomain: "amazon.com",
      }).catch(err => console.warn(`[CATALOG_SEARCH] requestId=${requestId} Cache write failed:`, err));
    } else {
      setCache(supabase, "search", globalCacheKey, {
        ...response, _meta: { ...cacheMeta, cachedAt: new Date().toISOString(), isNegative: true }, _negativeTtlSeconds: 120,
      }, {
        provider: "mixed", query: qNorm, category: categoryKey || undefined,
        page: cacheMeta.page, pageSize: limit, amazonDomain: "amazon.com", ttlOverrideSeconds: 120,
      }).catch(() => {});
    }

    // Finalize timings
    timings.total = Date.now() - startTime;

    // Summary log with timings
    const topTitles = finalItems.slice(0, 3).map((i: any) => ((i.title || "") as string).slice(0, 60));
    console.log(`[CATALOG_SEARCH][TIMING] requestId=${requestId} q="${qOriginal}" directQuery=${directQuery} total=${timings.total}ms rewrite=${timings.rewrite}ms ai=${timings.aiRefine}ms db=${timings.dbFirst}ms providers=${timings.providers}ms alt=${timings.altQueries}ms post=${timings.postProcess}ms items=${finalItems.length}`);
    console.log(`[CATALOG_SEARCH][INTENT] q="${qOriginal}" intentKey=${effectiveIntent.intentKey} providers=${finalCount} db=${dbCount} returned=${finalItems.length} topTitles=${JSON.stringify(topTitles)}`);

    // Debug header + timing headers
    const debugObj = { providerQuery, intentKey: effectiveIntent.intentKey, dbCount, ebayStatus: ebayDebug.ok ? "ok" : ebayDebug.error, amazonStatus: amazonDebug.ok ? "ok" : amazonDebug.error, finalCount, source: searchSource, dropped: scoreResult.dropped, directQuery };
    const responseHeaders = buildResponseHeaders(finalItems.length, cacheTtlSeconds, { cacheStatus: "MISS", responseTimeMs: timings.total, timings });
    responseHeaders["x-afrishop-search-debug"] = btoa(JSON.stringify(debugObj)).slice(0, 200);
    responseHeaders["x-afrishop-search-intent"] = effectiveIntent.intentKey;
    responseHeaders["X-Cache-TTL-Remaining"] = String(cacheTtlSeconds);
    responseHeaders["X-Results-Count"] = String(finalItems.length);
    responseHeaders["X-Next-Cursor"] = nextCursor ? "present" : "absent";
    responseHeaders["X-Translate"] = translateStatus;
    responseHeaders["X-Translate-Ms"] = String(translateMs);
    if (translateProvider) responseHeaders["X-Translate-Provider"] = translateProvider;
    responseHeaders["Access-Control-Expose-Headers"] = "x-afrishop-search-debug, x-afrishop-search-intent, X-Cache-Status, X-Cache-Age, X-Cache-TTL-Remaining, X-Results-Count, X-Next-Cursor, X-Cache-Match, X-Response-Time, X-Search-T-Total, X-Search-T-Rewrite, X-Search-T-Db, X-Search-T-Upstream, X-Search-T-AltQueries, X-Search-T-PostProcess, X-Translate, X-Translate-Ms, X-Translate-Provider";
    // Structured cache log
    console.log(JSON.stringify({ event: "search_cache", canonicalQuery: qNorm, cacheStatus: "MISS", matchedQuery: null, provider: providerParam || "all", ttlRemaining: cacheTtlSeconds, resultsCount: finalItems.length, totalMs: timings.total, upstreamMs: timings.providers, requestId }));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: responseHeaders,
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_SEARCH] requestId=${requestId} error:`, errorMessage);
    return new Response(JSON.stringify(buildEmptyResponse(qOriginal, envName, searchMeta, startTime, { code: "INTERNAL_ERROR", message: "Search service error" })), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
    });
  }
});

// ─── TYPES (kept at bottom to not pollute top) ────────────────────────────────
interface AmazonStatusInfo { status: string; }
