/**
 * Feed Engine - Unified feed generation for homepage and category browsing
 * 
 * Provides two main functions:
 * 1. buildMixedFeed - Electronics-heavy mixed feed for homepage
 * 2. buildFilteredFeed - Category-specific filtered feed
 * 
 * SDK-free implementation using PostgREST client for database operations.
 */

import { PostgrestClient, createAdminPostgrestClient } from "./postgrest.ts";
import { fetchEbayItems } from "./ebayFetcher.ts";
import { fetchAmazonItems } from "./amazonFetcher.ts";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface NormalizedCatalogItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  image_url: string | null;
  images: string[];
  product_url: string;
  in_stock: boolean;
  rating?: number | null;
  brand?: string | null;
  condition?: string;
}

export interface FeedOptions {
  limit: number;
  provider: "mixed" | "amazon" | "ebay";
  env?: string;
  amazon_domain?: string;
  seedVariant?: string;
  correlationId?: string;
}

export interface FilteredFeedOptions {
  limit: number;
  provider: "mixed" | "amazon" | "ebay";
  filterKey: string;
  q?: string;
  sort?: "relevance" | "price_asc" | "price_desc" | "newest" | "rating";
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    brand?: string[];
    condition?: "new" | "used" | "refurbished" | "any";
    rating?: number;
    freeShipping?: boolean;
  };
  correlationId?: string;
}

export interface FilterProfile {
  key: string;
  include_keywords: string[];
  exclude_hard: string[];
  exclude_soft: string[];
  mode: "general" | "vehicle";
  min_price_usd: number | null;
}

// ─── SEED QUERIES (Electronics-heavy, Congo-attractive) ─────────────────────

const MIXED_FEED_SEEDS: Record<string, string> = {
  phones1: "iphone unlocked",
  phones2: "samsung galaxy unlocked",
  gaming1: "ps5 console",
  gaming2: "nintendo switch console",
  fashion1: "nike jordan sneakers",
  electronics1: "airpods pro",
  cars_parts1: "car stereo apple carplay",
  cars_parts2: "dash cam",
};

// Light exclusion keywords per seed type (avoid empty results)
const SEED_EXCLUDES: Record<string, string[]> = {
  phones1: ["case", "cover", "screen protector", "tempered", "digitizer", "lcd", "housing", "repair", "parts"],
  phones2: ["case", "cover", "screen protector", "tempered", "digitizer", "lcd", "housing", "repair", "parts"],
  gaming1: ["repair", "tool", "parts", "kit", "shell", "housing"],
  gaming2: ["repair", "tool", "parts", "kit", "shell", "housing"],
  fashion1: ["laces", "cleaner", "protector"],
  electronics1: ["case", "cover", "replacement"],
  cars_parts1: [],
  cars_parts2: [],
};

// ─── FILTER KEY NORMALIZATION ─────────────────────────────────────────────────

const FILTER_KEY_ALIASES: Record<string, string> = {
  "all": "all",
  "electronics_trending": "electronics",
  "phones_trending": "phones",
  "vehicles_trending": "vehicles",
  "trending_electronics": "electronics",
  "ebay_trending_all": "electronics",
  "vehicles_all": "vehicles",
  "vehicles_cars_trucks": "vehicles",
  "vehicles_motorcycles": "vehicles_motorcycles",
  "clothing": "clothing_shoes_accessories",
  "clothing_shoes": "clothing_shoes_accessories",
};

export function normalizeFilterKey(input: string): string {
  const lower = input.toLowerCase().trim();
  return FILTER_KEY_ALIASES[lower] || lower;
}

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

function generateCorrelationId(): string {
  return `fe_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function stableShuffleWithSeed(items: NormalizedCatalogItem[], seed: string): NormalizedCatalogItem[] {
  // Simple hash-based shuffle for deterministic results per request
  const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const shuffled = [...items];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (hash + i) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

function dedupeItems(items: NormalizedCatalogItem[]): NormalizedCatalogItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.provider}:${item.provider_product_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyLightFilter(items: NormalizedCatalogItem[], excludeKeywords: string[]): NormalizedCatalogItem[] {
  if (!excludeKeywords.length) return items;
  
  return items.filter(item => {
    const title = (item.title || "").toLowerCase();
    for (const kw of excludeKeywords) {
      if (title.includes(kw.toLowerCase())) return false;
    }
    return true;
  });
}

function mapToNormalizedItem(item: Record<string, unknown>, provider: string): NormalizedCatalogItem {
  const images: string[] = [];
  if (item.image_url) images.push(item.image_url as string);
  if (Array.isArray(item.images)) images.push(...(item.images as string[]));
  
  return {
    id: (item.id as string) || `${provider}:${item.provider_product_id || item.itemId || "unknown"}`,
    provider: (item.provider as string) || provider,
    provider_product_id: (item.provider_product_id as string) || (item.itemId as string) || "",
    title: (item.title as string) || "",
    price_usd: item.price_usd as number | null ?? item.priceUsd as number | null ?? null,
    image_url: (item.image_url as string) || (item.imageUrl as string) || images[0] || null,
    images,
    product_url: (item.product_url as string) || (item.productUrl as string) || "",
    in_stock: (item.in_stock as boolean) ?? (item.inStock as boolean) ?? true,
    rating: item.rating as number | null,
    brand: item.brand as string | null,
    condition: item.condition as string,
  };
}

// ─── LOAD FILTER PROFILE ──────────────────────────────────────────────────────

async function loadFilterProfile(db: PostgrestClient, filterKey: string): Promise<FilterProfile | null> {
  const normalizedKey = normalizeFilterKey(filterKey);
  
  const { data, error } = await db
    .from("catalog_filter_profiles")
    .select("*")
    .eq("key", normalizedKey)
    .maybeSingle();
  
  if (error || !data) {
    // Fallback to 'all' profile if specific one not found
    if (normalizedKey !== "all") {
      const { data: fallback } = await db
        .from("catalog_filter_profiles")
        .select("*")
        .eq("key", "all")
        .maybeSingle();
      return fallback as FilterProfile | null;
    }
    return null;
  }
  
  return data as FilterProfile;
}

// ─── BUILD MIXED FEED ─────────────────────────────────────────────────────────

export async function buildMixedFeed(options: FeedOptions): Promise<NormalizedCatalogItem[]> {
  const correlationId = options.correlationId || generateCorrelationId();
  const startTime = Date.now();
  const { limit, provider } = options;
  
  console.log(`[FEED_ENGINE] start correlationId=${correlationId} limit=${limit} provider=${provider}`);
  
  const db = createAdminPostgrestClient();
  const allItems: NormalizedCatalogItem[] = [];
  
  // Fetch from each seed in parallel
  const seedPromises = Object.entries(MIXED_FEED_SEEDS).map(async ([seedName, query]) => {
    const seedStart = Date.now();
    const excludes = SEED_EXCLUDES[seedName] || [];
    
    try {
      let items: NormalizedCatalogItem[] = [];
      
      // Determine which provider to use based on seed and mode
      const useEbay = provider === "ebay" || provider === "mixed";
      const useAmazon = provider === "amazon" || (provider === "mixed" && seedName.includes("phones"));
      
      if (useEbay) {
        // Query database for cached items first
        const { data: dbItems } = await db
          .from("catalog_items")
          .select("*")
          .ilike("title", `%${query.split(" ")[0]}%`)
          .eq("in_stock", true)
          .gte("price_usd", 10)
          .limit(40);
        
        if (dbItems && dbItems.length > 0) {
          items = dbItems.map((item: Record<string, unknown>) => mapToNormalizedItem(item, "ebay"));
        }
      }
      
      // Apply light filtering
      const filtered = applyLightFilter(items, excludes);
      const seedMs = Date.now() - seedStart;
      
      console.log(`[FEED_ENGINE][SEED] name=${seedName} provider=${useEbay ? 'ebay' : 'amazon'} fetched=${items.length} kept=${filtered.length} ms=${seedMs}`);
      
      return filtered;
    } catch (err) {
      console.error(`[FEED_ENGINE][SEED_ERROR] name=${seedName} error=${(err as Error).message}`);
      return [];
    }
  });
  
  const seedResults = await Promise.all(seedPromises);
  
  // Merge all items
  for (const items of seedResults) {
    allItems.push(...items);
  }
  
  // Dedupe and shuffle
  const unique = dedupeItems(allItems);
  const shuffled = stableShuffleWithSeed(unique, correlationId);
  const result = shuffled.slice(0, limit);
  
  const totalMs = Date.now() - startTime;
  console.log(`[FEED_ENGINE] done correlationId=${correlationId} unique=${unique.length} returned=${result.length} ms=${totalMs}`);
  
  return result;
}

// ─── BUILD FILTERED FEED ──────────────────────────────────────────────────────

export async function buildFilteredFeed(options: FilteredFeedOptions): Promise<NormalizedCatalogItem[]> {
  const correlationId = options.correlationId || generateCorrelationId();
  const startTime = Date.now();
  const { limit, provider, filterKey, q, sort, filters } = options;
  
  console.log(`[FEED_ENGINE] start correlationId=${correlationId} filterKey=${filterKey} q=${q || ''} limit=${limit}`);
  
  const db = createAdminPostgrestClient();
  
  // Load filter profile
  const profile = await loadFilterProfile(db, filterKey);
  const includeKeywords = profile?.include_keywords || [];
  const excludeHard = profile?.exclude_hard || [];
  const excludeSoft = profile?.exclude_soft || [];
  const minPriceFromProfile = profile?.min_price_usd;
  const isVehicleMode = profile?.mode === "vehicle";
  
  console.log(`[FEED_ENGINE] profile loaded key=${filterKey} includes=${includeKeywords.length} excludeHard=${excludeHard.length} mode=${profile?.mode || 'general'}`);
  
  // Build search query
  const searchQuery = q || (includeKeywords.length > 0 ? includeKeywords.slice(0, 3).join(" ") : filterKey);
  
  // Determine fetch limit (4x for filtering headroom)
  const fetchLimit = limit * 4;
  
  // Build database query
  let query = db
    .from("catalog_items")
    .select("*")
    .eq("in_stock", true)
    .limit(fetchLimit);
  
  // Apply search filter
  if (searchQuery) {
    query = query.ilike("title", `%${searchQuery.split(" ")[0]}%`);
  }
  
  // Apply price filters
  const effectiveMinPrice = filters?.minPrice ?? minPriceFromProfile ?? 0;
  if (effectiveMinPrice > 0) {
    query = query.gte("price_usd", effectiveMinPrice);
  }
  if (filters?.maxPrice) {
    query = query.lte("price_usd", filters.maxPrice);
  }
  
  // Apply provider filter
  if (provider !== "mixed") {
    query = query.eq("provider", provider);
  }
  
  // Apply sort
  if (sort === "price_asc") {
    query = query.order("price_usd", { ascending: true });
  } else if (sort === "price_desc") {
    query = query.order("price_usd", { ascending: false });
  } else if (sort === "newest") {
    query = query.order("created_at", { ascending: false });
  } else if (sort === "rating") {
    query = query.order("rating", { ascending: false });
  }
  
  const { data: dbItems, error } = await query;
  
  if (error) {
    console.error(`[FEED_ENGINE] DB error: ${error.message}`);
    return [];
  }
  
  let items = (dbItems || []).map((item: Record<string, unknown>) => 
    mapToNormalizedItem(item, item.provider as string || "ebay")
  );
  
  console.log(`[FEED_ENGINE] fetched=${items.length} before_filter`);
  
  // PASS 1: Strict filtering (hard + soft excludes)
  const strictFiltered = items.filter(item => {
    const title = (item.title || "").toLowerCase();
    
    // Hard excludes - always block
    for (const kw of excludeHard) {
      if (title.includes(kw.toLowerCase())) return false;
    }
    
    // Soft excludes
    for (const kw of excludeSoft) {
      if (title.includes(kw.toLowerCase())) return false;
    }
    
    return true;
  });
  
  console.log(`[FEED_ENGINE] strict_filter kept=${strictFiltered.length}`);
  
  // Check if we have enough items (30% threshold)
  const minRequired = Math.floor(limit * 0.3);
  
  if (strictFiltered.length >= minRequired) {
    const result = strictFiltered.slice(0, limit);
    const totalMs = Date.now() - startTime;
    console.log(`[FEED_ENGINE] done correlationId=${correlationId} returned=${result.length} source=strict ms=${totalMs}`);
    return result;
  }
  
  // PASS 2: Relaxed filtering (only hard excludes)
  console.log(`[FEED_ENGINE] strict insufficient (${strictFiltered.length}), falling back to relaxed`);
  
  const relaxedFiltered = items.filter(item => {
    const title = (item.title || "").toLowerCase();
    
    // Only hard excludes
    for (const kw of excludeHard) {
      if (title.includes(kw.toLowerCase())) return false;
    }
    
    return true;
  });
  
  const result = relaxedFiltered.slice(0, limit);
  const totalMs = Date.now() - startTime;
  console.log(`[FEED_ENGINE] done correlationId=${correlationId} returned=${result.length} source=relaxed ms=${totalMs}`);
  
  return result;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

export { loadFilterProfile };
