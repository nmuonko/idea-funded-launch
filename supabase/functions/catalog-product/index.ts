/**
 * Catalog Product Details Endpoint - DB-First with Live Fallback
 * 
 * GET /catalog-product?id=rainforest:B0GCRKG9N1
 * GET /catalog-product?asin=B0GCRKG9N1
 * 
 * DB-First Strategy:
 * - First check catalog_items table (preloaded data)
 * - If not found, fetch from Rainforest and cache
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { fetchProductDetails, formatCatalogItem } from "../_shared/rainforestAdapter.ts";
import { getEbayItem, CatalogItem as EbayCatalogItem } from "../_shared/ebayAdapter.ts";
import { getDeviceId } from "../_shared/catalogCache.ts";
import { isDisallowedItem, getBlockedSearchMessage } from "../_shared/contentBlocker.ts";
import { 
  upgradeEbayImageToHighRes, 
  upgradeAmazonImageToHighRes,
  isEbayThumbnail,
  isAmazonThumbnail 
} from "../_shared/imageOptimization.ts";

// Dev mode check
const IS_DEV = Deno.env.get("DENO_DEPLOYMENT_ID")?.includes("staging") ||
               Deno.env.get("ENV") === "development" ||
               Deno.env.get("NODE_ENV") === "development";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=300",
};

/**
 * Upgrade ALL gallery images to high-resolution for product detail view
 * Applies provider-specific resolution upgrades and deduplicates
 */
function upgradeGalleryImages(images: string[], provider: string): string[] {
  if (!images || !Array.isArray(images)) return [];
  
  const seen = new Set<string>();
  const upgraded: string[] = [];
  let logCount = 0;
  const maxLogs = 5;
  
  for (const url of images) {
    if (!url || typeof url !== "string") continue;
    
    let upgradedUrl: string;
    let wasUpgraded = false;
    let wasThumbnail = false;
    
    if (provider === "ebay" || url.includes("ebayimg.com") || url.includes("i.ebayimg")) {
      wasThumbnail = isEbayThumbnail(url);
      upgradedUrl = upgradeEbayImageToHighRes(url);
      wasUpgraded = upgradedUrl !== url;
    } else if (provider === "rainforest" || url.includes("amazon") || url.includes("media-amazon") || url.includes("ssl-images-amazon")) {
      wasThumbnail = isAmazonThumbnail(url);
      upgradedUrl = upgradeAmazonImageToHighRes(url);
      wasUpgraded = upgradedUrl !== url;
    } else {
      upgradedUrl = url;
    }
    
    // Deduplicate after upgrade (some URLs become identical)
    if (!seen.has(upgradedUrl)) {
      seen.add(upgradedUrl);
      upgraded.push(upgradedUrl);
      
      // Dev logging (limit to 5 per request)
      if (IS_DEV && wasUpgraded && logCount < maxLogs) {
        console.log(`[IMG_UPGRADE_DETAIL] provider=${provider} old=${url.substring(0, 60)} new=${upgradedUrl.substring(0, 60)}`);
        logCount++;
      }
      
      if (IS_DEV && wasThumbnail && logCount < maxLogs) {
        console.log(`[THUMBNAIL_DETECTED] provider=${provider} url=${url.substring(0, 60)}`);
      }
    }
  }
  
  return upgraded;
}

function validateAsin(asin: string): string | null {
  if (!asin || asin.length === 0) return "ASIN is required";
  if (asin.length !== 10) return `ASIN must be 10 characters (got ${asin.length})`;
  if (!/^[A-Z0-9]+$/.test(asin)) return "ASIN must be alphanumeric (A-Z, 0-9)";
  return null;
}

function parseProductId(url: URL): { provider: string | null; productId: string | null; rawId: string; idError: string | null } {
  let provider: string | null = null;
  let productId: string | null = null;

  const id = (url.searchParams.get("id") || "").trim();
  if (id && id.includes(":")) {
    const parts = id.split(":", 2);
    provider = (parts[0] || "").trim().toLowerCase() || null;
    productId = (parts[1] || "").trim() || null;
    // For rainforest, convert to uppercase ASIN
    if (provider === "rainforest" && productId) {
      productId = productId.toUpperCase();
    }
  } else {
    provider = (url.searchParams.get("provider") || "").trim().toLowerCase() || null;
    productId = (url.searchParams.get("asin") || url.searchParams.get("itemId") || "").trim() || null;
    if (provider === "rainforest" && productId) {
      productId = productId.toUpperCase();
    }
    if (!productId && id) {
      productId = id.toUpperCase();
      provider = "rainforest";
    }
  }

  const rawId = provider && productId ? `${provider}:${productId}` : productId || id || "";
  
  // Validate based on provider
  let idError: string | null = null;
  if (!productId) {
    idError = "Product ID is required";
  } else if (provider === "rainforest") {
    idError = validateAsin(productId);
  }
  // For eBay, IDs are more flexible - no strict validation

  return { provider, productId, rawId, idError };
}

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  mainImageUrl: string | null;    // Best single image for display
  imageUrl: string | null;        // Backward compat
  imageUrls: string[];            // ALL images for product detail gallery (HIGH-RES)
  images: string[];               // Backward compat
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  reviewCount?: number | null;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  condition?: string;
  attributes?: Record<string, string>;
}

function mapDbItemToResponse(item: any): CatalogItem {
  const provider = item.provider || "rainforest";
  
  // Get all images from DB, preferring full list
  let allImages: string[] = [];
  if (item.images && Array.isArray(item.images)) {
    allImages = item.images.filter((img: any): img is string => typeof img === "string" && img.length > 0);
  }
  
  // Ensure image_url is first if not already in list
  if (item.image_url && !allImages.includes(item.image_url)) {
    allImages.unshift(item.image_url);
  }
  
  // Upgrade ALL gallery images to high-res and deduplicate
  allImages = upgradeGalleryImages(allImages, provider);
  
  const mainImage = allImages[0] || null;
  
  return {
    id: item.id,
    provider,
    providerProductId: item.provider_product_id,
    title: item.title || "",
    priceUsd: item.price_usd,
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    imageUrls: allImages, // ALL images for gallery (HIGH-RES)
    images: allImages,    // Backward compat
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    reviewCount: item.review_count,
    description: item.raw?.description || null,
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
  const envName = getEnvironmentFromRequest(req);
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  const deviceId = getDeviceId(req);

  const { provider, productId, rawId, idError } = parseProductId(url);

  const errorResponse = (code: string, message: string) => {
    console.log(`[CATALOG_PRODUCT] id=${productId || "MISSING"} provider=${provider || "unknown"} error=${code} durationMs=${Date.now() - startTime}`);
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      id: rawId || null,
      item: null,
      source: "error",
      error: { code, message },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  if (idError) return errorResponse("INVALID_ID", idError);
  
  // Supported providers
  const SUPPORTED_PROVIDERS = ["rainforest", "ebay"];
  if (provider && !SUPPORTED_PROVIDERS.includes(provider)) {
    return errorResponse("PROVIDER_NOT_SUPPORTED", `Provider '${provider}' not supported`);
  }

  const effectiveProvider = provider || "rainforest";
  const fullProductId = `${effectiveProvider}:${productId}`;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) return errorResponse("CONFIG_ERROR", "Service unavailable");

    const supabase = createClient(supabaseUrl, supabaseKey);

    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) return errorResponse("CATALOG_DISABLED", "Catalog not enabled");

    // ========== DB-FIRST: Check catalog_items ==========
    console.log(`[DETAIL_DB] id=${fullProductId} provider=${effectiveProvider} checking...`);
    
    const { data: dbItem } = await supabase
      .from("catalog_items")
      .select("*")
      .eq("id", fullProductId)
      .maybeSingle();

    if (dbItem) {
      const item = mapDbItemToResponse(dbItem);
      
      // HARD BLOCK: Check if item is disallowed
      const blockCheck = isDisallowedItem({
        title: item.title,
        productUrl: item.productUrl,
        category: item.category,
      });
      
      if (blockCheck.isDisallowed) {
        console.log(`[DETAIL_DB] id=${fullProductId} hit=false reason=BLOCKED`);
        return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
      }
      
      console.log(`[DETAIL_DB] id=${fullProductId} hit=true provider=${effectiveProvider} durationMs=${Date.now() - startTime}`);
      
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        id: fullProductId,
        item,
        source: "db",
        cached: true,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`[DETAIL_DB] id=${fullProductId} hit=false provider=${effectiveProvider} fetching_live...`);

    // ========== FALLBACK: Check legacy catalog_products (Rainforest only) ==========
    if (effectiveProvider === "rainforest") {
      const { data: legacyItem } = await supabase
        .from("catalog_products")
        .select("*")
        .eq("provider_product_id", productId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (legacyItem) {
        const rawData = legacyItem.raw as Record<string, any> | null;
        let rawImages: string[] = [];
        
        if (rawData?.processedImages && Array.isArray(rawData.processedImages)) {
          rawImages = rawData.processedImages;
        } else if (rawData?.images && Array.isArray(rawData.images)) {
          rawImages = rawData.images
            .map((i: any) => i?.large || i?.link || (typeof i === "string" ? i : null))
            .filter((url: any): url is string => !!url && url.startsWith("http"));
        }
        
        if (legacyItem.image_url && !rawImages.includes(legacyItem.image_url)) {
          rawImages.unshift(legacyItem.image_url);
        }
        
        // Upgrade ALL gallery images to high-res and deduplicate
        const images = upgradeGalleryImages(rawImages, "rainforest");
        const mainImage = images[0] || null;

        const item: CatalogItem = {
          id: fullProductId,
          provider: "rainforest",
          providerProductId: legacyItem.provider_product_id,
          title: legacyItem.title || "",
          priceUsd: legacyItem.price_usd > 0 ? legacyItem.price_usd : null,
          mainImageUrl: mainImage,
          imageUrl: mainImage,
          imageUrls: images,  // ALL images for gallery (HIGH-RES)
          images,             // Backward compat
          productUrl: legacyItem.product_url || null,
          inStock: legacyItem.in_stock ?? null,
          rating: legacyItem.rating || null,
          description: legacyItem.description || null,
          brand: legacyItem.brand || null,
        };

        console.log(`[CATALOG_PRODUCT] Legacy DB hit: id=${productId} imageCount=${images.length} durationMs=${Date.now() - startTime}`);

        return new Response(JSON.stringify({
          status: "success",
          env: envName,
          id: fullProductId,
          item,
          source: "db-legacy",
          cached: true,
          error: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ========== LIVE FETCH: Provider-specific API ==========
    if (effectiveProvider === "ebay") {
      // eBay product detail
      try {
        const ebayResult = await getEbayItem(supabase, productId!);
        
        if (!ebayResult.item) {
          console.log(`[CATALOG_PRODUCT] eBay item not found: id=${productId} debug=`, JSON.stringify(ebayResult.debug));
          return errorResponse("NOT_FOUND", "Product not found on eBay");
        }
        
        const ebayItem = ebayResult.item;
        
        // HARD BLOCK: Check if item is disallowed
        const blockCheck = isDisallowedItem({
          title: ebayItem.title,
          productUrl: ebayItem.productUrl,
        });
        
        if (blockCheck.isDisallowed) {
          console.log(`[CATALOG_PRODUCT] Blocked eBay item: id=${productId} reason=${blockCheck.reason}`);
          return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
        }
        
        // Cache to catalog_items
        const toCache = {
          id: fullProductId,
          provider: "ebay",
          provider_product_id: ebayItem.providerProductId,
          title: ebayItem.title,
          price_usd: ebayItem.priceUsd,
          image_url: ebayItem.imageUrl,
          images: ebayItem.images || [],
          product_url: ebayItem.productUrl,
          in_stock: ebayItem.inStock,
          rating: null,
          category: "uncategorized",
          tags: [],
          updated_at: new Date().toISOString(),
        };
        
        await supabase.from("catalog_items").upsert(toCache, { onConflict: "id" });
        
        // Upgrade ALL eBay gallery images to high-res and deduplicate
        const rawImages = ebayItem.images || [];
        if (ebayItem.imageUrl && !rawImages.includes(ebayItem.imageUrl)) {
          rawImages.unshift(ebayItem.imageUrl);
        }
        const allImages = upgradeGalleryImages(rawImages, "ebay");
        const mainImage = allImages[0] || null;
        
        const item: CatalogItem = {
          id: fullProductId,
          provider: "ebay",
          providerProductId: ebayItem.providerProductId,
          title: ebayItem.title || "",
          priceUsd: ebayItem.priceUsd,
          mainImageUrl: mainImage,
          imageUrl: mainImage,
          imageUrls: allImages,  // ALL images for gallery (HIGH-RES)
          images: allImages,     // Backward compat
          productUrl: ebayItem.productUrl || null,
          inStock: ebayItem.inStock ?? null,
          rating: null,
          description: ebayItem.description || null,
          condition: ebayItem.attributes?.["Condition"],
          attributes: ebayItem.attributes,
        };
        
        console.log(`[CATALOG_PRODUCT] eBay live fetch: id=${productId} imageCount=${allImages.length} durationMs=${Date.now() - startTime}`);
        
        return new Response(JSON.stringify({
          status: "success",
          env: envName,
          id: fullProductId,
          item,
          source: "live",
          cached: false,
          providerDebug: { ebay: ebayResult.debug },
          error: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
        
      } catch (err) {
        console.error(`[CATALOG_PRODUCT] eBay error: ${err}`);
        return errorResponse("PROVIDER_ERROR", "eBay service error");
      }
    }
    
    // ========== LIVE FETCH: Rainforest API (default) ==========
    const { product, error: rainforestError } = await fetchProductDetails(productId!, amazonDomain);

    if (rainforestError || !product) {
      return errorResponse(rainforestError || "NOT_FOUND", `Product not found on ${amazonDomain}`);
    }

    // HARD BLOCK: Check if live product is disallowed
    const liveBlockCheck = isDisallowedItem({
      title: product.title,
      productUrl: product.productUrl,
      categoryPath: product.categoryPath,
    });
    
    if (liveBlockCheck.isDisallowed) {
      console.log(`[CATALOG_PRODUCT] Blocked live: id=${productId} reason=${liveBlockCheck.reason}`);
      return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
    }

    // Cache to catalog_items
    const toCache = {
      id: fullProductId,
      provider: "rainforest",
      provider_product_id: product.providerProductId,
      title: product.title,
      price_usd: product.priceUsd,
      image_url: product.imageUrl,
      images: product.images || [],
      product_url: product.productUrl,
      in_stock: product.inStock,
      rating: product.rating,
      review_count: product.reviewCount,
      brand: product.brand,
      category: "uncategorized",
      tags: [],
      raw: product.raw,
      updated_at: new Date().toISOString(),
    };

    await supabase.from("catalog_items").upsert(toCache, { onConflict: "id" });

    // Upgrade ALL Rainforest gallery images to high-res and deduplicate
    const rawImages = product.images || [];
    if (product.imageUrl && !rawImages.includes(product.imageUrl)) {
      rawImages.unshift(product.imageUrl);
    }
    const allImages = upgradeGalleryImages(rawImages, "rainforest");
    const mainImage = allImages[0] || null;
    
    const item: CatalogItem = {
      id: fullProductId,
      provider: "rainforest",
      providerProductId: product.providerProductId,
      title: product.title || "",
      priceUsd: product.priceUsd,
      mainImageUrl: mainImage,
      imageUrl: mainImage,
      imageUrls: allImages,  // ALL images for gallery (HIGH-RES)
      images: allImages,     // Backward compat
      productUrl: product.productUrl || null,
      inStock: product.inStock ?? null,
      rating: product.rating ?? null,
      description: product.description || null,
      brand: product.brand || null,
    };

    console.log(`[CATALOG_PRODUCT] Live fetch: id=${productId} imageCount=${allImages.length} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      id: fullProductId,
      item,
      source: "live",
      cached: false,
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
