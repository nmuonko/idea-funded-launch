/**
 * Catalog Refresh Seeded - DB-First Ingestion Engine
 * 
 * Fetches products from eBay (primary, free) and optionally Rainforest (restricted)
 * based on seed queries in catalog_seed_queries table.
 * 
 * POST /catalog-refresh-seeded
 * Params:
 *   - mode: "db" | "live" (default: "db")
 *   - category: optional filter
 *   - provider: optional filter ("ebay" | "rainforest")
 *   - maxSeeds: max number of seeds to process (default: 30)
 * 
 * Requires: admin auth or cron secret
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapUnifiedCategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
};

// ─── eBay API Config ─────────────────────────────────────────────────────────

const EBAY_OAUTH_SCOPES = "https://api.ebay.com/oauth/api_scope";
const EBAY_ENDPOINTS = {
  production: {
    oauth: "https://api.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.ebay.com/buy/browse/v1",
  },
  sandbox: {
    oauth: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.sandbox.ebay.com/buy/browse/v1",
  },
};

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface SeedQuery {
  id: string;
  category: string;
  provider: string;
  seed_key: string;
  query: string;
  ebay_category_id?: string;
  filters?: {
    buyingOptions?: string[];
    minPriceUsd?: number;
    excludeKeywords?: string[];
  };
  ttl_minutes: number;
  last_refreshed_at?: string;
}

interface CatalogItemInsert {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  image_url: string | null;
  images: string[];
  product_url: string;
  in_stock: boolean;
  rating: number | null;
  unified_category: string;
  category_key: string;
  tags: string[];
  buying_options: string[];
  metadata: Record<string, any>;
  updated_at: string;
}

// ─── Token Management ────────────────────────────────────────────────────────

async function getEbayToken(supabase: any): Promise<string> {
  // Check cached token
  const { data: cached } = await supabase
    .from("provider_tokens")
    .select("access_token, expires_at")
    .eq("provider", "ebay")
    .maybeSingle();

  if (cached) {
    const expiresAt = new Date(cached.expires_at).getTime();
    if (expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      return cached.access_token;
    }
  }

  // Mint new token
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
  }

  const endpoint = EBAY_ENDPOINTS[environment].oauth;
  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_OAUTH_SCOPES)}`,
  });

  if (!response.ok) {
    throw new Error(`eBay OAuth failed: ${response.status}`);
  }

  const data = await response.json();
  const { access_token, expires_in, token_type } = data;
  const expiresAt = new Date(Date.now() + (expires_in * 1000) - TOKEN_EXPIRY_BUFFER_MS);

  // Cache token
  await supabase.from("provider_tokens").upsert({
    provider: "ebay",
    access_token,
    token_type: token_type || "Bearer",
    expires_at: expiresAt.toISOString(),
    scopes: [EBAY_OAUTH_SCOPES],
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider" });

  return access_token;
}

// ─── eBay Search ─────────────────────────────────────────────────────────────

async function searchEbayForSeed(
  token: string,
  seed: SeedQuery,
  limit: number = 20
): Promise<CatalogItemInsert[]> {
  const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const marketplace = "EBAY_US";

  // Build filter string
  let filterParts = ["buyingOptions:{FIXED_PRICE}"];
  
  if (seed.filters?.minPriceUsd) {
    filterParts.push(`price:[${seed.filters.minPriceUsd}..],priceCurrency:USD`);
  }

  // Add category filter for motors
  if (seed.ebay_category_id) {
    filterParts.push(`categoryIds:{${seed.ebay_category_id}}`);
  }

  const params = new URLSearchParams({
    q: seed.query,
    limit: String(limit),
    offset: "0",
    filter: filterParts.join(","),
  });

  const endpoint = `${EBAY_ENDPOINTS[environment].browse}/item_summary/search?${params}`;

  console.log(`[REFRESH] Fetching eBay: ${seed.seed_key} q="${seed.query}"`);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[REFRESH] eBay API error for ${seed.seed_key}:`, response.status, errorText.slice(0, 200));
    return [];
  }

  const data = await response.json();
  const itemSummaries = data.itemSummaries || [];

  console.log(`[REFRESH] Got ${itemSummaries.length} raw items for ${seed.seed_key}`);

  const items: CatalogItemInsert[] = [];
  const excludeKeywords = seed.filters?.excludeKeywords || [];

  for (const item of itemSummaries) {
    const title = item.title || "";
    const titleLower = title.toLowerCase();

    // Skip items with excluded keywords
    const shouldExclude = excludeKeywords.some(kw => titleLower.includes(kw.toLowerCase()));
    if (shouldExclude) {
      continue;
    }

    // Extract price
    let priceUsd: number | null = null;
    if (item.price?.value) {
      priceUsd = parseFloat(item.price.value);
      if (item.price.currency !== "USD") {
        // Simple conversion (approximate)
        if (item.price.currency === "GBP") priceUsd *= 1.27;
        else if (item.price.currency === "EUR") priceUsd *= 1.09;
        else if (item.price.currency === "CAD") priceUsd *= 0.74;
      }
    }

    // Skip if below min price for motors
    if (seed.filters?.minPriceUsd && priceUsd !== null && priceUsd < seed.filters.minPriceUsd) {
      continue;
    }

    // Extract buying options
    const buyingOptions = item.buyingOptions || [];

    // Skip auctions for motors
    if (seed.category === "motors" && !buyingOptions.includes("FIXED_PRICE")) {
      continue;
    }

    // Extract images
    const images: string[] = [];
    if (item.image?.imageUrl) {
      images.push(item.image.imageUrl.replace(/^http:/, "https:"));
    }
    if (item.thumbnailImages) {
      for (const img of item.thumbnailImages) {
        if (img.imageUrl) {
          const normalized = img.imageUrl.replace(/^http:/, "https:");
          if (!images.includes(normalized)) images.push(normalized);
        }
      }
    }
    if (item.additionalImages) {
      for (const img of item.additionalImages) {
        if (img.imageUrl) {
          const normalized = img.imageUrl.replace(/^http:/, "https:");
          if (!images.includes(normalized)) images.push(normalized);
        }
      }
    }

    // Get unified category
    const unifiedCategory = mapUnifiedCategory({
      title,
      provider: "ebay",
      ebayCategoryPath: item.categories?.[0]?.categoryName || "",
      ebayCategoryId: item.categories?.[0]?.categoryId || "",
      productUrl: item.itemWebUrl || "",
    });

    // Skip blocked items
    if (unifiedCategory === "blocked") {
      continue;
    }

    // Force category to seed category if mapper returns generic
    const finalCategory = unifiedCategory === "electronics" && seed.category !== "electronics"
      ? seed.category
      : unifiedCategory;

    items.push({
      id: `ebay:${item.itemId}`,
      provider: "ebay",
      provider_product_id: item.itemId,
      title,
      price_usd: priceUsd,
      image_url: images[0] || null,
      images: images.slice(0, 10), // Max 10 images
      product_url: item.itemWebUrl || `https://www.ebay.com/itm/${item.itemId}`,
      in_stock: item.itemAvailability?.availabilityStatus !== "OUT_OF_STOCK",
      rating: null,
      unified_category: finalCategory,
      category_key: seed.category,
      tags: [seed.category, seed.seed_key],
      buying_options: buyingOptions,
      metadata: {
        seedKey: seed.seed_key,
        categoryPath: item.categories?.[0]?.categoryName,
        condition: item.condition,
        seller: item.seller?.username,
      },
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`[REFRESH] Filtered to ${items.length} valid items for ${seed.seed_key}`);
  return items;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth check
  let isAuthorized = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === supabaseServiceKey) {
      isAuthorized = true;
    } else {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        isAuthorized = !!roles;
      }
    }
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse params
  let mode = "db";
  let categoryFilter: string | undefined;
  let providerFilter: string | undefined;
  let maxSeeds = 30;

  try {
    const body = await req.json().catch(() => ({}));
    mode = body.mode || "db";
    categoryFilter = body.category;
    providerFilter = body.provider;
    maxSeeds = body.maxSeeds || 30;
  } catch {
    // Use defaults
  }

  // Also check URL params
  const url = new URL(req.url);
  mode = url.searchParams.get("mode") || mode;
  categoryFilter = url.searchParams.get("category") || categoryFilter;
  providerFilter = url.searchParams.get("provider") || providerFilter;

  console.log(`[REFRESH] Starting. mode=${mode} category=${categoryFilter || "all"} provider=${providerFilter || "all"} maxSeeds=${maxSeeds}`);

  // DB-only mode: just return without calling APIs
  if (mode === "db") {
    return new Response(
      JSON.stringify({
        success: true,
        mode: "db",
        message: "DB-first mode: no external API calls made. Use mode=live to fetch from providers.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch enabled seeds
  let seedQuery = supabase
    .from("catalog_seed_queries")
    .select("*")
    .eq("enabled", true);

  if (categoryFilter) {
    seedQuery = seedQuery.eq("category", categoryFilter);
  }
  if (providerFilter) {
    seedQuery = seedQuery.eq("provider", providerFilter);
  }

  const { data: seeds, error: seedError } = await seedQuery.limit(maxSeeds);

  if (seedError) {
    console.error("[REFRESH] Failed to fetch seeds:", seedError.message);
    return new Response(
      JSON.stringify({ success: false, error: "Failed to fetch seed queries" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[SEED] Loaded ${seeds?.length || 0} seed queries`);

  if (!seeds || seeds.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No seed queries found", refreshed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get eBay token if we have eBay seeds
  const ebaySeeds = seeds.filter((s: SeedQuery) => s.provider === "ebay");
  let ebayToken: string | null = null;

  if (ebaySeeds.length > 0) {
    try {
      ebayToken = await getEbayToken(supabase);
    } catch (err) {
      console.error("[REFRESH] Failed to get eBay token:", err);
    }
  }

  const results: Record<string, { fetched: number; upserted: number; errors?: string[] }> = {};
  let totalFetched = 0;
  let totalUpserted = 0;

  // Process eBay seeds
  for (const seed of ebaySeeds) {
    if (!ebayToken) {
      results[seed.seed_key] = { fetched: 0, upserted: 0, errors: ["No eBay token"] };
      continue;
    }

    try {
      const items = await searchEbayForSeed(ebayToken, seed, 20);
      totalFetched += items.length;

      if (items.length > 0) {
        // Upsert items
        const { error: upsertError, count } = await supabase
          .from("catalog_items")
          .upsert(items, { 
            onConflict: "provider,provider_product_id",
            count: "exact",
          });

        if (upsertError) {
          console.error(`[UPSERT] Error for ${seed.seed_key}:`, upsertError.message);
          results[seed.seed_key] = { fetched: items.length, upserted: 0, errors: [upsertError.message] };
        } else {
          const upsertedCount = count || items.length;
          totalUpserted += upsertedCount;
          results[seed.seed_key] = { fetched: items.length, upserted: upsertedCount };
          console.log(`[UPSERT] ${seed.seed_key}: ${upsertedCount} items`);
        }
      } else {
        results[seed.seed_key] = { fetched: 0, upserted: 0 };
      }

      // Update last_refreshed_at
      await supabase
        .from("catalog_seed_queries")
        .update({ 
          last_refreshed_at: new Date().toISOString(),
          item_count: items.length,
        })
        .eq("id", seed.id);

      // Rate limit: 500ms between API calls
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[REFRESH] Error for ${seed.seed_key}:`, msg);
      results[seed.seed_key] = { fetched: 0, upserted: 0, errors: [msg] };
    }
  }

  // Rainforest seeds (restricted - skip for now to save API credits)
  const rainforestSeeds = seeds.filter((s: SeedQuery) => s.provider === "rainforest");
  if (rainforestSeeds.length > 0) {
    console.log(`[REFRESH] Skipping ${rainforestSeeds.length} Rainforest seeds (restricted mode)`);
    for (const seed of rainforestSeeds) {
      results[seed.seed_key] = { fetched: 0, upserted: 0, errors: ["Rainforest restricted - use catalog-refresh for Rainforest"] };
    }
  }

  console.log(`[REFRESH] Complete. Fetched=${totalFetched} Upserted=${totalUpserted}`);

  return new Response(
    JSON.stringify({
      success: true,
      mode: "live",
      totalFetched,
      totalUpserted,
      seedsProcessed: Object.keys(results).length,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
