/**
 * Catalog Home Endpoint - 12-Hour Rotating Mixed Feed
 * 
 * Returns mixed Amazon+eBay sections from rotation cache.
 * Falls back to eBay-only if cache is not prewarmed.
 * 
 * Uses CANONICAL category keys from categoryRegistry
 * 
 * Returns:
 * {
 *   status: "success",
 *   env,
 *   rotationKey,
 *   sections: [...],
 *   tabs: [...],
 *   homeNeedsPrewarm: boolean,
 *   providerStats: {...},
 *   error: null
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
import { normalizeAndValidateImageUrl } from "../_shared/imageValidation.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";
import { 
  CANONICAL_TABS, 
  CANONICAL_SUBTABS,
  getCategoryMeta,
} from "../_shared/categoryRegistry.ts";
import { 
  enrichItemsWithMediaCounts, 
  getMediaCacheSettings,
} from "../_shared/mediaCache.ts";
import {
  getRotationKey,
  buildHomeSectionMixedCacheKey,
  isCacheValid,
  HomeSectionMetadata,
} from "../_shared/homeRotation.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
};

const HOME_MIN_PER_SECTION = 6;
const HOME_PAGE_SIZE = 18;
const HOME_LOAD_MORE_SIZE = 24;

// Cursor encoding/decoding for infinite scroll
interface HomeCursor {
  section: string;
  offset: number;
}

function encodeHomeCursor(cursor: HomeCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeHomeCursor(encoded: string): HomeCursor | null {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}


// Helper to get cache TTL settings
async function getCacheTtlSeconds(supabase: any): Promise<number> {
  try {
    const { data } = await supabase
      .from("catalog_cache_settings")
      .select("home_expires_minutes")
      .eq("key", "default")
      .single();
    
    if (data?.home_expires_minutes) {
      return data.home_expires_minutes * 60; // Convert to seconds
    }
  } catch (e) {
    console.warn("[HOME] Failed to fetch cache TTL settings:", e);
  }
  return 3600; // Default 1 hour
}

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  mainImageUrl: string | null;
  imageUrl: string | null;
  images: string[];
  imageUrls: string[];
  imageCount: number;
  imageMissing: boolean;
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  unifiedCategory: string | null;
  unifiedSubcategory: string | null;
}

interface SeeAllMeta {
  type: "search";
  q: string;
  category_key: string | null;
}

interface Section {
  key: string;
  title: string;
  categoryKey: string;
  parentTab: string;
  subtabKey: string | null;
  items: CatalogItem[];
  hasMore: boolean;
  nextCursor: string | null;
  cacheHit: boolean;
  amazonCount: number;
  ebayCount: number;
  see_all: SeeAllMeta;
}

interface Tab {
  key: string;
  titleEn: string;
  titleFr: string;
  icon: string | null;
  orderIndex: number;
  subtabs: Array<{
    key: string;
    titleEn: string;
    titleFr: string;
    orderIndex: number;
  }>;
}

interface HomeSectionConfig {
  key: string;
  categoryKey: string;
  parentTab: string;
  subtabKey: string | null;
  title: string;
  isVehicle: boolean;
  minPrice: number;
  seedQueries: string[];
  ebayCategory?: string;
  seeAllQuery: string;
}

// Default home sections fallback (used when DB is empty)
const HOME_SECTIONS_FALLBACK: HomeSectionConfig[] = [
  {
    key: "phones",
    categoryKey: "electronics_phones",
    parentTab: "electronics",
    subtabKey: "phones",
    title: "Phones",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["iphone 15", "samsung galaxy", "tecno camon"],
    ebayCategory: "9355",
    seeAllQuery: "iphone",
  },
  {
    key: "vehicles",
    categoryKey: "vehicles_cars_trucks",
    parentTab: "vehicles",
    subtabKey: "cars_trucks",
    title: "Vehicles",
    isVehicle: true,
    minPrice: 1500,
    // SUV-focused queries for Amazon Auto + eBay Motors
    seedQueries: ["Toyota RAV4 SUV", "Honda CR-V SUV", "BMW X5 SUV", "Mercedes GLE SUV", "Jeep Grand Cherokee", "Ford Explorer SUV"],
    ebayCategory: "6001",
    seeAllQuery: "SUV",
  },
  {
    key: "gaming",
    categoryKey: "electronics_gaming",
    parentTab: "electronics",
    subtabKey: "gaming",
    title: "Gaming",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["ps5 console", "xbox series x"],
    ebayCategory: "1249",
    seeAllQuery: "ps5",
  },
  {
    key: "clothing",
    categoryKey: "clothing_shoes_accessories",
    parentTab: "clothing_shoes_accessories",
    subtabKey: null,
    title: "Clothing & Shoes",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["men sneakers", "women sneakers"],
    ebayCategory: "63889",
    seeAllQuery: "shoes",
  },
  {
    key: "home_garden",
    categoryKey: "home_garden",
    parentTab: "home_garden",
    subtabKey: null,
    title: "Home & Garden",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["robot vacuum", "air fryer"],
    ebayCategory: "11700",
    seeAllQuery: "sofa",
  },
  {
    key: "refurbished",
    categoryKey: "refurbished",
    parentTab: "refurbished",
    subtabKey: null,
    title: "Refurbished",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["refurbished iphone", "refurbished laptop"],
    ebayCategory: "11800",
    seeAllQuery: "refurbished",
  },
  {
    key: "parts_accessories",
    categoryKey: "parts_accessories",
    parentTab: "parts_accessories",
    subtabKey: null,
    title: "Parts & Accessories",
    isVehicle: false,
    minPrice: 0,
    seedQueries: ["car parts", "phone accessories"],
    ebayCategory: "6028",
    seeAllQuery: "parts",
  },
];

/**
 * Load home sections from the database, falling back to hardcoded defaults
 */
async function loadHomeSections(supabase: any): Promise<HomeSectionConfig[]> {
  try {
    // Fetch enabled sections ordered by sort_order
    const { data: dbSections, error: sectionsError } = await supabase
      .from("home_sections")
      .select("*")
      .eq("enabled", true)
      .order("sort_order", { ascending: true });

    if (sectionsError || !dbSections || dbSections.length === 0) {
      console.log("[HOME] No DB sections found, using fallback");
      return HOME_SECTIONS_FALLBACK;
    }

    // Fetch all seed queries for these sections
    const sectionKeys = dbSections.map((s: Record<string, unknown>) => s.key);
    const { data: seedsData } = await supabase
      .from("home_section_seeds")
      .select("section_key, query, weight")
      .in("section_key", sectionKeys)
      .eq("enabled", true)
      .order("weight", { ascending: false });

    // Group seeds by section
    const seedsBySection = new Map<string, string[]>();
    for (const seed of seedsData || []) {
      const existing = seedsBySection.get(seed.section_key) || [];
      existing.push(seed.query);
      seedsBySection.set(seed.section_key, existing);
    }

    // Map DB sections to HomeSectionConfig
    const configs: HomeSectionConfig[] = dbSections.map((s: Record<string, unknown>) => {
      const key = s.key as string;
      const seeds = seedsBySection.get(key) || [];
      
      // If no seeds from DB, use fallback seeds for this section
      const fallbackConfig = HOME_SECTIONS_FALLBACK.find(f => f.key === key);
      const seedQueries = seeds.length > 0 ? seeds.slice(0, 5) : (fallbackConfig?.seedQueries || [key]);

      return {
        key,
        categoryKey: (s.default_category_key || key) as string,
        parentTab: key.includes("_") ? key.split("_")[0] : key,
        subtabKey: key.includes("_") ? key.split("_").slice(1).join("_") : null,
        title: (s.title_en || key) as string,
        isVehicle: (s.is_vehicle || false) as boolean,
        minPrice: (s.min_price || 0) as number,
        seedQueries,
        ebayCategory: (s.ebay_category || "") as string,
        seeAllQuery: (s.see_all_query || seedQueries[0] || key) as string,
      };
    });

    console.log(`[HOME] Loaded ${configs.length} sections from DB with ${seedsData?.length || 0} total seeds`);
    return configs;
  } catch (err) {
    console.error("[HOME] Error loading sections from DB:", err);
    return HOME_SECTIONS_FALLBACK;
  }
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function mapCacheItemToResponse(item: Record<string, unknown>): CatalogItem {
  const rawImageUrl = (item.mainImageUrl || item.imageUrl || item.image_url) as string | null;
  const validatedImageUrl = normalizeAndValidateImageUrl(rawImageUrl, item.productUrl as string || item.product_url as string);
  
  // Extract full images array
  const rawImages = (item.images || item.image_urls || item.imageUrls || []) as string[];
  const imagesArray = Array.isArray(rawImages) ? rawImages : [];

  return {
    id: item.id as string,
    provider: (item.provider as string) || "unknown",
    providerProductId: (item.providerProductId || item.provider_product_id || item.id) as string,
    title: (item.title as string) || null,
    priceUsd: (item.priceUsd || item.price_usd) as number | null,
    mainImageUrl: validatedImageUrl,
    imageUrl: validatedImageUrl,
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount: (item.imageCount || item.image_count || imagesArray.length || 1) as number,
    imageMissing: !validatedImageUrl,
    productUrl: (item.productUrl || item.product_url) as string | null,
    inStock: (item.inStock ?? item.in_stock ?? true) as boolean,
    rating: (item.rating as number) || null,
    unifiedCategory: (item.unifiedCategory || item.unified_category) as string | null,
    unifiedSubcategory: (item.unifiedSubcategory || item.unified_subcategory) as string | null,
  };
}

function mapEbayItemToResponse(item: NormalizedItem): CatalogItem {
  const validatedImageUrl = normalizeAndValidateImageUrl(item.image_url, item.product_url);
  const imagesArray = item.images || item.image_urls || [];

  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    mainImageUrl: validatedImageUrl,
    imageUrl: validatedImageUrl,
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount: item.image_count || imagesArray.length || 1,
    imageMissing: !validatedImageUrl,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: null,
    unifiedSubcategory: null,
  };
}

// Per-section timeout for fallback fetches (5 seconds)
const SECTION_TIMEOUT_MS = 5000;

async function fetchEbayFallback(
  supabase: any,
  config: HomeSectionConfig,
  requestId: string
): Promise<CatalogItem[]> {
  console.log(`[HOME_FALLBACK] requestId=${requestId} section=${config.key} Fetching eBay fallback`);

  const allItems: CatalogItem[] = [];
  const seenIds = new Set<string>();

  for (const query of config.seedQueries.slice(0, 2)) {
    if (allItems.length >= HOME_PAGE_SIZE) break;

    try {
      const result = await searchEbay(
        supabase,
        {
          query,
          categoryId: config.ebayCategory,
          page: 1,
          pageSize: 20,
          minPrice: config.minPrice > 0 ? config.minPrice : undefined,
          isVehicle: config.isVehicle,
          marketplaceId: "EBAY_US",
        },
        requestId
      );

      for (const ebayItem of result.items) {
        if (seenIds.has(ebayItem.id)) continue;

        if (isDisallowedItem({ title: ebayItem.title, productUrl: ebayItem.product_url }).isDisallowed) {
          continue;
        }

        if (config.isVehicle) {
          const filterResult = isAllowedMotorListing({ title: ebayItem.title, priceUsd: ebayItem.price_usd });
          if (!filterResult.isAllowed) continue;
        }

        seenIds.add(ebayItem.id);
        allItems.push(mapEbayItemToResponse(ebayItem));
      }
    } catch (err) {
      console.error(`[HOME_FALLBACK] requestId=${requestId} query="${query}" error:`, err);
    }
  }

  return allItems;
}

/**
 * Fetch a single section with timeout protection
 */
async function fetchSectionWithTimeout(
  supabase: any,
  config: HomeSectionConfig,
  cached: { response: Record<string, unknown>; expires_at: string } | undefined,
  requestId: string
): Promise<{
  items: CatalogItem[];
  cacheHit: boolean;
  amazonCount: number;
  ebayCount: number;
  timedOut: boolean;
}> {
  // Use cached mixed items if available
  if (cached && isCacheValid(cached.expires_at)) {
    const response = cached.response as { items?: unknown[]; metadata?: HomeSectionMetadata };
    const rawItems = response.items || [];
    
    // No provider filtering - Amazon Auto and eBay Motors both have real vehicles
    // Filtering for parts/accessories is done during prewarm using motorsFilter
    const items = rawItems.map(item => mapCacheItemToResponse(item as Record<string, unknown>));
    
    const amazonCount = items.filter(i => i.provider === "rainforest" || i.provider === "amazon").length;
    const ebayCount = items.filter(i => i.provider === "ebay").length;
    
    return {
      items,
      cacheHit: true,
      amazonCount,
      ebayCount,
      timedOut: false,
    };
  }

  // Fallback: fetch eBay live with timeout
  try {
    const timeoutPromise = new Promise<CatalogItem[]>((_, reject) => {
      setTimeout(() => reject(new Error("TIMEOUT")), SECTION_TIMEOUT_MS);
    });

    const fetchPromise = fetchEbayFallback(supabase, config, requestId);
    const items = await Promise.race([fetchPromise, timeoutPromise]);

    return {
      items,
      cacheHit: false,
      amazonCount: 0,
      ebayCount: items.length,
      timedOut: false,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === "TIMEOUT";
    console.error(`[HOME_SECTION] requestId=${requestId} section=${config.key} ${isTimeout ? "TIMEOUT" : "error"}:`, err);
    
    return {
      items: [],
      cacheHit: false,
      amazonCount: 0,
      ebayCount: 0,
      timedOut: isTimeout,
    };
  }
}

function buildTabs(): Tab[] {
  return CANONICAL_TABS.map((tabKey, index) => {
    const meta = getCategoryMeta(tabKey);
    const subtabs = CANONICAL_SUBTABS[tabKey] || [];
    
    return {
      key: tabKey,
      titleEn: meta?.titleEn || tabKey,
      titleFr: meta?.titleFr || tabKey,
      icon: null,
      orderIndex: index,
      subtabs: subtabs.map((subKey, subIndex) => {
        const subMeta = getCategoryMeta(subKey);
        return {
          key: subKey,
          titleEn: subMeta?.titleEn || subKey,
          titleFr: subMeta?.titleFr || subKey,
          orderIndex: subIndex,
        };
      }),
    };
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  const url = new URL(req.url);

  let envName: EnvironmentName = "production";
  try {
    envName = getEnvironmentFromRequest(req);
  } catch {
    envName = "production";
  }

  // Parse query params for infinite scroll support
  const sectionParam = url.searchParams.get("section");
  const cursorParam = url.searchParams.get("cursor");
  const isLoadMore = !!(sectionParam && cursorParam);

  console.log(`[HOME] requestId=${requestId} env=${envName} isLoadMore=${isLoadMore} section=${sectionParam || 'all'}`);

  if (!ALLOWED_ENVS.includes(envName)) {
    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        sections: [],
        tabs: [],
        error: { message: `Invalid environment: ${envName}`, code: "BAD_ENV" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({
          status: "error",
          env: envName,
          sections: [],
          tabs: [],
          error: { message: "Backend configuration error", code: "CONFIG_ERROR" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load settings and calculate rotation key
    const catalogSettings = await getCatalogSettings(supabase);
    const rotationKey = getRotationKey(catalogSettings.homeRotationIntervalMinutes);

    console.log(`[HOME] requestId=${requestId} rotationKey=${rotationKey}`);

    // Load sections from database (with fallback to hardcoded)
    const homeSections = await loadHomeSections(supabase);

    // ─── INFINITE SCROLL: LOAD MORE FOR SPECIFIC SECTION ────────────────────────
    if (isLoadMore && sectionParam && cursorParam) {
      const decoded = decodeHomeCursor(cursorParam);
      if (!decoded || decoded.section !== sectionParam) {
        return new Response(
          JSON.stringify({
            status: "error",
            env: envName,
            sections: [],
            tabs: [],
            error: { message: "Invalid cursor", code: "INVALID_CURSOR" },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sectionConfig = homeSections.find(s => s.key === sectionParam);
      if (!sectionConfig) {
        return new Response(
          JSON.stringify({
            status: "error",
            env: envName,
            sections: [],
            tabs: [],
            error: { message: `Section not found: ${sectionParam}`, code: "SECTION_NOT_FOUND" },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch more items for this section using eBay with offset
      try {
        const result = await searchEbay(
          supabase,
          {
            query: sectionConfig.seedQueries[0] || sectionConfig.key,
            categoryId: sectionConfig.ebayCategory,
            page: Math.floor(decoded.offset / HOME_LOAD_MORE_SIZE) + 1,
            pageSize: HOME_LOAD_MORE_SIZE,
            minPrice: sectionConfig.minPrice > 0 ? sectionConfig.minPrice : undefined,
            isVehicle: sectionConfig.isVehicle,
            marketplaceId: "EBAY_US",
          },
          requestId
        );

        // Filter and map items
        const items: CatalogItem[] = [];
        for (const ebayItem of result.items) {
          if (isDisallowedItem({ title: ebayItem.title, productUrl: ebayItem.product_url }).isDisallowed) {
            continue;
          }

          if (sectionConfig.isVehicle) {
            const filterResult = isAllowedMotorListing({ title: ebayItem.title, priceUsd: ebayItem.price_usd });
            if (!filterResult.isAllowed) continue;
          }

          items.push(mapEbayItemToResponse(ebayItem));
        }

        // Calculate next cursor
        const newOffset = decoded.offset + items.length;
        const hasMore = result.hasMore && items.length > 0;
        const nextCursor = hasMore ? encodeHomeCursor({ section: sectionParam, offset: newOffset }) : null;

        console.log(`[HOME_LOAD_MORE] requestId=${requestId} section=${sectionParam} offset=${decoded.offset} returned=${items.length} hasMore=${hasMore}`);

        return new Response(
          JSON.stringify({
            status: "success",
            env: envName,
            section: {
              key: sectionConfig.key,
              title: sectionConfig.title,
              items,
              hasMore,
              nextCursor,
            },
            error: null,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error(`[HOME_LOAD_MORE] requestId=${requestId} error:`, err);
        return new Response(
          JSON.stringify({
            status: "error",
            env: envName,
            section: null,
            error: { message: "Failed to load more items", code: "LOAD_MORE_ERROR" },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── NORMAL HOME PAGE LOAD (ALL SECTIONS) ───────────────────────────────────
    const tabs = buildTabs();
    const sections: Section[] = [];
    let sectionsFromCache = 0;
    let sectionsFromFallback = 0;
    let totalAmazonItems = 0;
    let totalEbayItems = 0;

    // Get media cache settings once
    const mediaCacheSettings = await getMediaCacheSettings(supabase);
    let totalMediaStats = { checked: 0, cacheHit: 0, fetched: 0, timedOut: 0 };

    // Fetch all cached sections in batch
    const cacheKeys = homeSections.map(config => buildHomeSectionMixedCacheKey(config.key, rotationKey));
    const { data: cachedSections } = await supabase
      .from("catalog_cache")
      .select("cache_key, response, expires_at")
      .in("cache_key", cacheKeys);

    const cacheMap = new Map<string, { response: Record<string, unknown>; expires_at: string }>();
    for (const entry of cachedSections || []) {
      cacheMap.set(entry.cache_key, { response: entry.response, expires_at: entry.expires_at });
    }

    // PARALLELIZED: Fetch all sections concurrently with Promise.allSettled
    const sectionPromises = homeSections.map(async (config) => {
      const cacheKey = buildHomeSectionMixedCacheKey(config.key, rotationKey);
      const cached = cacheMap.get(cacheKey);
      
      const result = await fetchSectionWithTimeout(supabase, config, cached, requestId);
      
      return {
        config,
        ...result,
      };
    });

    const sectionResults = await Promise.allSettled(sectionPromises);
    let sectionsTimedOut = 0;

    for (const settledResult of sectionResults) {
      if (settledResult.status === "rejected") {
        console.error(`[HOME] requestId=${requestId} Section promise rejected:`, settledResult.reason);
        continue;
      }

      const { config, items, cacheHit, amazonCount, ebayCount, timedOut } = settledResult.value;

      if (timedOut) {
        sectionsTimedOut++;
        console.log(`[HOME] requestId=${requestId} section=${config.key} TIMEOUT`);
      }

      if (cacheHit) {
        sectionsFromCache++;
        console.log(`[HOME] requestId=${requestId} section=${config.key} cacheHit=true items=${items.length}`);
      } else if (!timedOut) {
        sectionsFromFallback++;
        console.log(`[HOME] requestId=${requestId} section=${config.key} cacheHit=false fallbackItems=${items.length}`);
      }

      // Limit to page size
      const slicedItems = items.slice(0, HOME_PAGE_SIZE);

      // Enrich with media counts (skipPrefetch=true to avoid blocking fetches)
      const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
        supabase,
        slicedItems as unknown as Record<string, unknown>[],
        mediaCacheSettings,
        { skipPrefetch: true }
      );

      totalMediaStats.checked += mediaStats.checked;
      totalMediaStats.cacheHit += mediaStats.cacheHit;
      totalMediaStats.fetched += mediaStats.fetched;
      totalMediaStats.timedOut += mediaStats.timedOut;

      // Map enriched items
      const finalItems = slicedItems.map((item, idx) => ({
        ...item,
        imageCount: (enrichedItems[idx] as Record<string, unknown>).image_count as number || item.imageCount,
      }));

      // Count providers
      totalAmazonItems += finalItems.filter(i => i.provider === "rainforest" || i.provider === "amazon").length;
      totalEbayItems += finalItems.filter(i => i.provider === "ebay").length;

      // Calculate next cursor for infinite scroll
      const hasMoreItems = items.length >= HOME_PAGE_SIZE;
      const nextCursor = hasMoreItems 
        ? encodeHomeCursor({ section: config.key, offset: HOME_PAGE_SIZE })
        : null;

      sections.push({
        key: config.key,
        title: config.title,
        categoryKey: config.categoryKey,
        parentTab: config.parentTab,
        subtabKey: config.subtabKey,
        items: finalItems,
        hasMore: hasMoreItems,
        nextCursor,  // NEW: cursor for loading more
        cacheHit,
        amazonCount,
        ebayCount,
        see_all: {
          type: "search",
          q: config.seeAllQuery,
          category_key: config.categoryKey,
        },
      });
    }

    // Log timeout stats
    if (sectionsTimedOut > 0) {
      console.log(`[HOME] requestId=${requestId} sectionsTimedOut=${sectionsTimedOut}`);
    }

    const homeNeedsPrewarm = sectionsFromFallback > 0;
    const durationMs = Date.now() - startTime;

    console.log(`[HOME] requestId=${requestId} sections=${sections.length} fromCache=${sectionsFromCache} fromFallback=${sectionsFromFallback} duration=${durationMs}ms`);
    console.log(`[HOME_MEDIA] requestId=${requestId} checked=${totalMediaStats.checked} cacheHit=${totalMediaStats.cacheHit} fetched=${totalMediaStats.fetched}`);

    // Get cache TTL settings for response headers
    const cacheTtlSeconds = await getCacheTtlSeconds(supabase);
    console.log(`[CACHE] servedFrom=edgeFunction key=catalog-home ttlSeconds=${cacheTtlSeconds}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        rotationKey,
        sections,
        tabs,
        homeNeedsPrewarm,
        providerStats: {
          mode: catalogSettings.catalogProviderMode,
          amazonEnabled: catalogSettings.amazonEnabled,
          ebayEnabled: catalogSettings.ebayEnabled,
          sectionsFromCache,
          sectionsFromFallback,
          totalAmazonItems,
          totalEbayItems,
          amazonFirstCount: catalogSettings.mixedAmazonFirstCount,
          blendRatio: catalogSettings.mixedBlendRatio,
        },
        ttlSeconds: cacheTtlSeconds,
        error: null,
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${Math.min(cacheTtlSeconds, 3600)}, s-maxage=${cacheTtlSeconds}`,
        } 
      }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[HOME] requestId=${requestId} error:`, errorMessage);

    return new Response(
      JSON.stringify({
        status: "error",
        env: envName,
        sections: [],
        tabs: [],
        error: { message: "Internal error", code: "INTERNAL_ERROR" },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
