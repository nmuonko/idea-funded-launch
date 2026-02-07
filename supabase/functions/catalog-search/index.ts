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
} from "../_shared/vehicleDetection.ts";
import { CatalogItem } from "../_shared/catalogItemMapper.ts";
import { probeEbayVehicleCategory } from "../_shared/vehicleProbe.ts";

// Extracted modules
import { expandQueryWithAi } from "../_shared/searchAiExpand.ts";
import { searchDbFirst } from "../_shared/searchDbFirst.ts";
import { validateCacheHit, filterCachedItems } from "../_shared/searchCacheGuard.ts";
import {
  buildEmptyResponse, buildResponseHeaders, corsHeaders,
  SearchResponse, SearchMeta,
} from "../_shared/searchResponseBuilder.ts";

const DEFAULT_LIMIT = 36;
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
  const categoryKey = url.searchParams.get("category_key") || url.searchParams.get("category") || null;
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);

  const sortParam = url.searchParams.get("sort") || "relevance";
  const sort = validateSort(sortParam);
  const filtersParam = url.searchParams.get("filters") || null;
  const catalogFilters = parseFilters(filtersParam);

  // ─── VEHICLE DETECTION ──────────────────────────────────────────────────────
  const qCanonicalized = canonicalizeQuery(qOriginal);
  const qNormEarly = qCanonicalized.toLowerCase().replace(/\s+/g, " ");
  const isVehicleEarly = isVehicleQuery(qNormEarly);

  if (qCanonicalized !== qOriginal) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} query_canonicalized: "${qOriginal}" → "${qCanonicalized}"`);
  }

  const VEHICLE_REASONABLE_MIN_MAX_PRICE = 5000;
  if (isVehicleEarly && catalogFilters.maxPrice !== undefined && catalogFilters.maxPrice < VEHICLE_REASONABLE_MIN_MAX_PRICE) {
    console.log(`[SEARCH] requestId=${requestId} Vehicle search: removing restrictive maxPrice=${catalogFilters.maxPrice}`);
    delete catalogFilters.maxPrice;
  }

  let hasBuyingIntent = hasVehicleBuyingIntent(qCanonicalized);
  const hasMakeModel = isVehicleMakeModelQuery(qCanonicalized);
  let vehicleProbeResult: VehicleProbeResult | null = null;

  const hasAccessoryInQuery = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw =>
    qCanonicalized.toLowerCase().includes(kw)
  );

  if (!hasBuyingIntent && !hasAccessoryInQuery && isAmbiguousQuery(qCanonicalized)) {
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

  if (hasBuyingIntent) {
    if (catalogFilters.minPrice === undefined || catalogFilters.minPrice < 1000) {
      catalogFilters.minPrice = 1000;
    }
    console.log(`[SEARCH] requestId=${requestId} Vehicle MODE ACTIVE: minPrice=${catalogFilters.minPrice}`);
  }

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

    // ─── AI EXPANSION (non-blocking) ──────────────────────────────────────────
    const aiExpandPromise = expandQueryWithAi(supabase, qNorm, qOriginal, lang, requestId);

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

    // ─── CACHE CHECK ──────────────────────────────────────────────────────────
    const cacheStart = Date.now();
    const globalCacheKey = buildCacheKey("search", {
      env: envName, query: qNorm, provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit,
      minPrice: catalogFilters.minPrice, maxPrice: catalogFilters.maxPrice,
      brand: catalogFilters.brand?.join(","), rating: catalogFilters.rating,
      condition: catalogFilters.condition, sort, vehicleMode: hasBuyingIntent,
    });

    let cacheResult = await getCache(supabase, globalCacheKey);
    let envUsed = envName;

    // Env fallback: staging → production
    if (!cacheResult.hit && envName !== "production") {
      const prodCacheKey = buildCacheKey("search", {
        env: "production", query: qNorm, provider: providerParam || "all",
        category: categoryKey || undefined,
        page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit,
        minPrice: catalogFilters.minPrice, maxPrice: catalogFilters.maxPrice,
        brand: catalogFilters.brand?.join(","), rating: catalogFilters.rating,
        condition: catalogFilters.condition, sort, vehicleMode: hasBuyingIntent,
      });
      const prodCache = await getCache(supabase, prodCacheKey);
      if (prodCache.hit) {
        cacheResult = prodCache;
        envUsed = "production";
        console.log(`[CATALOG_SEARCH] requestId=${requestId} env_fallback ${envName}->production`);
      }
    }
    perfLog.cache_ms = Date.now() - cacheStart;

    // Validate cache
    cacheResult = validateCacheHit({ cacheResult, qNorm, hasBuyingIntent, catalogFilters, requestId });

    // ─── FRESH CACHE HIT ──────────────────────────────────────────────────────
    if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
      const cachedResponse = cacheResult.data;
      const cachedItems = filterCachedItems(cachedResponse.items || [], hasBuyingIntent, catalogFilters, requestId);
      return new Response(JSON.stringify({
        ...cachedResponse, items: cachedItems, total: cachedItems.length,
        query: qOriginal, env: envName, durationMs: Date.now() - startTime,
        _cacheHit: true, _cacheAgeSec: cacheResult.cacheAgeSec,
        meta: { source: "cache", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── STALE-WHILE-REVALIDATE ───────────────────────────────────────────────
    const isStaleCache = cacheResult.hit && cacheResult.stale && !cacheResult.negativeCached;
    const staleItemCount = cacheResult.data?.items?.length ?? 0;

    if (isStaleCache && cacheResult.data && staleItemCount > 0) {
      const staleItems = filterCachedItems(cacheResult.data.items || [], hasBuyingIntent, catalogFilters, requestId);
      const staleDuration = Date.now() - startTime;

      // Fire-and-forget background refresh
      (async () => {
        try {
          const bgId = requestId + "-bg";
          const { fetchAmazonItems } = await import("../_shared/amazonFetcher.ts");
          const { fetchEbayItems } = await import("../_shared/ebayFetcher.ts");
          const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;
          const [bgAmazon, bgEbay] = await Promise.allSettled([
            fetchAmazonItems({ supabase, query: qNorm, settings, effectiveMode, mixerCursor, isVehicle: isVehicleQuery(qNorm), hasBuyingIntent, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId: bgId }),
            fetchEbayItems({ supabase, query: qNorm, effectiveMode, isVehicle: isVehicleQuery(qNorm), hasBuyingIntent, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId: bgId }),
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
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isVehicle = isVehicleQuery(qNorm);
    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    // ─── RESOLVE AI EXPANSION ─────────────────────────────────────────────────
    const aiExpandedTerms = await aiExpandPromise;
    if (aiExpandedTerms && aiExpandedTerms.length > 0 && aiExpandedTerms[0] !== qNorm) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_expand_override: "${qNorm}" → "${aiExpandedTerms[0]}"`);
      qNorm = aiExpandedTerms[0];
      searchMeta.rewrittenQuery = aiExpandedTerms[0];
      searchMeta.rewriteApplied = true;
    }

    // ─── DB-FIRST SEARCH ──────────────────────────────────────────────────────
    let dbFallbackItems: any[] | null = null;

    if (!cursor && !hasBuyingIntent) {
      try {
        const dbResult = await searchDbFirst({
          supabase, qNorm, aiExpandedTerms, limit, categoryKey, requestId,
        });

        if (dbResult.items) {
          const dbDurationMs = Date.now() - startTime;
          const dbResponse: SearchResponse = {
            status: "success", env: envName, query: qOriginal,
            items: dbResult.items as unknown as CatalogItem[],
            nextCursor: null, hasMore: dbResult.dbCount >= limit,
            total: dbResult.dbCount,
            providerStats: buildProviderStats({ mode: effectiveMode.mode, amazonEnabled: effectiveMode.amazonActive, ebayEnabled: effectiveMode.ebayActive, amazonCacheHit: false, amazonBudgetRemaining: null, amazonReturned: 0, amazonCap: 0, amazonStatus: "disabled", ebayReturned: dbResult.dbCount, mixingPhase: "db_first", amazonFirstCount: 0, blendRatio: { amazon: 0, ebay: 1 } }),
            searchMeta, durationMs: dbDurationMs, ttlSeconds: 3600, error: null,
            meta: { source: "db", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
          };

          // Cache in background
          setCache(supabase, "search", globalCacheKey, { ...dbResponse, _meta: { qNorm, provider: providerParam || "mixed", page: 1, pageSize: limit, sort, cachedAt: new Date().toISOString() } }, {
            provider: "mixed", query: qNorm, category: categoryKey || undefined, page: 1, pageSize: limit, amazonDomain: "amazon.com",
          }).catch(() => {});

          return new Response(JSON.stringify(dbResponse), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
          });
        }

        dbFallbackItems = dbResult.fallbackItems;
      } catch (dbErr) {
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} db_first_error:`, (dbErr as Error).message);
      }
    }

    // ─── LAZY IMPORT PROVIDERS ────────────────────────────────────────────────
    const { fetchAmazonItems } = await import("../_shared/amazonFetcher.ts");
    const { fetchEbayItems } = await import("../_shared/ebayFetcher.ts");

    // ─── PARALLEL PROVIDER FETCH ──────────────────────────────────────────────
    const providerStartMs = Date.now();
    const PROVIDER_TIMEOUT_MS = 4000;

    const providerPromise = Promise.allSettled([
      fetchAmazonItems({ supabase, query: qNorm, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId }),
      fetchEbayItems({ supabase, query: qNorm, effectiveMode, isVehicle, hasBuyingIntent, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId }),
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
      amazonSettled = { status: "rejected", reason: new Error("PROVIDER_TIMEOUT") };
      ebaySettled = { status: "rejected", reason: new Error("PROVIDER_TIMEOUT") };
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
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} amazon_err:`, amazonSettled.reason);
      amazonStatus = "error";
    }

    let ebayItems: CatalogItem[] = [];
    let ebayHasMore = false;
    let ebayTotal = 0;

    if (ebaySettled.status === "fulfilled") {
      const r = ebaySettled.value;
      ebayItems = r.items; ebayHasMore = r.hasMore; ebayTotal = r.total;
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} ebay_err:`, ebaySettled.reason);
    }

    console.log(`[CATALOG_SEARCH] requestId=${requestId} providers_ok`, JSON.stringify({ amazon: amazonItems.length, ebay: ebayItems.length, durationMs: providerMs }));

    // ─── MIX RESULTS ──────────────────────────────────────────────────────────
    const mixResult = mixProviderItems({
      amazonItems: amazonItems as ProviderItem[], ebayItems: ebayItems as ProviderItem[],
      limit, cursor: mixerCursor, amazonFirstCount: settings.mixedAmazonFirstCount,
      blendRatio: settings.mixedBlendRatio, amazonCap: settings.amazonMaxResultsPerQuery,
      amazonHasMore, ebayHasMore, categoryKey: categoryKey || "search", requestId,
    });

    if (!cursor) logMixerDebug(mixResult, requestId, categoryKey || "search");

    // Filter disallowed content
    const { allowed: filteredItems } = filterDisallowedItems(
      mixResult.items.map(item => ({ ...item, title: (item as CatalogItem).title, productUrl: (item as CatalogItem).productUrl, category: (item as CatalogItem).category })),
      `[SEARCH] requestId=${requestId}`
    );
    const allowedIds = new Set(filteredItems.map(i => i.id));
    const filteredFinalItems = mixResult.items.filter(item => allowedIds.has(item.id)) as CatalogItem[];

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

    // Vehicle post-filter
    if (hasBuyingIntent && finalItems.length > 0) {
      finalItems = finalItems.filter((item: any) => (item.priceUsd ?? item.price_usd ?? 0) >= 1000);
      finalItems = finalItems.filter((item: any) => {
        const title = ((item.title || "") as string).toLowerCase();
        return !VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => title.includes(kw));
      });
    }

    // Sort
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

    const response: SearchResponse = {
      status: "success", env: envName, query: qOriginal, items: finalItems,
      nextCursor, hasMore: mixResult.hasMore,
      total: Math.max(ebayTotal, amazonItems.length, finalItems.length),
      appliedFilters: buildAppliedSortFilter(sort, catalogFilters, sort !== "relevance"),
      providerStats, searchMeta,
      mediaStats: DEV ? mediaStats : undefined,
      durationMs, ttlSeconds: cacheTtlSeconds, error: null,
      meta: { source: "live", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString(), providerTimedOut: providerTimedOut || undefined },
    };

    // ─── DB FALLBACK ──────────────────────────────────────────────────────────
    if (finalItems.length === 0 && dbFallbackItems && dbFallbackItems.length > 0) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} using db_fallback items=${dbFallbackItems.length}`);
      const dbFallbackResponse: SearchResponse = {
        status: "success", env: envName, query: qOriginal,
        items: dbFallbackItems as unknown as CatalogItem[],
        nextCursor: null, hasMore: false, total: dbFallbackItems.length,
        providerStats, searchMeta, durationMs: Date.now() - startTime,
        ttlSeconds: 1800, error: null,
        meta: { source: "db_fallback", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      };
      return new Response(JSON.stringify(dbFallbackResponse), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=1800, s-maxage=1800" },
      });
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
      // Negative cache (120s)
      setCache(supabase, "search", globalCacheKey, {
        ...response, _meta: { ...cacheMeta, cachedAt: new Date().toISOString(), isNegative: true }, _negativeTtlSeconds: 120,
      }, {
        provider: "mixed", query: qNorm, category: categoryKey || undefined,
        page: cacheMeta.page, pageSize: limit, amazonDomain: "amazon.com", ttlOverrideSeconds: 120,
      }).catch(() => {});
    }

    // Safety net for empty responses
    if (finalItems.length === 0) response.ttlSeconds = 0;

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: buildResponseHeaders(finalItems.length, cacheTtlSeconds),
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_SEARCH] requestId=${requestId} error:`, errorMessage);
    return new Response(JSON.stringify(buildEmptyResponse(qOriginal, envName, searchMeta, startTime, { code: "INTERNAL_ERROR", message: "Search service error" })), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── TYPES (kept at bottom to not pollute top) ────────────────────────────────
interface AmazonStatusInfo { status: string; }
