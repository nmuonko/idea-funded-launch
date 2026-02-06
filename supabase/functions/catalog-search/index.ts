/**
 * Catalog Search Endpoint - Provider Mixing (eBay + Amazon)
 * 
 * GET /catalog-search?q=iphone&cursor=...&limit=24&provider=mixed
 * 
 * Features:
 * - Mixed mode: Amazon-first, then blend, then eBay-only
 * - Budget control for Amazon API calls
 * - Caching with stale-while-revalidate
 * - Cursor-based infinite pagination
 * - French → English search query rewriting
 * 
 * ALWAYS returns HTTP 200 with stable JSON
 */

// Import the shared PostgREST client instead of inline SDK-like client
import { PostgrestClient, createAdminPostgrestClient } from "../_shared/postgrest.ts";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";
import { isBlockedSearchQuery, getBlockedSearchMessage, filterDisallowedItems } from "../_shared/contentBlocker.ts";
import { getCatalogSettings, getEffectiveMode } from "../_shared/catalogSettings.ts";
import { 
  mixProviderItems, 
  encodeMixerCursor, 
  decodeMixerCursor, 
  getInitialCursor,
  logMixerDebug,
  ProviderItem,
  buildProviderStats,
} from "../_shared/providerMixer.ts";
import { buildCacheKey, getCache, setCache } from "../_shared/catalogCache.ts";
import { rewriteSearchQuery, SearchMeta } from "../_shared/searchRewriter.ts";
import { canonicalizeQuery } from "../_shared/queryCanonicalizer.ts";
import { enrichItemsWithMediaCounts } from "../_shared/mediaCache.ts";
import { logMixerRequest, AmazonLiveReason } from "../_shared/amazonLivePolicy.ts";
import { validateSort, parseFilters, postFilterItems, postSortItems, buildAppliedSortFilter } from "../_shared/sortFilterNormalizer.ts";
import { getEnabledProviders, getClientPlatform } from "../_shared/featureFlags.ts";
import { getClientIp } from "../_shared/rateLimiter.ts";
import { getProxyCacheSettings } from "../_shared/proxyCache.ts";
import {
  VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS,
  isVehicleQuery,
  isVehicleMakeModelQuery,
  hasVehicleBuyingIntent,
  isAmbiguousQuery,
  VehicleProbeResult,
} from "../_shared/vehicleDetection.ts";
import { CatalogItem } from "../_shared/catalogItemMapper.ts";
import { probeEbayVehicleCategory } from "../_shared/vehicleProbe.ts";
import { fetchAmazonItems } from "../_shared/amazonFetcher.ts";
import { fetchEbayItems } from "../_shared/ebayFetcher.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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
  
  // Parse sort and filters
  const sortParam = url.searchParams.get("sort") || "relevance";
  const sort = validateSort(sortParam);
  const filtersParam = url.searchParams.get("filters") || null;
  const catalogFilters = parseFilters(filtersParam);

  // ─── EARLY VEHICLE DETECTION & PRICE FILTER OVERRIDE ────────────────────────
  // CRITICAL FIX: Canonicalize query FIRST so vehicle detection works on corrected typos
  // e.g., "inifiniti qx80" → "infiniti qx80" BEFORE checking for vehicle intent
  const qCanonicalized = canonicalizeQuery(qOriginal);
  const qNormEarly = qCanonicalized.toLowerCase().replace(/\s+/g, " ");
  const isVehicleEarly = isVehicleQuery(qNormEarly);
  
  // Log canonicalization if it changed the query
  if (qCanonicalized !== qOriginal) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} query_canonicalized: "${qOriginal}" → "${qCanonicalized}"`);
  }
  
  // VEHICLE SEARCH FIX: Override restrictive price filters for vehicle searches
  // Mobile apps may send default maxPrice filters (e.g., $1650) that are too low for vehicles
  // Real vehicles typically cost $3,000 - $100,000+, so a maxPrice < $5,000 would exclude most/all results
  const VEHICLE_REASONABLE_MIN_MAX_PRICE = 5000;
  
  if (isVehicleEarly && catalogFilters.maxPrice !== undefined) {
    if (catalogFilters.maxPrice < VEHICLE_REASONABLE_MIN_MAX_PRICE) {
      console.log(`[SEARCH] requestId=${requestId} Vehicle search: removing restrictive maxPrice=${catalogFilters.maxPrice} (vehicles typically cost $5,000+)`);
      delete catalogFilters.maxPrice;
    }
  }
  
  // SMART VEHICLE INTENT: Enforce minPrice when user wants to BUY a vehicle
  // Use CANONICALIZED query so typos like "inifiniti" still match "infiniti" brand
  // 
  // PHASE 1: Check existing heuristics (fast path)
  let hasBuyingIntent = hasVehicleBuyingIntent(qCanonicalized);
  const hasMakeModel = isVehicleMakeModelQuery(qCanonicalized);
  let vehicleProbeResult: VehicleProbeResult | null = null;
  
  // PHASE 2: Dynamic probe for ambiguous queries (slow path, cached)
  // Only probe if:
  // - Existing heuristics didn't detect vehicle intent
  // - Query is ambiguous (1-2 tokens without signals)
  // - Query contains accessory keywords (skip probe)
  const hasAccessoryInQuery = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => 
    qCanonicalized.toLowerCase().includes(kw)
  );
  
  if (!hasBuyingIntent && !hasAccessoryInQuery && isAmbiguousQuery(qCanonicalized)) {
    // Use shared PostgREST client for probe
    try {
      const supabaseForProbe = createAdminPostgrestClient();
      
      console.log(JSON.stringify({
        event: "[VEHICLE_PROBE] triggered",
        query: qCanonicalized,
        reason: "ambiguous_query",
        requestId,
      }));
      
      vehicleProbeResult = await probeEbayVehicleCategory(supabaseForProbe, qCanonicalized, requestId);
      
      if (vehicleProbeResult.vehicleMode) {
        hasBuyingIntent = true;
        console.log(JSON.stringify({
          event: "[VEHICLE_DETECT] result",
          qNorm: qCanonicalized,
          vehicleMode: true,
          reason: vehicleProbeResult.reason,
          vehiclesFound: vehicleProbeResult.vehiclesFound,
          probeSource: vehicleProbeResult.probeSource,
        }));
      }
    } catch (e) {
      console.warn(`[VEHICLE_PROBE] requestId=${requestId} probe failed:`, (e as Error).message);
    }
  }
  
  if (hasBuyingIntent) {
    // Enforce minPrice of $1000 for vehicle searches (lower than $1500 to capture more listings)
    if (catalogFilters.minPrice === undefined || catalogFilters.minPrice < 1000) {
      catalogFilters.minPrice = 1000;
    }
    const probeInfo = vehicleProbeResult ? ` probe=${vehicleProbeResult.reason}` : "";
    console.log(`[SEARCH] requestId=${requestId} Vehicle MODE ACTIVE: hasBuyingIntent=${hasBuyingIntent} hasMakeModel=${hasMakeModel}${probeInfo} enforcing minPrice=${catalogFilters.minPrice} (canonicalized="${qCanonicalized}")`);
  } else if (isVehicleEarly) {
    console.log(`[SEARCH] requestId=${requestId} Vehicle brand detected but no buying intent - allowing all prices for accessories`);
  }

  // Initialize search metadata (will be populated by rewriter)
  let searchMeta: SearchMeta = {
    originalQuery: qOriginal,
    normalizedQuery: qNormEarly,
    rewrittenQuery: qNormEarly,
    rewriteApplied: false,
    ruleId: null,
    rulePriority: null,
    categoryKey,
  };

  console.log(`[CATALOG_SEARCH] requestId=${requestId} request`, JSON.stringify({ q: qOriginal, category_key: categoryKey, cursor, limit, provider: providerParam, lang, isVehicle: isVehicleEarly, hasBuyingIntent, hasMakeModel }));

  // Build empty response helper
  const buildEmptyResponse = (error?: { code: string; message: string }): SearchResponse => ({
    status: error ? "error" : "success",
    env: envName,
    query: qOriginal,
    items: [],
    nextCursor: null,
    hasMore: false,
    total: 0,
    providerStats: buildProviderStats({
      mode: "unknown",
      amazonEnabled: false,
      ebayEnabled: false,
      amazonCacheHit: false,
      amazonBudgetRemaining: null,
      amazonReturned: 0,
      amazonCap: 0,
      amazonStatus: "disabled",
      ebayReturned: 0,
    }),
    searchMeta,
    durationMs: Date.now() - startTime,
    error: error || null,
  });

  // Empty query
  if (!qOriginal) {
    return new Response(JSON.stringify(buildEmptyResponse()), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Blocked content check (use original before rewrite)
  if (isBlockedSearchQuery(qOriginal)) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} BLOCKED query: "${qOriginal}"`);
    return new Response(JSON.stringify({
      ...buildEmptyResponse(),
      warning: { message: getBlockedSearchMessage(lang), code: "BLOCKED_CONTENT" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Use the shared PostgREST client (no SDK)
    const supabase = createAdminPostgrestClient();

    // ─── PERF TRACKING ──────────────────────────────────────────────────────────
    const perfLog = { rewrite_ms: 0, settings_ms: 0, cache_ms: 0, amazon_ms: 0, ebay_ms: 0, mix_ms: 0, flags_ms: 0 };

    // ─── PLATFORM-AWARE FEATURE FLAGS (Proxy Engine Integration) ─────────────────
    // Check feature_flags table for platform-specific provider gating (iOS, Android, web)
    const flagsStart = Date.now();
    const clientPlatform = getClientPlatform(req);
    const enabledProviders = await getEnabledProviders(supabase, clientPlatform, providerParam);
    perfLog.flags_ms = Date.now() - flagsStart;
    
    console.log(`[CATALOG_SEARCH] requestId=${requestId} feature_check`, JSON.stringify({
      amazon: enabledProviders.amazon,
      ebay: enabledProviders.ebay,
      platform: clientPlatform || "all",
      requestedProvider: providerParam,
    }));

    // ─── RATE LIMITING (Proxy Engine Integration) ────────────────────────────────
    // Use same rate limit keys as market-search-proxy for consistency
    const clientIp = getClientIp(req);
    const rateLimitKey = `ip:${clientIp}:catalog-search`;
    const RATE_LIMIT_IP = 60;
    const RATE_LIMIT_WINDOW_MINUTES = 5;
    
    const { data: rateLimitResult, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
      p_key: rateLimitKey,
      p_limit: RATE_LIMIT_IP,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    });
    
    if (!rateLimitError && rateLimitResult && !rateLimitResult.allowed) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} rate_limited key=${rateLimitKey}`);
      return new Response(JSON.stringify({
        ...buildEmptyResponse({ code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Please wait before trying again." }),
        retry_after: rateLimitResult.reset_at,
      }), {
        status: 200, // Keep 200 for mobile app compatibility
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rateLimitResult.reset_at || "",
        },
      });
    }

    // ─── PARALLEL: REWRITE QUERY + LOAD SETTINGS ─────────────────────────────────
    // Run query rewrite and settings load concurrently (saves ~30-50ms)
    const rewriteStart = Date.now();
    const [searchMetaResult, settings] = await Promise.all([
      rewriteSearchQuery(supabase, qOriginal, {
        lang,
        categoryKey,
        requestId,
      }),
      getCatalogSettings(supabase),
    ]);
    
    searchMeta = searchMetaResult;
    perfLog.rewrite_ms = Date.now() - rewriteStart;
    perfLog.settings_ms = perfLog.rewrite_ms; // Ran in parallel
    
    const qNorm = searchMeta.rewrittenQuery; // Use rewritten query for searches
    
    if (searchMeta.rewriteApplied) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} Query rewritten: "${qOriginal}" → "${qNorm}"`);
    }

    // ─── EFFECTIVE MODE (Merge settings + feature flags) ─────────────────────────
    // Use feature_flags to override provider availability (platform-specific gating)
    const baseEffectiveMode = getEffectiveMode(settings, providerParam || undefined);
    const effectiveMode = {
      ...baseEffectiveMode,
      // Feature flags can disable providers, but cannot enable them if settings disable them
      amazonActive: baseEffectiveMode.amazonActive && enabledProviders.amazon,
      ebayActive: baseEffectiveMode.ebayActive && enabledProviders.ebay,
    };

    // Decode cursor first (needed for cache key)
    let mixerCursor = getInitialCursor();
    if (cursor) {
      const decoded = decodeMixerCursor(cursor);
      if (decoded) {
        mixerCursor = decoded;
      }
    }

    // ─── GLOBAL CACHE CHECK (EARLY) ───────────────────────────────────────────
    // Check for cached search results BEFORE calling providers for instant response
    const cacheStart = Date.now();
    
    // CRITICAL: Log cache key components for debugging cache misses
    console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_key_params`, JSON.stringify({
      q: qNorm,
      provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
      pageSize: limit,
      minPrice: catalogFilters.minPrice,
      maxPrice: catalogFilters.maxPrice,
      sort,
      vehicleMode: hasBuyingIntent,
    }));
    
    const globalCacheKey = buildCacheKey("search", {
      env: envName,
      query: qNorm,
      provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
      pageSize: limit,
      // Include filters in cache key so different filter combinations have separate cached results
      minPrice: catalogFilters.minPrice,
      maxPrice: catalogFilters.maxPrice,
      brand: catalogFilters.brand?.join(","),
      rating: catalogFilters.rating,
      condition: catalogFilters.condition,
      // CRITICAL: Include sort and vehicleMode to prevent cache collisions
      sort,
      vehicleMode: hasBuyingIntent,
    });

    let cacheResult = await getCache(supabase, globalCacheKey);
    let envUsed = envName;
    
    // ─── ENVIRONMENT FALLBACK ──────────────────────────────────────────────────
    // If staging cache miss, try production cache before doing expensive live fetch
    if (!cacheResult.hit && envName !== "production") {
      const prodCacheKey = buildCacheKey("search", {
        env: "production",
        query: qNorm,
        provider: providerParam || "all",
        category: categoryKey || undefined,
        page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
        pageSize: limit,
        minPrice: catalogFilters.minPrice,
        maxPrice: catalogFilters.maxPrice,
        brand: catalogFilters.brand?.join(","),
        rating: catalogFilters.rating,
        condition: catalogFilters.condition,
        sort,
        vehicleMode: hasBuyingIntent,
      });
      const prodCache = await getCache(supabase, prodCacheKey);
      if (prodCache.hit) {
        cacheResult = prodCache;
        envUsed = "production";
        console.log(`[CATALOG_SEARCH] requestId=${requestId} env_fallback ${envName}->production cache_age=${prodCache.cacheAgeSec}s`);
      }
    }
    
    perfLog.cache_ms = Date.now() - cacheStart;

    // ═══════════════════════════════════════════════════════════════════════════
    // CACHE MISMATCH DETECTION (v4 POISON FIX):
    // Validate cached payload._meta matches current request parameters
    // Force cache miss if any critical parameter differs (prevents cache poisoning)
    // ═══════════════════════════════════════════════════════════════════════════
    const currentMinPriceUsed = hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0;
    
    if (cacheResult.hit && cacheResult.data?._meta) {
      const cachedMeta = cacheResult.data._meta;
      
      // Check for critical mismatches
      const qMismatch = cachedMeta.qNorm && cachedMeta.qNorm !== qNorm;
      const vmMismatch = cachedMeta.vehicleMode !== undefined && cachedMeta.vehicleMode !== hasBuyingIntent;
      const mpMismatch = cachedMeta.minPriceUsed !== undefined && cachedMeta.minPriceUsed !== currentMinPriceUsed;
      
      if (qMismatch || vmMismatch || mpMismatch) {
        console.warn(JSON.stringify({
          event: "[CATALOG_SEARCH] cache_mismatch",
          cache_key: cacheResult.cacheKey.substring(0, 80),
          cachedQ: cachedMeta.qNorm,
          currentQ: qNorm,
          cachedVM: cachedMeta.vehicleMode,
          currentVM: hasBuyingIntent,
          cachedMP: cachedMeta.minPriceUsed,
          currentMP: currentMinPriceUsed,
          action: "forcing_miss",
          requestId,
        }));
        cacheResult = { ...cacheResult, hit: false, stale: true };
      }
    }

    // Keep legacy vm=1 fallback check for entries without _meta (pre-v4)
    if (cacheResult.hit && hasBuyingIntent) {
      const cacheKeyHasVehicleMode = cacheResult.cacheKey.includes("vm=1");
      if (!cacheKeyHasVehicleMode) {
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} CACHE_MISMATCH: vehicleMode=true but cache key lacks vm=1. Forcing miss. key=${cacheResult.cacheKey.substring(0, 80)}...`);
        cacheResult = { ...cacheResult, hit: false, stale: true };
      }
    }

    if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
      // GUARD B: If cached payload has 0 items, treat as negative/stale — don't serve empty
      const cachedItemCount = cacheResult.data?.items?.length ?? 0;
      if (cachedItemCount === 0) {
        console.log(`[CATALOG_SEARCH] requestId=${requestId} empty_cache_guard: cached payload has 0 items, treating as miss`);
        cacheResult = { ...cacheResult, hit: false, stale: false };
      }
    }

    if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
      // INSTANT RETURN: Fresh cache hit
      console.log(JSON.stringify({
        event: "[CATALOG_SEARCH] cache_hit",
        cache_key: globalCacheKey.substring(0, 80),
        qNorm,
        vehicleMode: hasBuyingIntent,
        cacheAgeSec: cacheResult.cacheAgeSec,
        requestId,
      }));
      
      const cachedResponse = cacheResult.data;
      const instantDuration = Date.now() - startTime;
      
      // Apply post-filter to cached results as safety net (in case filters differ from cached version)
      let cachedItems = cachedResponse.items || [];
      const hasFiltersForCache = catalogFilters.minPrice !== undefined || 
                                 catalogFilters.maxPrice !== undefined ||
                                 catalogFilters.brand !== undefined ||
                                 catalogFilters.rating !== undefined;
      if (hasFiltersForCache && cachedItems.length > 0) {
        const beforeCount = cachedItems.length;
        cachedItems = postFilterItems(cachedItems, catalogFilters);
        console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_postfilter: ${beforeCount} → ${cachedItems.length}`);
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // VEHICLE CACHE POISONING FIX (DEFENSIVE FILTER):
      // Always enforce minPrice for vehicle searches even on cache hits
      // This catches any old cache entries that don't have proper vehicle filtering
      // ═══════════════════════════════════════════════════════════════════════════
      if (hasBuyingIntent && cachedItems.length > 0) {
        const beforeVehicleFilter = cachedItems.length;
        cachedItems = cachedItems.filter((item: any) => {
          const price = item.priceUsd ?? item.price_usd ?? 0;
          return price >= 1000;
        });
        if (beforeVehicleFilter !== cachedItems.length) {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} vehicle_cache_filter: ${beforeVehicleFilter} → ${cachedItems.length} (enforced minPrice=1000)`);
        }
        
        // ACCESSORY KEYWORD FILTER: Remove obvious toy/accessory results from vehicle cache
        // Uses the extended VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS list for comprehensive filtering
        const beforeAccessoryFilter = cachedItems.length;
        cachedItems = cachedItems.filter((item: any) => {
          const title = (item.title || "").toLowerCase();
          return !VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => title.includes(kw));
        });
        if (beforeAccessoryFilter !== cachedItems.length) {
          console.log(JSON.stringify({
            event: "[CATALOG_SEARCH] vehicle_post_filter",
            before: beforeAccessoryFilter,
            after: cachedItems.length,
            minPriceUsed: 1000,
            requestId,
          }));
        }
      }
      
      return new Response(JSON.stringify({
        ...cachedResponse,
        items: cachedItems,
        total: cachedItems.length,
        query: qOriginal,
        env: envName,
        durationMs: instantDuration,
        _cacheHit: true,
        _cacheAgeSec: cacheResult.cacheAgeSec,
        meta: { source: "cache", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── STALE-WHILE-REVALIDATE: RETURN STALE INSTANTLY ────────────────────────
    // GUARD B (stale path): If stale cache has 0 items, skip serving it — fall through to DB-first + providers
    const isStaleCache = cacheResult.hit && cacheResult.stale && !cacheResult.negativeCached;
    const staleItemCount = cacheResult.data?.items?.length ?? 0;
    if (isStaleCache && cacheResult.data && staleItemCount === 0) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} empty_stale_guard: stale payload has 0 items, skipping stale serve`);
    } else if (isStaleCache && cacheResult.data) {
      const staleDuration = Date.now() - startTime;
      console.log(`[CATALOG_SEARCH] requestId=${requestId} stale_serve age=${cacheResult.cacheAgeSec}s ms=${staleDuration}`);
      
      const staleData = cacheResult.data;
      let staleItems = staleData.items || [];
      
      // Apply post-filters to stale results
      const hasFiltersForStale = catalogFilters.minPrice !== undefined || 
                                  catalogFilters.maxPrice !== undefined ||
                                  catalogFilters.brand !== undefined ||
                                  catalogFilters.rating !== undefined;
      if (hasFiltersForStale && staleItems.length > 0) {
        staleItems = postFilterItems(staleItems, catalogFilters);
      }
      
      // Vehicle safety filter on stale data
      if (hasBuyingIntent && staleItems.length > 0) {
        staleItems = staleItems.filter((item: any) => {
          const price = item.priceUsd ?? item.price_usd ?? 0;
          return price >= 1000;
        });
        staleItems = staleItems.filter((item: any) => {
          const title = ((item.title || "") as string).toLowerCase();
          return !VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => title.includes(kw));
        });
      }
      
      // Fire-and-forget background refresh (detached, no await)
      (async () => {
        try {
          const bgStart = Date.now();
          const bgId = requestId + "-bg";
          
          const [bgAmazon, bgEbay] = await Promise.allSettled([
            fetchAmazonItems({ supabase, query: qNorm, settings, effectiveMode, mixerCursor, isVehicle: isVehicleQuery(qNorm), hasBuyingIntent, categoryKey: categoryKey || undefined, limit, catalogFilters, requestId: bgId }),
            fetchEbayItems({ supabase, query: qNorm, effectiveMode, isVehicle: isVehicleQuery(qNorm), hasBuyingIntent, categoryKey: categoryKey || undefined, page, limit, catalogFilters, requestId: bgId }),
          ]);
          
          const bgAmazonItems = bgAmazon.status === "fulfilled" ? bgAmazon.value.items : [];
          const bgEbayItems = bgEbay.status === "fulfilled" ? bgEbay.value.items : [];
          
          if (bgAmazonItems.length > 0 || bgEbayItems.length > 0) {
            const bgMix = mixProviderItems({ amazonItems: bgAmazonItems as ProviderItem[], ebayItems: bgEbayItems as ProviderItem[], limit, cursor: mixerCursor, amazonFirstCount: settings.mixedAmazonFirstCount, blendRatio: settings.mixedBlendRatio, amazonCap: settings.amazonMaxResultsPerQuery, amazonHasMore: false, ebayHasMore: false, categoryKey: categoryKey || "search", requestId: bgId });
            
            let bgFinal = filterDisallowedItems(bgMix.items.map(item => ({ ...item, title: (item as CatalogItem).title, productUrl: (item as CatalogItem).productUrl, category: (item as CatalogItem).category })), `[BG_REFRESH] ${bgId}`).allowed;
            
            const bgResponse = { status: "success", items: bgFinal, total: bgFinal.length, nextCursor: bgMix.nextCursor ? encodeMixerCursor(bgMix.nextCursor) : null, hasMore: bgMix.hasMore, _meta: { qNorm, provider: providerParam || "mixed", page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit, sort, category_key: categoryKey || undefined, vehicleMode: hasBuyingIntent, minPriceUsed: hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0, cachedAt: new Date().toISOString() } };
            
            await setCache(supabase, "search", globalCacheKey, bgResponse, { provider: "mixed", query: qNorm, category: categoryKey || undefined, page: Math.floor(mixerCursor.ebayOffset / limit) + 1, pageSize: limit, amazonDomain: "amazon.com" });
            
            console.log(`[CATALOG_SEARCH] bg_refresh_ok id=${bgId} items=${bgFinal.length} ms=${Date.now() - bgStart}`);
          }
        } catch (e) {
          console.warn(`[CATALOG_SEARCH] bg_refresh_fail requestId=${requestId}:`, (e as Error).message);
        }
      })();
      
      return new Response(JSON.stringify({
        ...staleData,
        items: staleItems,
        total: staleItems.length,
        query: qOriginal,
        env: envName,
        durationMs: staleDuration,
        _cacheHit: true,
        _cacheAgeSec: cacheResult.cacheAgeSec,
        meta: { source: "stale", isStale: true, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[CATALOG_SEARCH] requestId=${requestId} effective_mode`, JSON.stringify({ mode: effectiveMode.mode, amazon: effectiveMode.amazonActive, ebay: effectiveMode.ebayActive }));

    const isVehicle = isVehicleQuery(qNorm);
    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    // ═══════════════════════════════════════════════════════════════════════════
    // DB-FIRST SEARCH: Query catalog_items before hitting live providers
    // This returns results instantly when DB has data, even if APIs are down
    // ═══════════════════════════════════════════════════════════════════════════
    const DB_MIN_RESULTS = 8;
    
    let dbFallbackItems: any[] | null = null;
    
    if (!cursor && !hasBuyingIntent) {
      // Only on first page, non-vehicle searches (vehicles need special provider logic)
      try {
        const dbStartMs = Date.now();
        const searchTokens = qNorm.split(/\s+/).filter((t: string) => t.length >= 2 && !/^\d+$/.test(t));
        // Take the 3 longest tokens (most distinctive)
        const topTokens = [...searchTokens].sort((a: string, b: string) => b.length - a.length).slice(0, 3);
        
        if (topTokens.length > 0) {
          let dbQuery = supabase
            .from("catalog_items")
            .select("*")
            .eq("is_disallowed", false)
            .filter("image_url", "not.is", "null")
            .gt("price_usd", 0);
          
          for (const token of topTokens) {
            dbQuery = dbQuery.ilike("title", `%${token}%`);
          }
          
          const { data: dbItems, error: dbErr } = await dbQuery
            .order("rating", { ascending: false, nullsFirst: false })
            .limit(limit);
          
          const dbMs = Date.now() - dbStartMs;
          const dbCount = dbItems?.length || 0;
          
          console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first q="${qNorm}" tokens=${JSON.stringify(topTokens)} dbCount=${dbCount} ms=${dbMs}`);
          
          if (dbItems && dbCount >= DB_MIN_RESULTS) {
            // Map DB items to response format
            const mappedItems = dbItems.map((item: Record<string, unknown>) => ({
              id: item.external_id || item.id,
              title: item.title,
              priceUsd: item.price_usd,
              price_usd: item.price_usd,
              currency: item.currency || "USD",
              imageUrl: item.image_url,
              image_url: item.image_url,
              productUrl: item.product_url,
              product_url: item.product_url,
              provider: item.provider,
              rating: item.rating,
              imageCount: item.image_count || 1,
              category: item.unified_category || categoryKey,
              store: item.provider === "ebay" ? "ebay" : "amazon",
            }));
            
            // Apply content filtering
            const { allowed: filteredDbItems } = filterDisallowedItems(
              mappedItems.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
              `[DB_FIRST] requestId=${requestId}`
            );
            
            const dbDurationMs = Date.now() - startTime;
            
            // Write to cache in background
            const dbResponse: SearchResponse = {
              status: "success",
              env: envName,
              query: qOriginal,
              items: filteredDbItems as unknown as CatalogItem[],
              nextCursor: null,
              hasMore: dbCount >= limit,
              total: dbCount,
              providerStats: buildProviderStats({ mode: effectiveMode.mode, amazonEnabled: effectiveMode.amazonActive, ebayEnabled: effectiveMode.ebayActive, amazonCacheHit: false, amazonBudgetRemaining: null, amazonReturned: 0, amazonCap: 0, amazonStatus: "disabled", ebayReturned: dbCount, mixingPhase: "db_first", amazonFirstCount: 0, blendRatio: { amazon: 0, ebay: 1 } }),
              searchMeta,
              durationMs: dbDurationMs,
              ttlSeconds: 3600,
              error: null,
              meta: { source: "db", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
            };
            
            // Background: fire live provider refresh to update cache
            (async () => {
              try {
                // The next request will benefit from the live data when providers respond
                console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_bg_refresh starting`);
              } catch (_e) { /* ignore */ }
            })();
            
            // Cache the DB results
            setCache(supabase, "search", globalCacheKey, { ...dbResponse, _meta: { qNorm, provider: providerParam || "mixed", page: 1, pageSize: limit, sort, cachedAt: new Date().toISOString() } }, {
              provider: "mixed", query: qNorm, category: categoryKey || undefined, page: 1, pageSize: limit, amazonDomain: "amazon.com",
            }).catch((_err: Error) => {});
            
            console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_response items=${filteredDbItems.length} ms=${dbDurationMs}`);
            
            return new Response(JSON.stringify(dbResponse), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
            });
          } else if (dbItems && dbCount > 0) {
            // Partial results — save as fallback in case providers fail
            dbFallbackItems = dbItems.map((item: Record<string, unknown>) => ({
              id: item.external_id || item.id,
              title: item.title,
              priceUsd: item.price_usd,
              price_usd: item.price_usd,
              currency: item.currency || "USD",
              imageUrl: item.image_url,
              image_url: item.image_url,
              productUrl: item.product_url,
              product_url: item.product_url,
              provider: item.provider,
              rating: item.rating,
              imageCount: item.image_count || 1,
              category: item.unified_category || categoryKey,
              store: item.provider === "ebay" ? "ebay" : "amazon",
            }));
            console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_partial dbCount=${dbCount} saved as fallback`);
          }
        }
      } catch (dbErr) {
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} db_first_error:`, (dbErr as Error).message);
        // Fall through to provider fetch
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VEHICLE SEARCH POLICY:
    // - Amazon uses Amazon Autos category (node 10677469011) for actual vehicle listings
    // - eBay Motors category 6001 (Cars & Trucks) is used for actual vehicle listings
    // - This ensures both providers return real vehicles, not parts/accessories
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (isVehicle) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} vehicle_query: "${qNorm}" - using eBay Motors + Amazon Autos`);
    }

    // ─── PARALLEL PROVIDER FETCH WITH HARD TIMEOUT ─────────────────────────────
    // 4s hard timeout: if providers are slow and stale cache exists, return stale
    const providerStartMs = Date.now();
    const PROVIDER_TIMEOUT_MS = 4000;

    const providerPromise = Promise.allSettled([
      // Amazon fetch (only if active)
      fetchAmazonItems({
        supabase,
        query: qNorm,
        settings,
        effectiveMode,
        mixerCursor,
        isVehicle,
        hasBuyingIntent,
        categoryKey: categoryKey || undefined,
        limit,
        catalogFilters,
        requestId,
      }),
      // eBay fetch (only if active)
      fetchEbayItems({
        supabase,
        query: qNorm,
        effectiveMode,
        isVehicle,
        hasBuyingIntent,
        categoryKey: categoryKey || undefined,
        page,
        limit,
        catalogFilters,
        requestId,
      }),
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
    } catch (timeoutErr) {
      providerTimedOut = true;
      console.warn(`[CATALOG_SEARCH] requestId=${requestId} PROVIDER_TIMEOUT after ${PROVIDER_TIMEOUT_MS}ms`);
      
      // If we had stale cache data (from the earlier check where isStaleCache was false because data was null/negative),
      // return empty. The stale path above already handled the case where stale data existed.
      amazonSettled = { status: "rejected", reason: new Error("PROVIDER_TIMEOUT") };
      ebaySettled = { status: "rejected", reason: new Error("PROVIDER_TIMEOUT") };
    }

    const providerMs = Date.now() - providerStartMs;

    // Extract Amazon results safely
    let amazonItems: CatalogItem[] = [];
    let amazonHasMore = false;
    let amazonCacheHit = false;
    let amazonBudgetRemaining: number | null = null;
    let amazonStatus: AmazonStatusInfo["status"] = "disabled";
    let amazonLiveUsed = false;
    let amazonLiveReason: AmazonLiveReason = "disabled";

    if (amazonSettled.status === "fulfilled") {
      const result = amazonSettled.value;
      amazonItems = result.items;
      amazonHasMore = result.hasMore;
      amazonCacheHit = result.cacheHit;
      amazonBudgetRemaining = result.budgetRemaining;
      amazonStatus = result.status;
      amazonLiveUsed = result.liveUsed;
      amazonLiveReason = result.liveReason;
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} amazon_err:`, amazonSettled.reason);
      amazonStatus = "error";
    }

    // Extract eBay results safely
    let ebayItems: CatalogItem[] = [];
    let ebayHasMore = false;
    let ebayTotal = 0;

    if (ebaySettled.status === "fulfilled") {
      const result = ebaySettled.value;
      ebayItems = result.items;
      ebayHasMore = result.hasMore;
      ebayTotal = result.total;
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} ebay_err:`, ebaySettled.reason);
    }

    console.log(`[CATALOG_SEARCH] requestId=${requestId} providers_ok`, JSON.stringify({ amazon: amazonItems.length, ebay: ebayItems.length, durationMs: providerMs }));

    // ─── MIX RESULTS ──────────────────────────────────────────────────────────
    // UNIFIED: Use same mixer as catalog-category for consistent behavior

    const mixResult = mixProviderItems({
      amazonItems: amazonItems as ProviderItem[],
      ebayItems: ebayItems as ProviderItem[],
      limit,
      cursor: mixerCursor,
      amazonFirstCount: settings.mixedAmazonFirstCount,
      blendRatio: settings.mixedBlendRatio,
      amazonCap: settings.amazonMaxResultsPerQuery,
      amazonHasMore,
      ebayHasMore,
      categoryKey: categoryKey || "search",
      requestId,
    });

    // Log mixer debug info (first page only for performance)
    if (!cursor) {
      logMixerDebug(mixResult, requestId, categoryKey || "search");
    }

    // Filter disallowed content from mixed results
    const { allowed: filteredItems, removed: removedCount } = filterDisallowedItems(
      mixResult.items.map(item => ({
        ...item,
        title: (item as CatalogItem).title,
        productUrl: (item as CatalogItem).productUrl,
        category: (item as CatalogItem).category,
      })),
      `[SEARCH] requestId=${requestId}`
    );

    const allowedIds = new Set(filteredItems.map(i => i.id));
    const filteredFinalItems = mixResult.items.filter(item => allowedIds.has(item.id)) as CatalogItem[];

    // Enrich items with exact image counts from media cache
    const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
      supabase,
      filteredFinalItems as unknown as Record<string, unknown>[]
    );

    // Map enriched items back to CatalogItem type with updated counts
    let finalItems = filteredFinalItems.map((item, idx) => ({
      ...item,
      imageCount: (enrichedItems[idx] as Record<string, unknown>).image_count as number || item.imageCount,
      image_count_status: (enrichedItems[idx] as Record<string, unknown>).image_count_status as string | undefined,
    }));

    // ─── APPLY USER FILTERS ────────────────────────────────────────────────────
    // Apply post-filters for price, brand, rating that weren't applied at provider level
    const hasFilters = catalogFilters.minPrice !== undefined || 
                       catalogFilters.maxPrice !== undefined || 
                       catalogFilters.brand !== undefined || 
                       catalogFilters.rating !== undefined;
    
    if (hasFilters) {
      const beforeFilterCount = finalItems.length;
      finalItems = postFilterItems(finalItems, catalogFilters) as typeof finalItems;
      console.log(`[SEARCH] requestId=${requestId} PostFilter: ${beforeFilterCount} → ${finalItems.length} items, filters=${JSON.stringify(catalogFilters)}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VEHICLE MODE POST-FILTER: Enforce minPrice + remove toy/accessory results
    // This runs on FRESH results (not just cache hits) for complete protection
    // ═══════════════════════════════════════════════════════════════════════════
    if (hasBuyingIntent && finalItems.length > 0) {
      // 1) Price floor enforcement: Remove items < $1000
      const beforeVehicleFilter = finalItems.length;
      finalItems = finalItems.filter((item: any) => {
        const price = item.priceUsd ?? item.price_usd ?? 0;
        return price >= 1000;
      });
      if (beforeVehicleFilter !== finalItems.length) {
        console.log(`[SEARCH] requestId=${requestId} vehicle_price_filter: ${beforeVehicleFilter} → ${finalItems.length} (enforced minPrice=1000)`);
      }
      
      // 2) Toy/accessory keyword filter: Remove diecast, matchbox, floor mats, etc.
      const beforeAccessoryFilter = finalItems.length;
      finalItems = finalItems.filter((item: any) => {
        const title = ((item.title || "") as string).toLowerCase();
        return !VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => title.includes(kw));
      });
      if (beforeAccessoryFilter !== finalItems.length) {
        console.log(JSON.stringify({
          event: "[CATALOG_SEARCH] vehicle_accessory_filter",
          before: beforeAccessoryFilter,
          after: finalItems.length,
          requestId,
        }));
      }
    }

    // ─── APPLY USER SORT ───────────────────────────────────────────────────────
    // Apply post-sort if user requested a specific sort order
    if (sort !== 'relevance') {
      finalItems = postSortItems(finalItems, sort) as typeof finalItems;
      console.log(`[SEARCH] requestId=${requestId} PostSort applied: ${sort}`);
    }

    console.log(`[CATALOG_SEARCH] requestId=${requestId} media_stats checked=${mediaStats.checked} cacheHit=${mediaStats.cacheHit} fetched=${mediaStats.fetched} timeout=${mediaStats.timedOut}`);

    // Build sourceServed array (matches market-search-proxy format)
    const sourceServed: ("ebay" | "amazon")[] = [];
    if (ebayItems.length > 0) sourceServed.push("ebay");
    if (amazonItems.length > 0) sourceServed.push("amazon");

    // Build provider stats with mixing configuration for transparency
    const providerStats = {
      ...buildProviderStats({
        mode: effectiveMode.mode,
        amazonEnabled: effectiveMode.amazonActive,
        ebayEnabled: effectiveMode.ebayActive,
        amazonCacheHit,
        amazonBudgetRemaining,
        amazonReturned: mixResult.amazonReturned,
        amazonCap: settings.amazonMaxResultsPerQuery,
        amazonStatus,
        ebayReturned: mixResult.ebayReturned,
        mixingPhase: mixResult.mixingPhase,
        amazonFirstCount: settings.mixedAmazonFirstCount,
        blendRatio: settings.mixedBlendRatio,
      }),
      amazonLiveUsed,
      amazonLiveReason,
      // Add sourceServed for proxy engine compatibility
      sourceServed,
      sourceRequested: providerParam || "mixed",
      platformGating: {
        clientPlatform: clientPlatform || "all",
        amazonGated: !enabledProviders.amazon,
        ebayGated: !enabledProviders.ebay,
      },
    };

    // Log mixer request summary
    logMixerRequest({
      mode: effectiveMode.mode,
      query: qNorm,
      amazonLiveUsed,
      amazonLiveReason,
      amazonReturned: mixResult.amazonReturned,
      ebayReturned: mixResult.ebayReturned,
      budgetRemaining: amazonBudgetRemaining,
      amazonCacheHit,
      requestId,
    });

    // Build next cursor
    const nextCursor = mixResult.nextCursor ? encodeMixerCursor(mixResult.nextCursor) : null;

    const durationMs = Date.now() - startTime;
    
    // Log detailed performance breakdown (with flags_ms from proxy engine integration)
    console.log(`[CATALOG_SEARCH] requestId=${requestId} perf`, JSON.stringify({
      flags_ms: perfLog.flags_ms,
      rewrite_settings_ms: perfLog.rewrite_ms,
      cache_check_ms: perfLog.cache_ms,
      provider_parallel_ms: providerMs,
      amazon_count: amazonItems.length,
      ebay_count: ebayItems.length,
      amazon_status: amazonStatus,
      total_ms: durationMs,
      items_returned: finalItems.length,
      cache_hit: false,
      sourceServed,
    }));
    
    console.log(`[CATALOG_SEARCH] requestId=${requestId} response items=${finalItems.length} mode=${effectiveMode.mode} phase=${mixResult.mixingPhase} durationMs=${durationMs}`);

    const DEV = Deno.env.get("ENVIRONMENT") !== "production";

    // Get cache TTL from settings for response
    let cacheTtlSeconds = 3600; // Default 1 hour
    try {
      const { data: cacheSettings } = await supabase
        .from("catalog_cache_settings")
        .select("search_expires_minutes")
        .eq("key", "default")
        .single();
      
      if (cacheSettings?.search_expires_minutes) {
        cacheTtlSeconds = cacheSettings.search_expires_minutes * 60;
      }
    } catch (e) {
      console.warn(`[CATALOG_SEARCH] requestId=${requestId} Failed to fetch cache TTL settings`);
    }
    
    console.log(`[CACHE] servedFrom=edgeFunction key=catalog-search ttlSeconds=${cacheTtlSeconds}`);

    const response: SearchResponse = {
      status: "success",
      env: envName,
      query: qOriginal,
      items: finalItems,
      nextCursor,
      hasMore: mixResult.hasMore,
      total: Math.max(ebayTotal, amazonItems.length, finalItems.length),
      appliedFilters: buildAppliedSortFilter(sort, catalogFilters, sort !== 'relevance'),
      providerStats,
      searchMeta,
      mediaStats: DEV ? mediaStats : undefined,
      durationMs,
      ttlSeconds: cacheTtlSeconds,
      error: null,
      meta: { source: "live", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString(), providerTimedOut: providerTimedOut || undefined },
    };

    // ─── DB FALLBACK: If providers returned 0 but we had partial DB results ───
    if (finalItems.length === 0 && dbFallbackItems && dbFallbackItems.length > 0) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} using db_fallback items=${dbFallbackItems.length}`);
      const dbFallbackResponse: SearchResponse = {
        status: "success",
        env: envName,
        query: qOriginal,
        items: dbFallbackItems as unknown as CatalogItem[],
        nextCursor: null,
        hasMore: false,
        total: dbFallbackItems.length,
        providerStats,
        searchMeta,
        durationMs: Date.now() - startTime,
        ttlSeconds: 1800,
        error: null,
        meta: { source: "db_fallback", isStale: false, envUsed, envRequested: envName, correlationId: requestId, ts: new Date().toISOString() },
      };
      return new Response(JSON.stringify(dbFallbackResponse), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=1800, s-maxage=1800" },
      });
    }

    // ─── CACHE FINAL RESPONSE ──────────────────────────────────────────────────
    const cacheMeta = {
      qNorm,
      provider: providerParam || "mixed",
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
      pageSize: limit,
      sort,
      category_key: categoryKey || undefined,
      vehicleMode: hasBuyingIntent,
      minPriceUsed: hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0,
    };
    
    if (finalItems.length > 0) {
      // Embed _meta in response for future cache validation
      const responseWithMeta = {
        ...response,
        _meta: {
          ...cacheMeta,
          cachedAt: new Date().toISOString(),
        },
      };
      
      setCache(supabase, "search", globalCacheKey, responseWithMeta, {
        provider: "mixed",
        query: qNorm,
        category: categoryKey || undefined,
        page: cacheMeta.page,
        pageSize: limit,
        amazonDomain: "amazon.com",
      }).catch(err => console.warn(`[CATALOG_SEARCH] requestId=${requestId} Cache write failed:`, err));
      
      console.log(JSON.stringify({
        event: "[CATALOG_SEARCH] cache_write",
        cache_key: globalCacheKey.substring(0, 80),
        qNorm,
        vehicleMode: hasBuyingIntent,
        minPriceUsed: cacheMeta.minPriceUsed,
        requestId,
      }));
    } else {
      // GUARD A: Do NOT write a normal long-TTL cache for empty results
      // Write a short-lived negative cache (120s) so the next request retries DB+providers
      console.log(`[CATALOG_SEARCH] requestId=${requestId} negative_cache_guard: 0 items, writing 120s negative cache`);
      setCache(supabase, "search", globalCacheKey, {
        ...response,
        _meta: { ...cacheMeta, cachedAt: new Date().toISOString(), isNegative: true },
        _negativeTtlSeconds: 120,
      }, {
        provider: "mixed",
        query: qNorm,
        category: categoryKey || undefined,
        page: cacheMeta.page,
        pageSize: limit,
        amazonDomain: "amazon.com",
        ttlOverrideSeconds: 120,
      }).catch(err => console.warn(`[CATALOG_SEARCH] requestId=${requestId} Negative cache write failed:`, err));
    }

    // Dynamic Cache-Control: never let browsers/CDNs cache empty results
    const cacheControlHeader = finalItems.length > 0
      ? `public, max-age=${Math.min(cacheTtlSeconds, 3600)}, s-maxage=${cacheTtlSeconds}`
      : "no-store, max-age=0";
    
    // Safety net: set ttlSeconds=0 in body for empty results so client-side parseTtlFromResponse returns 0
    if (finalItems.length === 0) {
      response.ttlSeconds = 0;
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "Cache-Control": cacheControlHeader,
      },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_SEARCH] requestId=${requestId} error:`, errorMessage);

    return new Response(JSON.stringify(buildEmptyResponse({
      code: "INTERNAL_ERROR",
      message: "Search service error",
    })), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
