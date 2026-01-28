/**
 * Catalog Product Details Endpoint with Smart Caching
 * Get product details by ASIN via Rainforest API
 * 
 * Cache strategy: stale=1day, expire=7days (products rarely change)
 * 
 * Supported query formats:
 *   GET /catalog-product?env=staging&id=rainforest:B0GCRKG9N1
 *   GET /catalog-product?env=staging&provider=rainforest&asin=B0GCRKG9N1
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { fetchProductDetails, formatCatalogItem } from "../_shared/rainforestAdapter.ts";
import { 
  buildCacheKey, 
  getCache, 
  setCache,
  checkRateLimit, 
  rateLimitResponse, 
  getDeviceId 
} from "../_shared/catalogCache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=300",
};

function validateAsin(asin: string): string | null {
  if (!asin || asin.length === 0) return "ASIN is required";
  if (asin.length !== 10) return `ASIN must be 10 characters (got ${asin.length})`;
  if (!/^[A-Z0-9]+$/.test(asin)) return "ASIN must be alphanumeric (A-Z, 0-9)";
  return null;
}

function parseProductId(url: URL): { provider: string | null; asin: string | null; rawId: string; asinError: string | null } {
  let provider: string | null = null;
  let asin: string | null = null;

  const id = (url.searchParams.get("id") || "").trim();
  if (id && id.includes(":")) {
    const parts = id.split(":", 2);
    provider = (parts[0] || "").trim().toLowerCase() || null;
    asin = (parts[1] || "").trim().toUpperCase() || null;
  } else {
    provider = (url.searchParams.get("provider") || "").trim().toLowerCase() || null;
    asin = (url.searchParams.get("asin") || "").trim().toUpperCase() || null;
    if (!asin && id) {
      asin = id.toUpperCase();
      provider = "rainforest";
    }
  }

  const rawId = provider && asin ? `${provider}:${asin}` : asin || id || "";
  const asinError = asin ? validateAsin(asin) : "ASIN is required";

  return { provider, asin, rawId, asinError };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const envName = getEnvironmentFromRequest(req);
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  const deviceId = getDeviceId(req);
  const isStaging = envName === "staging";

  const { provider, asin, rawId, asinError } = parseProductId(url);

  const errorResponse = (code: string, message: string) => {
    console.log(`[CATALOG_PRODUCT] asin=${asin || "MISSING"} error=${code} durationMs=${Date.now() - startTime}`);
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      id: rawId || null,
      item: null,
      cached: false,
      stale: false,
      cacheAgeSec: 0,
      error: { code, message },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  if (asinError) return errorResponse("INVALID_ASIN", asinError);
  if (provider && provider !== "rainforest") return errorResponse("PROVIDER_NOT_SUPPORTED", `Provider '${provider}' not supported`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) return errorResponse("CONFIG_ERROR", "Service unavailable");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Rate limiting
    const rateLimit = await checkRateLimit(supabase, deviceId, "product");
    if (!rateLimit.allowed) {
      console.log(`[CATALOG_PRODUCT] Rate limited device=${deviceId} count=${rateLimit.count}`);
      return new Response(JSON.stringify(rateLimitResponse(rateLimit.resetAt)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) return errorResponse("CATALOG_DISABLED", "Catalog not enabled");

    // Build cache key
    const productId = `rainforest:${asin}`;
    const cacheKey = buildCacheKey("product", {
      env: envName,
      domain: amazonDomain,
      productId,
    });

    // Check unified cache first
    const cacheResult = await getCache(supabase, cacheKey);
    
    if (cacheResult.hit && cacheResult.data?.item) {
      console.log(`[CATALOG_PRODUCT] Cache hit: asin=${asin} stale=${cacheResult.stale} age=${cacheResult.cacheAgeSec}s`);
      
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        id: productId,
        item: cacheResult.data.item,
        cached: true,
        stale: cacheResult.stale,
        cacheAgeSec: cacheResult.cacheAgeSec,
        ...(isStaging && { cacheKey }),
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also check catalog_products table (legacy cache)
    const { data: cachedProduct } = await supabase
      .from("catalog_products")
      .select("*")
      .eq("provider_product_id", asin)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cachedProduct) {
      const rawData = cachedProduct.raw as Record<string, any> | null;
      let images: string[] = [];
      
      if (rawData?.processedImages && Array.isArray(rawData.processedImages)) {
        images = rawData.processedImages;
      } else if (rawData?.images && Array.isArray(rawData.images)) {
        images = rawData.images
          .map((i: any) => i?.large || i?.link || (typeof i === "string" ? i : null))
          .filter((url: any): url is string => !!url && url.startsWith("http"))
          .slice(0, 10);
      }
      
      if (cachedProduct.image_url && !images.includes(cachedProduct.image_url)) {
        images.unshift(cachedProduct.image_url);
      }
      images = [...new Set(images)].slice(0, 10);
      
      const priceUsd = (cachedProduct.price_usd && cachedProduct.price_usd > 0) ? cachedProduct.price_usd : null;

      const item = {
        id: productId,
        provider: "rainforest",
        providerProductId: cachedProduct.provider_product_id,
        title: cachedProduct.title || "",
        priceUsd,
        imageUrl: cachedProduct.image_url || null,
        images,
        productUrl: cachedProduct.product_url || null,
        inStock: cachedProduct.in_stock ?? null,
        rating: cachedProduct.rating || null,
        description: cachedProduct.description || null,
        brand: cachedProduct.brand || null,
      };

      // Store in unified cache for faster future access
      await setCache(supabase, "product", cacheKey, { item }, { amazonDomain });

      console.log(`[CATALOG_PRODUCT] DB cache hit: asin=${asin} durationMs=${Date.now() - startTime}`);

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        id: productId,
        item,
        cached: true,
        stale: false,
        cacheAgeSec: 0,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch from Rainforest
    const { product, error: rainforestError } = await fetchProductDetails(asin!, amazonDomain);

    if (rainforestError || !product) {
      // UPGRADE A: Negative cache with short TTL (30s stale, 2min expire)
      // setCache now auto-detects negative results and applies short TTL
      await setCache(supabase, "product", cacheKey, { item: null, error: rainforestError || "NOT_FOUND" }, { amazonDomain });
      return errorResponse(rainforestError || "NOT_FOUND", `Product not found on ${amazonDomain}`);
    }

    // Cache the product in catalog_products (legacy)
    const { data: providerRow } = await supabase
      .from("catalog_providers")
      .select("id")
      .eq("name", "amazon")
      .maybeSingle();

    if (providerRow?.id) {
      const priceToCache = (product.priceUsd !== null && product.priceUsd > 0) ? product.priceUsd : null;
      const rawWithImages = { ...(product.raw || {}), processedImages: product.images || [] };
      
      supabase.from("catalog_products").upsert({
        provider_id: providerRow.id,
        provider_product_id: product.providerProductId,
        title: product.title,
        description: product.description,
        image_url: product.imageUrl,
        product_url: product.productUrl,
        price_usd: priceToCache,
        currency: "USD",
        in_stock: product.inStock,
        rating: product.rating,
        review_count: product.reviewCount,
        brand: product.brand,
        category_path: product.categoryPath,
        raw: rawWithImages,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      }, { onConflict: "provider_product_id" });
    }

    // UPGRADE B: Build normalized item (max 10 images, truncated description)
    const images = (product.images || []).slice(0, 10);
    const priceUsd = (product.priceUsd !== null && product.priceUsd > 0) ? product.priceUsd : null;
    const description = product.description && product.description.length > 2000
      ? product.description.substring(0, 2000) + '...'
      : product.description || null;

    const item = {
      id: productId,
      provider: "rainforest",
      providerProductId: product.providerProductId,
      title: product.title || "",
      priceUsd,
      imageUrl: product.imageUrl || null,
      images,
      productUrl: product.productUrl || null,
      inStock: product.inStock ?? null,
      rating: product.rating ?? null,
      description,
      brand: product.brand || null,
    };

    // Store in unified cache (auto-normalizes and applies correct TTL)
    await setCache(supabase, "product", cacheKey, { item }, { amazonDomain });

    console.log(`[CATALOG_PRODUCT] Rainforest fetch: asin=${asin} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      id: productId,
      item,
      cached: false,
      stale: false,
      cacheAgeSec: 0,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_PRODUCT] Error: ${errorMessage} durationMs=${Date.now() - startTime}`);
    return errorResponse("INTERNAL_ERROR", "Product service error");
  }
});
