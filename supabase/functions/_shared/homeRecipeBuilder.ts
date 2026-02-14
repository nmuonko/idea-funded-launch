/**
 * homeRecipeBuilder.ts - Unified build engine for mobile sections + web feed
 * 
 * Reads home_recipes + home_recipe_seeds from DB, fetches items per-seed
 * from catalog_items (DB) and optionally eBay Browse API, then assembles
 * the exact JSON payloads that mobile and web clients expect.
 * 
 * CRITICAL: This module does NOT change any response shapes.
 * Mobile gets {ok, sections[], page, pageSize, hasMore, meta}
 * Web gets {ok, sections:[{key:"featured", items}], page, pageSize, totalPages, hasMore, meta}
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface RecipeRow {
  id: string;
  target: string;
  key: string;
  title_en: string | null;
  title_fr: string | null;
  enabled: boolean;
  sort_order: number;
  mode: string;
  min_price_usd: number | null;
  max_price_usd: number | null;
  provider_policy: Record<string, unknown>;
}

export interface SeedRow {
  id: string;
  recipe_id: string;
  query: string;
  weight: number;
  enabled: boolean;
}

export interface RecipeItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  priceUsd: number | null;
  currency: string;
  image_url: string | null;
  imageUrl: string | null;
  product_url: string | null;
  productUrl: string | null;
  in_stock: boolean;
}

interface RefreshSettings {
  mobile_refresh_hours: number;
  web_refresh_hours: number;
  mobile_schema_version: number;
  web_schema_version: number;
}

interface BuildResult {
  payload: Record<string, unknown>;
  itemCount: number;
  sectionCount: number;
  durationMs: number;
}

// ─── TITLE MAP (fallback) ─────────────────────────────────────────────────────

const TITLE_FALLBACK: Record<string, { en: string; fr: string }> = {
  phones: { en: "Phones", fr: "Téléphones" },
  electronics: { en: "Electronics", fr: "Électronique" },
  vehicles: { en: "Vehicles", fr: "Véhicules" },
  parts_accessories: { en: "Parts & Accessories", fr: "Pièces & Accessoires" },
  gaming: { en: "Gaming", fr: "Jeux Vidéo" },
  clothing: { en: "Clothing & Fashion", fr: "Vêtements et Mode" },
  home_garden: { en: "Home & Garden", fr: "Maison & Jardin" },
  toys: { en: "Toys", fr: "Jouets" },
  sporting_goods: { en: "Sporting Goods", fr: "Articles de Sport" },
  refurbished: { en: "Refurbished", fr: "Reconditionnés" },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function restHeaders(): Record<string, string> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function baseUrl(): string {
  return Deno.env.get("SUPABASE_URL") || "";
}

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

// ─── LOAD RECIPES + SEEDS ─────────────────────────────────────────────────────

async function loadRecipes(target: "mobile" | "web"): Promise<RecipeRow[]> {
  const url = `${baseUrl()}/rest/v1/home_recipes?target=eq.${target}&enabled=eq.true&order=sort_order.asc`;
  const rows = await fetchJson<RecipeRow[]>(url, restHeaders());
  return rows || [];
}

async function loadSeedsForRecipe(recipeId: string): Promise<SeedRow[]> {
  const url = `${baseUrl()}/rest/v1/home_recipe_seeds?recipe_id=eq.${recipeId}&enabled=eq.true&order=weight.desc`;
  const rows = await fetchJson<SeedRow[]>(url, restHeaders());
  return rows || [];
}

async function loadRefreshSettings(env: string): Promise<RefreshSettings> {
  const url = `${baseUrl()}/rest/v1/home_refresh_settings?env=eq.${encodeURIComponent(env)}`;
  const rows = await fetchJson<RefreshSettings[]>(url, restHeaders());
  if (rows && rows.length > 0) return rows[0];
  return { mobile_refresh_hours: 12, web_refresh_hours: 12, mobile_schema_version: 1, web_schema_version: 1 };
}

// ─── FETCH ITEMS FROM SEEDS ───────────────────────────────────────────────────

/**
 * Fetch items from catalog_items DB using seed queries
 */
async function fetchItemsFromDB(
  seeds: SeedRow[],
  targetCount: number,
  minPrice?: number | null,
  maxPrice?: number | null
): Promise<RecipeItem[]> {
  if (seeds.length === 0) return [];
  
  const queries = seeds.map(s => s.query);
  const orClauses = queries
    .slice(0, 12)
    .map(q => `title.ilike.*${q.replace(/ /g, "+")}*`)
    .join(",");
  
  // Build price filter: use min_price if set, otherwise default to > 0
  const priceFloor = (minPrice && minPrice > 0) ? minPrice : 0;
  let filters = `provider=in.(amazon,ebay)&price_usd=gte.${priceFloor}&image_url=not.is.null&is_disallowed=eq.false&or=(${orClauses})&order=updated_at.desc.nullslast&limit=${targetCount * 3}`;
  
  if (maxPrice && maxPrice > 0) {
    filters += `&price_usd=lte.${maxPrice}`;
  }

  const url = `${baseUrl()}/rest/v1/catalog_items?${filters}`;
  const rows = await fetchJson<Array<Record<string, unknown>>>(url, restHeaders());
  if (!rows || rows.length === 0) return [];

  return rows
    .map(row => ({
      id: `${row.provider}_${row.provider_product_id}`,
      provider: row.provider as string,
      provider_product_id: row.provider_product_id as string,
      title: (row.title as string) || "Product",
      price_usd: row.price_usd as number | null,
      priceUsd: row.price_usd as number | null,
      currency: "USD",
      image_url: row.image_url as string | null,
      imageUrl: row.image_url as string | null,
      product_url: row.product_url as string | null,
      productUrl: row.product_url as string | null,
      in_stock: true,
    }))
    .filter(i => i.title && i.image_url && i.price_usd && i.price_usd > 0);
}

/**
 * Fetch items from eBay Browse API for a single query
 */
async function fetchEbayItemsForSeed(
  query: string,
  limit: number,
  ebayToken: string
): Promise<RecipeItem[]> {
  try {
    const searchUrl = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("limit", String(Math.min(limit, 50)));

    const res = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${ebayToken}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!res.ok) return [];
    const data = await res.json();
    const rawItems = data.itemSummaries || [];
    
    return rawItems
      .map((item: Record<string, unknown>) => {
        const itemId = item.itemId as string || "";
        if (!itemId) return null;
        
        const priceObj = item.price as Record<string, unknown> | undefined;
        let priceUsd: number | null = null;
        if (priceObj?.value !== undefined) {
          const val = typeof priceObj.value === "string" ? parseFloat(priceObj.value) : priceObj.value;
          if (typeof val === "number" && !isNaN(val) && val > 0) priceUsd = val;
        }
        
        const imageUrl = (item.image as Record<string, unknown>)?.imageUrl as string || null;
        const productUrl = (item.itemWebUrl as string) || null;

        return {
          id: `ebay_${itemId}`,
          provider: "ebay",
          provider_product_id: itemId,
          title: (item.title as string) || "Unknown",
          price_usd: priceUsd,
          priceUsd: priceUsd,
          currency: (priceObj?.currency as string) || "USD",
          image_url: imageUrl,
          imageUrl: imageUrl,
          product_url: productUrl,
          productUrl: productUrl,
          in_stock: true,
        } as RecipeItem;
      })
      .filter((i: RecipeItem | null): i is RecipeItem => i !== null && !!i.title && !!i.image_url && !!i.price_usd);
  } catch {
    return [];
  }
}

/**
 * Get an eBay OAuth token
 */
let ebayTokenCache: { token: string; expiresAt: number } | null = null;

async function getEbayToken(): Promise<string | null> {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60000) {
    return ebayTokenCache.token;
  }
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });
    if (!res.ok) return null;
    const data = await res.json();
    ebayTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 7200) * 1000 };
    return ebayTokenCache.token;
  } catch {
    return null;
  }
}

/**
 * Fetch items for a recipe (DB + optional eBay)
 */
async function fetchItemsForRecipe(
  recipe: RecipeRow,
  seeds: SeedRow[],
  targetCount: number,
  ebayToken: string | null
): Promise<RecipeItem[]> {
  const usedIds = new Set<string>();
  const results: RecipeItem[] = [];
  const policy = recipe.provider_policy || {};

  // 1) DB items (always tried)
  const dbItems = await fetchItemsFromDB(seeds, targetCount, recipe.min_price_usd, recipe.max_price_usd);
  for (const item of dbItems) {
    if (!usedIds.has(item.id) && results.length < targetCount) {
      usedIds.add(item.id);
      results.push(item);
    }
  }

  // 2) eBay live items (if enabled and need more)
  if (ebayToken && policy.ebay !== false && results.length < targetCount) {
    const needed = targetCount - results.length;
    const topSeeds = seeds.slice(0, 4);
    const perSeed = Math.ceil(needed / Math.max(topSeeds.length, 1));
    
    const ebayPromises = topSeeds.map(s => fetchEbayItemsForSeed(s.query, perSeed, ebayToken));
    const ebayResults = await Promise.allSettled(ebayPromises);
    
    for (const result of ebayResults) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          if (!usedIds.has(item.id) && results.length < targetCount) {
            // Apply price filters
            if (recipe.min_price_usd && (item.price_usd || 0) < recipe.min_price_usd) continue;
            if (recipe.max_price_usd && (item.price_usd || 0) > recipe.max_price_usd) continue;
            usedIds.add(item.id);
            results.push(item);
          }
        }
      }
    }
  }

  return results;
}

// ─── BUILD MOBILE HOMEPAGE ───────────────────────────────────────────────────

const MOBILE_ITEMS_PER_SECTION = 30; // cache up to 30, serve 20

export async function buildMobileHomepage(env: string, recipeKey?: string | null): Promise<BuildResult> {
  const startMs = Date.now();
  let recipes = await loadRecipes("mobile");
  const settings = await loadRefreshSettings(env);
  const ebayToken = await getEbayToken();
  const ttlSeconds = settings.mobile_refresh_hours * 3600;

  // If recipeKey specified, we rebuild only that section but merge into existing cache
  let existingPayload: Record<string, unknown> | null = null;
  if (recipeKey) {
    const cached = await readMobileCache(env);
    existingPayload = cached.payload;
    recipes = recipes.filter(r => r.key === recipeKey);
  }

  const sections: Array<Record<string, unknown>> = [];
  let totalItems = 0;

  // Build each section from its own seeds
  for (const recipe of recipes) {
    const seeds = await loadSeedsForRecipe(recipe.id);
    const items = await fetchItemsForRecipe(recipe, seeds, MOBILE_ITEMS_PER_SECTION, ebayToken);
    
    const titleEn = recipe.title_en || TITLE_FALLBACK[recipe.key]?.en || recipe.key;
    const titleFr = recipe.title_fr || TITLE_FALLBACK[recipe.key]?.fr || recipe.key;
    
    sections.push({
      key: recipe.key,
      title: titleFr, // default to French
      title_en: titleEn,
      title_fr: titleFr,
      items,
    });
    totalItems += items.length;
  }

  // Merge with existing cache if single-section rebuild
  let finalSections = sections;
  if (recipeKey && existingPayload) {
    const existingSections = (existingPayload as Record<string, unknown>).sections as Array<Record<string, unknown>> || [];
    finalSections = existingSections.map(s => {
      const rebuilt = sections.find(ns => ns.key === s.key);
      return rebuilt || s;
    });
    // Add if new section not in existing
    for (const s of sections) {
      if (!finalSections.find(es => es.key === s.key)) {
        finalSections.push(s);
      }
    }
    totalItems = finalSections.reduce((sum, s) => sum + ((s.items as unknown[])?.length || 0), 0);
  }

  const payload = {
    ok: true,
    sections: finalSections,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    totalItems,
    hasMore: false,
    hasMoreCached: false,
    ttlSeconds,
    meta: {
      source: "recipe_build",
      builtAt: Date.now(),
      envUsed: env,
      schemaVersion: settings.mobile_schema_version,
      ttlSeconds,
      sectionCount: finalSections.length,
      rebuiltSection: recipeKey || undefined,
    },
  };

  return {
    payload,
    itemCount: totalItems,
    sectionCount: finalSections.length,
    durationMs: Date.now() - startMs,
  };
}

// ─── BUILD WEB HOMEPAGE ──────────────────────────────────────────────────────

const WEB_ITEMS_PER_PAGE = 100;

export async function buildWebHomepage(env: string, recipeKey?: string | null): Promise<BuildResult> {
  const startMs = Date.now();
  let recipes = await loadRecipes("web");
  const settings = await loadRefreshSettings(env);
  const ebayToken = await getEbayToken();
  const ttlSeconds = settings.web_refresh_hours * 3600;

  // If recipeKey specified, rebuild only that recipe's items then merge into existing cache
  let existingPayload: Record<string, unknown> | null = null;
  if (recipeKey) {
    const cached = await readWebCache(env);
    existingPayload = cached.payload;
    recipes = recipes.filter(r => r.key === recipeKey);
  }

  // Build items from selected recipes, tagging each with _recipeKey
  const newItems: Array<RecipeItem & { _recipeKey?: string }> = [];
  const usedIds = new Set<string>();

  for (const recipe of recipes) {
    const seeds = await loadSeedsForRecipe(recipe.id);
    const items = await fetchItemsForRecipe(recipe, seeds, WEB_ITEMS_PER_PAGE, ebayToken);
    
    for (const item of items) {
      if (!usedIds.has(item.id)) {
        usedIds.add(item.id);
        newItems.push({ ...item, _recipeKey: recipe.key });
      }
    }
  }

  // Merge: if single-recipe rebuild, replace only that recipe's items in existing pool
  let allItems = newItems;
  if (recipeKey && existingPayload) {
    const existingItems = ((existingPayload as Record<string, unknown>).items as Array<RecipeItem & { _recipeKey?: string }>) || [];
    // Keep all items that belong to OTHER recipes, remove all items from the rebuilt recipe
    const kept = existingItems.filter(i => (i._recipeKey || "homepage") !== recipeKey);
    allItems = [...kept, ...newItems];
  }

  const payload = {
    ok: true,
    totalPool: allItems.length,
    items: allItems,
    pageSize: WEB_ITEMS_PER_PAGE,
    totalPages: Math.ceil(allItems.length / WEB_ITEMS_PER_PAGE) || 1,
    ttlSeconds,
    meta: {
      source: "recipe_build",
      builtAt: Date.now(),
      envUsed: env,
      schemaVersion: settings.web_schema_version,
      ttlSeconds,
      rebuiltSection: recipeKey || undefined,
    },
  };

  return {
    payload,
    itemCount: allItems.length,
    sectionCount: recipes.length,
    durationMs: Date.now() - startMs,
  };
}

// ─── CACHE READ/WRITE ─────────────────────────────────────────────────────────

export async function readMobileCache(env: string): Promise<{ hit: boolean; payload: Record<string, unknown> | null; ageSeconds: number; schemaVersion: number }> {
  const url = `${baseUrl()}/rest/v1/home_cache_mobile_sections?env=eq.${encodeURIComponent(env)}`;
  const rows = await fetchJson<Array<{ env: string; schema_version: number; built_at: string; ttl_seconds: number; payload: Record<string, unknown> }>>(url, restHeaders());
  
  if (!rows || rows.length === 0) return { hit: false, payload: null, ageSeconds: -1, schemaVersion: 0 };
  
  const row = rows[0];
  const ageSeconds = Math.floor((Date.now() - new Date(row.built_at).getTime()) / 1000);
  
  if (ageSeconds > row.ttl_seconds) {
    return { hit: false, payload: row.payload, ageSeconds, schemaVersion: row.schema_version };
  }
  
  return { hit: true, payload: row.payload, ageSeconds, schemaVersion: row.schema_version };
}

export async function writeMobileCache(env: string, payload: Record<string, unknown>, ttlSeconds: number, schemaVersion: number): Promise<void> {
  const url = `${baseUrl()}/rest/v1/home_cache_mobile_sections`;
  const headers = { ...restHeaders(), Prefer: "resolution=merge-duplicates" };
  
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      env,
      schema_version: schemaVersion,
      built_at: new Date().toISOString(),
      ttl_seconds: ttlSeconds,
      payload,
    }),
  });
}

export async function readWebCache(env: string): Promise<{ hit: boolean; payload: Record<string, unknown> | null; ageSeconds: number; schemaVersion: number }> {
  const url = `${baseUrl()}/rest/v1/home_cache_web_feed?env=eq.${encodeURIComponent(env)}`;
  const rows = await fetchJson<Array<{ env: string; schema_version: number; built_at: string; ttl_seconds: number; payload: Record<string, unknown> }>>(url, restHeaders());
  
  if (!rows || rows.length === 0) return { hit: false, payload: null, ageSeconds: -1, schemaVersion: 0 };
  
  const row = rows[0];
  const ageSeconds = Math.floor((Date.now() - new Date(row.built_at).getTime()) / 1000);
  
  if (ageSeconds > row.ttl_seconds) {
    return { hit: false, payload: row.payload, ageSeconds, schemaVersion: row.schema_version };
  }
  
  return { hit: true, payload: row.payload, ageSeconds, schemaVersion: row.schema_version };
}

export async function writeWebCache(env: string, payload: Record<string, unknown>, ttlSeconds: number, schemaVersion: number): Promise<void> {
  const url = `${baseUrl()}/rest/v1/home_cache_web_feed`;
  const headers = { ...restHeaders(), Prefer: "resolution=merge-duplicates" };
  
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      env,
      schema_version: schemaVersion,
      built_at: new Date().toISOString(),
      ttl_seconds: ttlSeconds,
      payload,
    }),
  });
}

export { loadRefreshSettings };
