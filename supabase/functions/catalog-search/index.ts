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

// Extracted modules
import { expandQueryWithAi } from "../_shared/searchAiExpand.ts";
import { CatalogItem } from "../_shared/catalogItemMapper.ts";
import { searchDbFirst } from "../_shared/searchDbFirst.ts";
import { validateCacheHit, filterCachedItems } from "../_shared/searchCacheGuard.ts";
import {
  buildEmptyResponse, buildResponseHeaders, corsHeaders,
  SearchResponse, SearchMeta,
} from "../_shared/searchResponseBuilder.ts";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

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
  const url = new URL(req.url);

  const rawQuery = url.searchParams.get("q") || "";
  const qOriginal = rawQuery.trim();
  const cursor = url.searchParams.get("cursor") || null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") || String(DEFAULT_LIMIT), 10)));
  const providerParam = url.searchParams.get("provider") || null;
  const rawCategoryKey = url.searchParams.get("category_key") || url.searchParams.get("category") || null;
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);

  // ─── CATEGORY RESOLUTION ────────────────────────────────────────────────────
  let categoryKey = rawCategoryKey;
  if (rawCategoryKey) {
    const catClient = createAdminPostgrestClient();
    const catRes = await resolveCategoryWithDb(catClient, rawCategoryKey, requestId);
    if (catRes.resolved) {
      categoryKey = catRes.resolved;
      if (categoryKey !== rawCategoryKey) {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} category_resolved: "${rawCategoryKey}" → "${categoryKey}" (${catRes.method})`);
      }
    } else {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} category_unresolved: "${rawCategoryKey}" — passing raw`);
    }
  }

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

  // ─── VEHICLE + INTENT DETECTION ──────────────────────────────────────────────
  const qCanonicalized = canonicalizeQuery(qOriginal);
  const qNormEarly = qCanonicalized.toLowerCase().replace(/\s+/g, " ");
  const isVehicleEarly = isVehicleQuery(qNormEarly);
  const isHeavyEquipment = isHeavyEquipmentQuery(qNormEarly);

  // Early intent classification (uses pre-rewrite query for correct detection)
  const earlyIntent = classifySearchIntent(qNormEarly);
  console.log(`[CATALOG_SEARCH] requestId=${requestId} early_intent=${earlyIntent.intentKey}`);

  if (qCanonicalized !== qOriginal) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} query_canonicalized: "${qOriginal}" → "${qCanonicalized}"`);
  }

  if (isHeavyEquipment) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} HEAVY_EQUIPMENT detected — skipping vehicle category/price restrictions`);
  }

  // NOTE: Vehicle maxPrice gating removed — true proxy mode (no intent-based price filters)

  let hasBuyingIntent = hasVehicleBuyingIntent(qCanonicalized);
  const hasMakeModel = isVehicleMakeModelQuery(qCanonicalized);
  let vehicleProbeResult: VehicleProbeResult | null = null;

  // Force buying intent for vehicle_listing detected by intent classifier
  if (earlyIntent.vehicleListingIntent && !hasBuyingIntent) {
    hasBuyingIntent = true;
    console.log(`[CATALOG_SEARCH] requestId=${requestId} FORCED hasBuyingIntent=true via vehicle_listing intent`);
  }

  const hasAccessoryInQuery = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw =>
    qCanonicalized.toLowerCase().includes(kw)
  );

  // Skip vehicle probe for heavy equipment and vehicle_listing intent (already classified)
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

  // NOTE: Vehicle minPrice gating removed — true proxy mode (no intent-based price filters)
  // hasBuyingIntent is still tracked for cache key separation and scoring

  let searchMeta: SearchMeta = {
    originalQuery: qOriginal,
    normalizedQuery: qNormEarly,
    rewrittenQuery: qNormEarly,
    rewriteApplied: false,
    ruleId: null,
    rulePriority: null,
    categoryKey,
  };

  console.log(`[CATALOG_SEARCH] requestId=${requestId} request`, JSON.stringify({ q: qOriginal, category_key: categoryKey, cursor, limit, provider: providerParam, lang, isVehicle: isVehicleEarly, hasBuyingIntent }));

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

    // ─── PARALLEL: REWRITE + SETTINGS ─────────────────────────────────────────
    const rewriteStart = Date.now();
    const [searchMetaResult, settings] = await Promise.all([
      rewriteSearchQuery(supabase, qOriginal, { lang, categoryKey, requestId }),
      getCatalogSettings(supabase),
    ]);
    searchMeta = searchMetaResult;
    perfLog.rewrite_ms = Date.now() - rewriteStart;
    let qNorm = searchMeta.rewrittenQuery;

    if (searchMeta.rewriteApplied) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} Query rewritten: "${qOriginal}" → "${qNorm}"`);
    }

    // ─── FIX #1: FAST BILINGUAL REWRITE FALLBACK ─────────────────────────────
    // If rewrite table didn't match, apply a small built-in FR→EN map
    const FR_EN_FALLBACK: Record<string, string> = {
      "tracteur": "tractor",
      "tracteurs": "tractor",
      "agricole": "farm",
      "frigo": "refrigerator",
      "refrigerateur": "refrigerator",
      "réfrigérateur": "refrigerator",
      "frigo americain": "side by side refrigerator",
      "frigo américain": "side by side refrigerator",
      "telephone": "phone",
      "téléphone": "phone",
      "voiture": "car",
      "voitures": "car",
      "camion": "truck",
      "camions": "truck",
      "machine a laver": "washing machine",
      "machine à laver": "washing machine",
      "chargeur": "charger",
      "chargeur iphone": "iphone charger",
      "chargeur type c": "usb type c charger",
      "ecouteurs": "earbuds",
      "écouteurs": "earbuds",
      "ecouteurs bluetooth": "bluetooth earbuds",
      "écouteurs bluetooth": "bluetooth earbuds",
      "coque": "phone case",
      "coque iphone": "iphone phone case",
      "coque iphone 13": "iphone 13 phone case",
      "protection ecran": "screen protector",
      "protection écran": "screen protector",
      "protection ecran iphone": "iphone screen protector",
      "protection écran iphone": "iphone screen protector",
      "ordinateur": "laptop computer",
      "ordinateur portable": "laptop",
      "imprimante": "printer",
      "aspirateur": "vacuum cleaner",
      "ventilateur": "fan",
      "climatiseur": "air conditioner",
      "televiseur": "television",
      "téléviseur": "television",
      "montre": "watch",
      "casque": "headphones",
      "casque gaming": "gaming headset",
      "clavier": "keyboard",
      "souris": "mouse",
      "tablette": "tablet",
      "enceinte": "speaker",
      "seche cheveux": "hair dryer",
      "sèche cheveux": "hair dryer",
      "fer a repasser": "iron",
      "fer à repasser": "iron",
      "micro ondes": "microwave",
      "micro onde": "microwave",
      "four": "oven",
      "cafetiere": "coffee maker",
      "cafetière": "coffee maker",
      "mixeur": "blender",
      "tondeuse": "lawn mower",
      "perceuse": "drill",
      "velo": "bicycle",
      "vélo": "bicycle",
      "trottinette": "scooter",
      "poussette": "stroller",
      "matelas": "mattress",
      "canape": "sofa",
      "canapé": "sofa",
      "bureau": "desk",
      "etagere": "shelf",
      "étagère": "shelf",
      "congelateur": "freezer",
      "congélateur": "freezer",
      "cuisiniere": "gas stove",
      "cuisinière": "gas stove",
      "cuisiniere 4 feux": "4 burner gas stove",
      "cuisinière 4 feux": "4 burner gas stove",
      "groupe electrogene": "generator",
      "groupe électrogène": "generator",
      "generateur": "generator",
      "générateur": "generator",
      "generateur 5kva": "5kva generator",
      "générateur 5kva": "5kva generator",
      "stabilisateur tension": "voltage stabilizer",
      "panneau solaire": "solar panel",
      "panneau solaire 300w": "300w solar panel",
      "kit solaire": "solar kit",
      "kit solaire maison": "home solar kit",
      "moto cg": "motorcycle",
      "moto cg 125": "125cc motorcycle",
      "moto honda": "honda motorcycle",
      "scooter 150cc": "150cc scooter",
      "pneus": "tires",
      "pneus toyota": "toyota tires",
      "batterie voiture": "car battery",
      "batterie voiture 12v": "12v car battery",
      "huile moteur": "motor oil",
      "huile moteur 5w30": "5w30 motor oil",
      "motoculteur": "garden tiller",
      "pompe a eau": "water pump",
      "pompe à eau": "water pump",
      "motopompe": "gasoline water pump",
      "motopompe essence": "gasoline water pump",
      "pulverisateur": "sprayer",
      "pulvérisateur": "agricultural sprayer",
      "semoir": "seed planter",
      "broyeur": "grinder shredder",
      "machette": "machete",
      "tronconneuse": "chainsaw",
      "tronçonneuse": "chainsaw",
      "poste a souder": "welding machine",
      "poste à souder": "welding machine",
      "scie circulaire": "circular saw",
      "routeur wifi": "wifi router",
      "manette ps5": "ps5 controller",
      "sac a main": "handbag",
      "sac à main": "handbag",
      "montre homme": "men watch",
      "parfum": "perfume",
      "perruque": "wig",
      "tissage bresilien": "brazilian hair weave",
      "tissage brésilien": "brazilian hair weave",
      "robe soiree": "evening dress",
      "robe soirée": "evening dress",
      "costume homme": "men suit",
      "couche pampers": "pampers diapers",
      "biberon": "baby bottle",
      "lait infantile": "infant formula",
      "lit bebe": "baby crib",
      "lit bébé": "baby crib",
      "moustiquaire": "mosquito net",
      "draps": "bed sheets",
      "rideaux": "curtains",
    };

    // Detect if query might be French: accented chars, lang=fr, or matches FR terms
    const qNormLower = qNorm.toLowerCase().replace(/\s+/g, " ").trim();
    const removeAccentsFn = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const qNoAccents = removeAccentsFn(qNormLower);
    const hasAccents = qNormLower !== qNoAccents;
    const isFrenchLikely = lang === "fr" || hasAccents;

    let frFallbackApplied = false;
    const originalQNormBeforeFrFallback = qNorm;

    if (!searchMeta.rewriteApplied || qNorm === qNormLower) {
      // Try exact match first, then accent-stripped match
      const directMatch = FR_EN_FALLBACK[qNormLower] || FR_EN_FALLBACK[qNoAccents];
      if (directMatch) {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} fr_fallback: "${qNorm}" → "${directMatch}"`);
        qNorm = directMatch;
        searchMeta.rewrittenQuery = directMatch;
        searchMeta.rewriteApplied = true;
        frFallbackApplied = true;
      } else if (isFrenchLikely) {
        // Try matching individual words for multi-word queries
        for (const [frTerm, enTerm] of Object.entries(FR_EN_FALLBACK)) {
          if (qNormLower.includes(frTerm) || qNoAccents.includes(removeAccentsFn(frTerm))) {
            console.log(`[CATALOG_SEARCH] requestId=${requestId} fr_fallback_partial: "${qNorm}" contains "${frTerm}" → "${enTerm}"`);
            qNorm = qNormLower.replace(frTerm, enTerm).replace(removeAccentsFn(frTerm), enTerm);
            searchMeta.rewrittenQuery = qNorm;
            searchMeta.rewriteApplied = true;
            frFallbackApplied = true;
            break;
          }
        }
      }
    }

    // ─── AI QUERY REFINER (blocking, replaces old non-blocking expansion) ────
    const aiRefinePromise = refineQueryWithAi(supabase, qNorm, qOriginal, lang, requestId);

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
    const effectiveIntent = earlyIntent.intentKey !== "general" ? earlyIntent : searchIntent;

    // ─── CACHE CHECK ──────────────────────────────────────────────────────────
    const cacheStart = Date.now();
    const globalCacheKey = buildCacheKey("search", {
      env: effectiveEnv, query: qNorm, provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit,
      minPrice: catalogFilters.minPrice, maxPrice: catalogFilters.maxPrice,
      brand: catalogFilters.brand?.join(","), rating: catalogFilters.rating,
      condition: catalogFilters.condition, sort, vehicleMode: hasBuyingIntent,
      intentKey: effectiveIntent.intentKey,
    });

    let cacheResult = await getCache(supabase, globalCacheKey);
    const envUsed = effectiveEnv;
    perfLog.cache_ms = Date.now() - cacheStart;

    // Validate cache
    cacheResult = validateCacheHit({ cacheResult, qNorm, hasBuyingIntent, catalogFilters, requestId });

    // ─── FRESH CACHE HIT ──────────────────────────────────────────────────────
    if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
      const cachedResponse = cacheResult.data;
      const cachedItems = filterCachedItems(cachedResponse.items || [], hasBuyingIntent, catalogFilters, requestId, effectiveIntent.intentKey);
      return new Response(JSON.stringify({
        ...cachedResponse, items: cachedItems, total: cachedItems.length,
        query: qOriginal, env: envName, durationMs: Date.now() - startTime,
        _cacheHit: true, _cacheAgeSec: cacheResult.cacheAgeSec,
        meta: { source: "cache", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      }), { status: 200, headers: buildResponseHeaders(cachedItems.length, 3600) });
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

      return new Response(JSON.stringify({
        ...cacheResult.data, items: staleItems, total: staleItems.length,
        query: qOriginal, env: envName, durationMs: staleDuration,
        _cacheHit: true, _cacheAgeSec: cacheResult.cacheAgeSec,
        meta: { source: "stale", isStale: true, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      }), { status: 200, headers: buildResponseHeaders(staleItems.length, 300) });
    }

    const isVehicle = isVehicleQuery(qNorm);
    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    // ─── RESOLVE AI REFINER ─────────────────────────────────────────────────
    const aiRefineResult = await aiRefinePromise;
    const aiExpandedTerms = aiRefineResult?.expandedTerms || null;
    
    // Use AI refined query as primary, with vehicle poison safety check
    const POISON_SUFFIXES = ["accessories", "parts", "floor mats", "car parts", "case", "cover", "phone", "charger", "floor mat"];
    if (aiRefineResult && aiRefineResult.refined && aiRefineResult.refined !== qNorm) {
      // Safety: if original query is vehicle-like, block poisoned refinements
      if (isVehicleLikeQueryGuardrail(qOriginal)) {
        const addedWords = aiRefineResult.refined.toLowerCase().replace(qNorm.toLowerCase(), "").trim();
        if (POISON_SUFFIXES.some(p => addedWords.includes(p))) {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_refine_BLOCKED_vehicle_poison: "${aiRefineResult.refined}" (added="${addedWords}")`);
          // Do NOT apply the poisoned refinement — keep qNorm as-is
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
    const FR_FORCE_MAP: Record<string, string> = {
      "tracteur": "tractor", "tracteurs": "tractor", "agricole": "farm equipment",
      "voiture": "car", "voitures": "cars", "camion": "truck", "camions": "trucks",
      "téléphone": "phone", "telephone": "phone", "frigo": "refrigerator",
      "réfrigérateur": "refrigerator", "refrigerateur": "refrigerator",
      "ordinateur": "laptop computer", "écouteurs": "earbuds", "ecouteurs": "earbuds",
      "chargeur": "charger", "aspirateur": "vacuum cleaner", "climatiseur": "air conditioner",
      "imprimante": "printer", "ventilateur": "fan", "casque": "headphones",
      "clavier": "keyboard", "souris": "mouse", "tablette": "tablet", "enceinte": "speaker",
      "montre": "watch", "vélo": "bicycle", "velo": "bicycle", "matelas": "mattress",
      "canapé": "sofa", "canape": "sofa", "bureau": "desk",
    };
    const pqTokens = providerQuery.toLowerCase().split(/\s+/);
    for (const token of pqTokens) {
      const stripped = token.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (FR_FORCE_MAP[token] || FR_FORCE_MAP[stripped]) {
        const enWord = FR_FORCE_MAP[token] || FR_FORCE_MAP[stripped];
        providerQuery = providerQuery.toLowerCase().replace(token, enWord);
        console.log(`[CATALOG_SEARCH] requestId=${requestId} providerQuery_force_en: "${token}" → "${enWord}" => providerQuery="${providerQuery}"`);
      }
    }
    providerQuery = providerQuery.trim().replace(/\s+/g, " ");

    console.log(`[CATALOG_SEARCH] requestId=${requestId} query_pipeline: qOriginal="${qOriginal}" qCanon="${qCanonicalized}" qRewrite="${qRewrite}" providerQuery="${providerQuery}"`);

    // ─── DB-FIRST SEARCH ──────────────────────────────────────────────────────
    let dbFallbackItems: any[] | null = null;
    let dbCount = 0;

    if (!cursor && !hasBuyingIntent) {
      try {
        const dbResult = await searchDbFirst({
          supabase, qNorm, aiExpandedTerms, limit, categoryKey, requestId,
        });
        dbCount = dbResult.dbCount;

        if (dbResult.items) {
          // ── INTENT SCORING on DB-first results (gaming, phone_device, vehicle_listing) ──
          let dbItems = dbResult.items;
          const SCORED_INTENTS = ["gaming", "phone_device", "vehicle_listing", "phone_accessory"];
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
          
          // Instead of returning early, save DB items to merge with provider results
          if (dbItems.length > 0) {
            dbFallbackItems = dbItems;
            console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_merge: ${dbItems.length} DB items will be merged with provider results`);
          }
        }

        if (!dbFallbackItems) {
          dbFallbackItems = dbResult.fallbackItems;
        }
      } catch (dbErr) {
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} db_first_error:`, (dbErr as Error).message);
      }
    }

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
    // Dynamic timeout: vehicle queries need more time on eBay Motors
    const isVehicleIntent = effectiveIntent.intentKey === "vehicle_listing" || effectiveIntent.intentKey === "vehicle_parts";
    const PROVIDER_TIMEOUT_MS = isVehicleIntent ? 8000 : 5000;

    // For vehicle_listing intent, force eBay Motors category
    const ebayParamsForIntent = { ...{ supabase, query: providerQuery, effectiveMode, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId } };

    const providerPromise = Promise.allSettled([
      skipAmazon
        ? Promise.resolve({ items: [], hasMore: false, cacheHit: false, budgetRemaining: null, status: "skipped_intent", liveUsed: false, liveReason: "disabled" as AmazonLiveReason })
        : fetchAmazonItems({ supabase, query: providerQuery, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId }),
      fetchEbayItems(ebayParamsForIntent),
    ]);

    let amazonSettled: PromiseSettledResult<any>;
    let ebaySettled: PromiseSettledResult<any>;
    let providerTimedOut = false;

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("PROVIDER_TIMEOUT")), PROVIDER_TIMEOUT_MS)
      );
      const settled = await Promise.race([providerPromise, timeoutPromise]) as [PromiseSettledResult<any>, PromiseSettledResult<any>];
      [amazonSettled, ebaySettled] = settled;
    } catch {
      providerTimedOut = true;
      console.warn(`[CATALOG_SEARCH] requestId=${requestId} PROVIDER_TIMEOUT after ${PROVIDER_TIMEOUT_MS}ms`);
      // CRITICAL FIX: Even on timeout, check if providers already settled
      // eBay may have returned in 3s but Amazon is still pending at 4s
      const partialSettled = await providerPromise; // allSettled never rejects
      amazonSettled = partialSettled[0];
      ebaySettled = partialSettled[1];
      console.log(`[CATALOG_SEARCH] requestId=${requestId} post_timeout_recovery: amazon=${amazonSettled.status} ebay=${ebaySettled.status}`);
    }

    const providerMs = Date.now() - providerStartMs;

    // Extract results
    let amazonItems: CatalogItem[] = [];
    let amazonHasMore = false;
    let amazonCacheHit = false;
    let amazonBudgetRemaining: number | null = null;
    let amazonStatus: string = "disabled";
    let amazonLiveUsed = false;
    let amazonLiveReason: AmazonLiveReason = "disabled";

    if (amazonSettled.status === "fulfilled") {
      const r = amazonSettled.value;
      amazonItems = r.items; amazonHasMore = r.hasMore; amazonCacheHit = r.cacheHit;
      amazonBudgetRemaining = r.budgetRemaining; amazonStatus = r.status;
      amazonLiveUsed = r.liveUsed; amazonLiveReason = r.liveReason;
      amazonDebug.ok = true; amazonDebug.count = r.items.length; amazonDebug.ms = providerMs;
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} amazon_err:`, amazonSettled.reason);
      amazonStatus = "error";
      amazonDebug.error = String((amazonSettled as PromiseRejectedResult).reason?.message || "unknown").slice(0, 100);
      amazonDebug.ms = providerMs;
    }

    let ebayItems: CatalogItem[] = [];
    let ebayHasMore = false;
    let ebayTotal = 0;

    if (ebaySettled.status === "fulfilled") {
      const r = ebaySettled.value;
      ebayItems = r.items; ebayHasMore = r.hasMore; ebayTotal = r.total;
      ebayDebug.ok = true; ebayDebug.count = r.items.length; ebayDebug.ms = providerMs;
      (ebayDebug as any).rawCount = r.rawCount ?? r.items.length;
      (ebayDebug as any).mappedCount = r.mappedCount ?? r.items.length;
      (ebayDebug as any).filteredCount = r.filteredCount ?? r.items.length;
      (ebayDebug as any).failOpenUsed = r.failOpenUsed ?? false;
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} ebay_err:`, ebaySettled.reason);
      ebayDebug.error = String((ebaySettled as PromiseRejectedResult).reason?.message || "unknown").slice(0, 100);
      ebayDebug.ms = providerMs;
    }

    const providerItemCount = amazonItems.length + ebayItems.length;
    console.log(`[CATALOG_SEARCH] requestId=${requestId} providers_ok providerQuery="${providerQuery}"`, JSON.stringify({ amazon: amazonItems.length, ebay: ebayItems.length, durationMs: providerMs }));

    // ─── SECONDARY ATTEMPT: alt queries from AI refiner OR canonical fallback ──
    // If providers returned < 60 items and we have alt queries, try them to fill the page
    const totalProviderItems = amazonItems.length + ebayItems.length;
    const altQueries = aiRefineResult?.alt || [];
    
    if (totalProviderItems < 60 && !providerTimedOut) {
      // Try alt queries from AI refiner first
      for (const altQ of altQueries) {
        if (amazonItems.length + ebayItems.length >= limit) break;
        if (altQ === providerQuery || altQ === qCanonicalized) continue;
        
        console.log(`[CATALOG_SEARCH] requestId=${requestId} alt_query_attempt q="${altQ}"`);
        try {
          const altTimeout = 3000;
          const altPromise = Promise.allSettled([
            skipAmazon
              ? Promise.resolve({ items: [], hasMore: false, cacheHit: false, budgetRemaining: null, status: "skipped_intent", liveUsed: false, liveReason: "disabled" as AmazonLiveReason })
              : fetchAmazonItems({ supabase, query: altQ, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId: requestId + "-alt" }),
            fetchEbayItems({ supabase, query: altQ, effectiveMode, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId: requestId + "-alt" }),
          ]);
          const altTimeoutP = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ALT_TIMEOUT")), altTimeout));
          const altSettled = await Promise.race([altPromise, altTimeoutP]) as [PromiseSettledResult<any>, PromiseSettledResult<any>];
          
          // Merge alt results (deduplicate by id)
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
      
      // Fallback: try canonical query if different from provider query
      if (amazonItems.length + ebayItems.length < 60 && providerQuery !== qCanonicalized) {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} secondary_provider_attempt q="${qCanonicalized}"`);
        try {
          const secondaryTimeout = 3000;
          const secondaryPromise = Promise.allSettled([
            skipAmazon
              ? Promise.resolve({ items: [], hasMore: false, cacheHit: false, budgetRemaining: null, status: "skipped_intent", liveUsed: false, liveReason: "disabled" as AmazonLiveReason })
              : fetchAmazonItems({ supabase, query: qCanonicalized, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId: requestId + "-2nd" }),
            fetchEbayItems({ supabase, query: qCanonicalized, effectiveMode, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId: requestId + "-2nd" }),
          ]);
          const secondaryTimeoutP = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SECONDARY_TIMEOUT")), secondaryTimeout));
          const secondarySettled = await Promise.race([secondaryPromise, secondaryTimeoutP]) as [PromiseSettledResult<any>, PromiseSettledResult<any>];
          const existingIds = new Set([...amazonItems, ...ebayItems].map(i => i.id));
          if (!skipAmazon && secondarySettled[0].status === "fulfilled") {
            const newItems = secondarySettled[0].value.items.filter((i: any) => !existingIds.has(i.id));
            amazonItems = [...amazonItems, ...newItems];
            if (secondarySettled[0].value.items.length > 0) { amazonHasMore = secondarySettled[0].value.hasMore; amazonCacheHit = secondarySettled[0].value.cacheHit; amazonStatus = secondarySettled[0].value.status; }
            amazonDebug.ok = true; amazonDebug.count = amazonItems.length;
          }
          if (secondarySettled[1].status === "fulfilled") {
            const newItems = secondarySettled[1].value.items.filter((i: any) => !existingIds.has(i.id));
            ebayItems = [...ebayItems, ...newItems];
            if (secondarySettled[1].value.items.length > 0) { ebayHasMore = secondarySettled[1].value.hasMore; ebayTotal = secondarySettled[1].value.total; }
            ebayDebug.ok = true; ebayDebug.count = ebayItems.length;
          }
          console.log(`[CATALOG_SEARCH] requestId=${requestId} secondary_results amazon=${amazonItems.length} ebay=${ebayItems.length}`);
        } catch {
          console.warn(`[CATALOG_SEARCH] requestId=${requestId} secondary_provider_timeout`);
        }
      }
    }

    // ─── FIX D: TRACTOR-SPECIFIC 3RD PROVIDER ATTEMPT ─────────────────────────
    if (amazonItems.length + ebayItems.length === 0 && !providerTimedOut) {
      const qLow = qNorm.toLowerCase();
      const isTractorIntent = qLow.includes("tractor") || qLow.includes("tracteur");
      if (isTractorIntent) {
        const tractorQuery = "farm tractor";
        console.log(`[CATALOG_SEARCH] requestId=${requestId} tractor_fallback_attempt q="${tractorQuery}"`);
        try {
          const tTimeout = 3000;
          const tPromise = Promise.allSettled([
            fetchAmazonItems({ supabase, query: tractorQuery, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, isHeavyEquipment: true, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId: requestId + "-trc" }),
            fetchEbayItems({ supabase, query: tractorQuery, effectiveMode, isVehicle, hasBuyingIntent, isHeavyEquipment: true, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId: requestId + "-trc" }),
          ]);
          const tTimeoutP = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TRACTOR_TIMEOUT")), tTimeout));
          const tSettled = await Promise.race([tPromise, tTimeoutP]) as [PromiseSettledResult<any>, PromiseSettledResult<any>];
          if (tSettled[0].status === "fulfilled") {
            const r = tSettled[0].value;
            amazonItems = r.items; amazonHasMore = r.hasMore; amazonCacheHit = r.cacheHit;
            amazonStatus = r.status; amazonLiveUsed = r.liveUsed; amazonLiveReason = r.liveReason;
          }
          if (tSettled[1].status === "fulfilled") {
            const r = tSettled[1].value;
            ebayItems = r.items; ebayHasMore = r.hasMore; ebayTotal = r.total;
          }
          console.log(`[CATALOG_SEARCH] requestId=${requestId} tractor_fallback amazon=${amazonItems.length} ebay=${ebayItems.length}`);
        } catch {
          console.warn(`[CATALOG_SEARCH] requestId=${requestId} tractor_fallback_timeout`);
        }
      }
    }

    // ─── MIX RESULTS ──────────────────────────────────────────────────────────
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

    // Enrich with media counts
    const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
      supabase, filteredFinalItems as unknown as Record<string, unknown>[]
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
    const vehicleGuardrailActive = isVehicleLikeQueryGuardrail(providerQuery);
    if (vehicleGuardrailActive) {
      const preGuardrail = finalItems.length;
      const guardrailResult = applyVehicleGuardrails(finalItems, providerQuery, filteredFinalItems);
      finalItems = guardrailResult.items as typeof finalItems;
      console.log(`[CATALOG_SEARCH][VEHICLE_GUARDRAIL] requestId=${requestId} mode=${guardrailResult.mode} before=${preGuardrail} after=${finalItems.length} dropped=${guardrailResult.dropped} reason=${guardrailResult.reason}`);
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
    // Only apply the guard for intents that should NEVER return clothing/shoes
    const GUARDED_INTENTS = ["gaming", "phone_device", "phone_accessory", "vehicle_listing", "vehicle_parts", "heavy_equipment"];
    if (GUARDED_INTENTS.includes(effectiveIntent.intentKey) && finalItems.length > 0) {
      const beforeGuard = finalItems.length;
      finalItems = finalItems.filter(item => {
        const t = ((item as any).title || "").toLowerCase();
        return !UNIVERSAL_WRONG_CAT_KW.some(kw => t.includes(kw));
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

    // Cache TTL from settings
    let cacheTtlSeconds = 3600;
    try {
      const { data: cacheSettings } = await supabase
        .from("catalog_cache_settings").select("search_expires_minutes").eq("key", "default").single();
      if (cacheSettings?.search_expires_minutes) cacheTtlSeconds = cacheSettings.search_expires_minutes * 60;
    } catch { /* default */ }

    const DEV = Deno.env.get("ENVIRONMENT") !== "production";

    // Build searchDebug for meta
    const finalCount = finalItems.length;
    const searchSource = finalCount > 0 ? "providers" : (dbFallbackItems?.length ? "fallback" : "empty");
    const searchDebug = {
      qOriginal, qCanon: qCanonicalized, qRewrite: qRewrite || null, providerQuery,
      usedQueryForProviders: providerQuery, intentKey: effectiveIntent.intentKey,
      dbCount, ebay: ebayDebug, amazon: amazonDebug,
      finalCount, source: searchSource,
      isVehicle, isHeavyEquipment, hasBuyingIntent,
      scoring: { dropped: scoreResult.dropped, topScores: scoreResult.topScores },
    };

    // Compute explicit page from cursor for response
    const pageForResponse = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    const response: SearchResponse = {
      status: "success", env: envName, query: qOriginal, items: finalItems,
      nextCursor, hasMore: mixResult.hasMore,
      total: Math.max(ebayTotal, amazonItems.length, finalItems.length),
      appliedFilters: buildAppliedSortFilter(sort, catalogFilters, sort !== "relevance"),
      providerStats, searchMeta,
      mediaStats: DEV ? mediaStats : undefined,
      durationMs, ttlSeconds: finalItems.length > 0 ? cacheTtlSeconds : 0, error: null,
      // New additive fields for true proxy mode
      page: pageForResponse,
      qRefined: searchMeta.rewriteApplied ? searchMeta.rewrittenQuery : undefined,
      sourcesUsed: sourceServed,
      partial: providerTimedOut || undefined,
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

    // ─── CACHE WRITE ──────────────────────────────────────────────────────────
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

    // Summary log with intent
    const topTitles = finalItems.slice(0, 3).map((i: any) => ((i.title || "") as string).slice(0, 60));
    console.log(`[CATALOG_SEARCH][INTENT] q="${qOriginal}" intentKey=${effectiveIntent.intentKey} providers=${finalCount} db=${dbCount} returned=${finalItems.length} topTitles=${JSON.stringify(topTitles)}`);

    // Debug header (base64 JSON for structured parsing in Network tab)
    const debugObj = { providerQuery, intentKey: effectiveIntent.intentKey, dbCount, ebayStatus: ebayDebug.ok ? "ok" : ebayDebug.error, amazonStatus: amazonDebug.ok ? "ok" : amazonDebug.error, finalCount, source: searchSource, dropped: scoreResult.dropped };
    const responseHeaders = buildResponseHeaders(finalItems.length, cacheTtlSeconds);
    responseHeaders["x-afrishop-search-debug"] = btoa(JSON.stringify(debugObj)).slice(0, 200);
    responseHeaders["x-afrishop-search-intent"] = effectiveIntent.intentKey;
    responseHeaders["Access-Control-Expose-Headers"] = "x-afrishop-search-debug, x-afrishop-search-intent";

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
