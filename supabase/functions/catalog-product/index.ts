/**
 * Catalog Product Details Endpoint - DB-First with Live Fallback (SDK-Free)
 * 
 * GET /catalog-product?id=rainforest:B0GCRKG9N1
 * GET /catalog-product?asin=B0GCRKG9N1
 * POST /catalog-product { provider, id }
 * 
 * DB-First Strategy:
 * - First check catalog_items table (preloaded data)
 * - If not found, fetch from Rainforest/eBay and cache
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 * 
 * SDK-FREE: Uses lightweight PostgREST client to avoid bundler timeouts.
 */

import { createAdminPostgrestClient, PostgrestClient } from "../_shared/postgrest.ts";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";
import { fetchProductDetails } from "../_shared/rainforestAdapter.ts";
import { getEbayItem } from "../_shared/ebayAdapter.ts";
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "public, max-age=300",
};

/**
 * Upgrade ALL gallery images to high-resolution for product detail view
 */
function upgradeGalleryImages(images: string[], provider: string): string[] {
  if (!images || !Array.isArray(images)) return [];
  
  const seen = new Set<string>();
  const upgraded: string[] = [];
  
  for (const url of images) {
    if (!url || typeof url !== "string") continue;
    
    let upgradedUrl: string;
    
    if (provider === "ebay" || url.includes("ebayimg.com") || url.includes("i.ebayimg")) {
      upgradedUrl = upgradeEbayImageToHighRes(url);
    } else if (provider === "rainforest" || url.includes("amazon") || url.includes("media-amazon") || url.includes("ssl-images-amazon")) {
      upgradedUrl = upgradeAmazonImageToHighRes(url);
    } else {
      upgradedUrl = url;
    }
    
    if (!seen.has(upgradedUrl)) {
      seen.add(upgradedUrl);
      upgraded.push(upgradedUrl);
    }
  }
  
  return upgraded;
}

function validateAsin(asin: string): string | null {
  if (!asin || asin.length === 0) return "ASIN is required";
  if (asin.length !== 10) return `ASIN must be 10 characters (got ${asin.length})`;
  if (!/^[A-Z0-9]+$/i.test(asin)) return "ASIN must be alphanumeric (A-Z, 0-9)";
  return null;
}

function isLikelyEbayId(id: string): boolean {
  return id.startsWith("v1|") || id.includes("|") || /^\d{12,}$/.test(id);
}

function isLikelyAsin(id: string): boolean {
  return /^[A-Z0-9]{10}$/i.test(id);
}

function parseProductId(url: URL): { provider: string | null; productId: string | null; rawId: string; idError: string | null; externalProvider: string } {
  let provider: string | null = null;
  let productId: string | null = null;
  let externalProvider: string = "amazon"; // For response - always amazon or ebay

  const id = (url.searchParams.get("id") || "").trim();
  const providerParam = (url.searchParams.get("provider") || "").trim().toLowerCase();
  
  // Decode URL-encoded characters (e.g., %7C -> |)
  const decodedId = decodeURIComponent(id);
  const decodedLower = decodedId.toLowerCase();
  
  // Handle colon separator: "ebay:v1|..." or "rainforest:B0XYZ123" or "amazon:B0XYZ..."
  if (decodedId && decodedId.includes(":") && !decodedId.startsWith("v1")) {
    const colonIndex = decodedId.indexOf(":");
    const providerPart = decodedId.slice(0, colonIndex).toLowerCase();
    provider = providerPart;
    productId = decodedId.slice(colonIndex + 1) || null;
  }
  // Handle underscore prefix: "ebay_v1|..." or "amazon_B0XYZ..."
  else if (decodedLower.startsWith("ebay_")) {
    provider = "ebay";
    productId = decodedId.slice(5);
  }
  else if (decodedLower.startsWith("rainforest_")) {
    provider = "amazon"; // Normalize rainforest -> amazon for consistency
    productId = decodedId.slice(11);
  }
  else if (decodedLower.startsWith("amazon_")) {
    provider = "amazon";
    productId = decodedId.slice(7);
  }
  // Use explicit provider param if given
  else if (providerParam && decodedId) {
    // Accept amazon, rainforest, ebay - normalize rainforest to amazon
    provider = providerParam === "rainforest" ? "amazon" : providerParam;
    productId = decodedId;
  }
  // Fallback: try to infer from ID format
  else if (decodedId) {
    const asin = url.searchParams.get("asin")?.trim();
    const itemId = url.searchParams.get("itemId")?.trim();
    
    if (asin) {
      provider = "amazon";
      productId = asin.toUpperCase();
    } else if (itemId) {
      provider = "ebay";
      productId = itemId;
    } else if (isLikelyEbayId(decodedId)) {
      provider = "ebay";
      productId = decodedId;
    } else if (isLikelyAsin(decodedId)) {
      provider = "amazon";
      productId = decodedId.toUpperCase();
    } else {
      // Default to ebay for unknown formats (legacy behavior)
      provider = "ebay";
      productId = decodedId;
    }
  }

  // Normalize provider names: rainforest -> amazon (externally we use amazon/ebay only)
  if (provider === "rainforest") {
    provider = "amazon";
  }
  
  // Set external provider (for response) - only amazon or ebay
  externalProvider = provider === "ebay" ? "ebay" : "amazon";

  // Normalize ASIN to uppercase for amazon
  if (provider === "amazon" && productId) {
    productId = productId.toUpperCase();
  }

  // For internal lookups, we still use rainforest:ASIN format in DB
  const internalProvider = provider === "amazon" ? "rainforest" : provider;
  const rawId = internalProvider && productId ? `${internalProvider}:${productId}` : productId || id || "";
  
  let idError: string | null = null;
  if (!productId) {
    idError = "Product ID is required";
  } else if (provider === "amazon") {
    idError = validateAsin(productId);
  }

  return { provider, productId, rawId, idError, externalProvider };
}

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  mainImageUrl: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  images: string[];
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
  
  let allImages: string[] = [];
  if (item.images && Array.isArray(item.images)) {
    allImages = item.images.filter((img: any): img is string => typeof img === "string" && img.length > 0);
  }
  
  if (item.image_url && !allImages.includes(item.image_url)) {
    allImages.unshift(item.image_url);
  }
  
  allImages = upgradeGalleryImages(allImages, provider);
  const mainImage = allImages[0] || null;
  
  return {
    id: item.id,
    provider,
    providerProductId: item.provider_product_id,
    title: item.title || "",
    priceUsd: item.price_usd,
    mainImageUrl: mainImage,
    imageUrl: mainImage,
    imageUrls: allImages,
    images: allImages,
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  const url = new URL(req.url);
  const envName = getEnvironmentFromRequest(req);
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";

  // Parse product ID from GET params or POST body
  let provider: string | null = null;
  let productId: string | null = null;
  let rawId: string = "";
  let idError: string | null = null;
  
  // Try POST body first
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body.provider) provider = String(body.provider).toLowerCase();
      if (body.id) {
        productId = decodeURIComponent(String(body.id));
        rawId = provider && productId ? `${provider}:${productId}` : productId;
      }
      console.log(`[CATALOG_PRODUCT] start correlationId=${correlationId} method=POST provider=${provider} idRaw=${productId?.substring(0, 40)}`);
    } catch {
      // Fall through to GET params
    }
  }
  
  // Fall back to GET params
  let externalProvider: string = "amazon";
  if (!productId) {
    const parsed = parseProductId(url);
    provider = parsed.provider;
    productId = parsed.productId;
    rawId = parsed.rawId;
    idError = parsed.idError;
    externalProvider = parsed.externalProvider;
    console.log(`[CATALOG_PRODUCT] start correlationId=${correlationId} method=GET provider=${provider} externalProvider=${externalProvider} idRaw=${productId?.substring(0, 40)}`);
  }

  const errorResponse = (code: string, message: string, statusCode: number = 200) => {
    console.log(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} code=${code} error=${message} ms=${Date.now() - startTime}`);
    return new Response(JSON.stringify({
      ok: false,
      status: "error",
      env: envName,
      id: rawId || null,
      provider: externalProvider,
      correlationId,
      item: null,
      product: null,
      source: "error",
      error: { code, message },
    }), {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  if (idError) return errorResponse("INVALID_ID", idError, 400);
  if (!productId) return errorResponse("MISSING_ID", "Product ID is required", 400);
  
  // Accept amazon, rainforest, ebay - normalize amazon to rainforest for internal use
  const SUPPORTED_PROVIDERS = ["amazon", "rainforest", "ebay"];
  if (provider && !SUPPORTED_PROVIDERS.includes(provider)) {
    return errorResponse("PROVIDER_NOT_SUPPORTED", `Provider '${provider}' not supported. Use 'amazon' or 'ebay'.`, 400);
  }

  // Internal provider: amazon -> rainforest for DB lookups
  const internalProvider = (provider === "amazon" || provider === "rainforest" || !provider) ? "rainforest" : provider;
  const fullProductId = `${internalProvider}:${productId}`;

  try {
    // Create SDK-free DB client
    const db = createAdminPostgrestClient();

    // ========== DB-FIRST: Check catalog_items ==========
    console.log(`[DETAIL_DB] correlationId=${correlationId} id=${fullProductId} checking...`);
    
    const { data: dbItem } = await db
      .from("catalog_items")
      .select("*")
      .eq("id", fullProductId)
      .maybeSingle();

    if (dbItem) {
      const item = mapDbItemToResponse(dbItem);
      
      const blockCheck = isDisallowedItem({
        title: item.title,
        productUrl: item.productUrl,
        category: item.category,
      });
      
      if (blockCheck.isDisallowed) {
        console.log(`[DETAIL_DB] correlationId=${correlationId} BLOCKED`);
        return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
      }
      
      console.log(`[CATALOG_PRODUCT] success correlationId=${correlationId} source=db ms=${Date.now() - startTime}`);
      
      return new Response(JSON.stringify({
        ok: true,
        status: "success",
        env: envName,
        id: fullProductId,
        item,
        product: item,
        source: "db",
        cached: true,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`[DETAIL_DB] correlationId=${correlationId} miss, fetching_live...`);

    // ========== FALLBACK: Legacy catalog_products (Rainforest only) ==========
    if (internalProvider === "rainforest") {
      const { data: legacyItem } = await db
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
          imageUrls: images,
          images,
          productUrl: legacyItem.product_url || null,
          inStock: legacyItem.in_stock ?? null,
          rating: legacyItem.rating || null,
          description: legacyItem.description || null,
          brand: legacyItem.brand || null,
        };

        console.log(`[CATALOG_PRODUCT] success correlationId=${correlationId} source=db-legacy ms=${Date.now() - startTime}`);

        return new Response(JSON.stringify({
          ok: true,
          status: "success",
          env: envName,
          id: fullProductId,
          item,
          product: item,
          source: "db-legacy",
          cached: true,
          error: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ========== LIVE FETCH: eBay ==========
    if (internalProvider === "ebay") {
      try {
        // Pass db client (has .from() compatible interface)
        const ebayResult = await getEbayItem(db, productId!);
        
        if (!ebayResult.item) {
          console.log(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} ebay NOT_FOUND`);
          return errorResponse("NOT_FOUND", "Product not found on eBay");
        }
        
        const ebayItem = ebayResult.item;
        
        const blockCheck = isDisallowedItem({
          title: ebayItem.title,
          productUrl: ebayItem.productUrl,
        });
        
        if (blockCheck.isDisallowed) {
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
        
        await db.from("catalog_items").upsert(toCache, { onConflict: "id" });
        
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
          imageUrls: allImages,
          images: allImages,
          productUrl: ebayItem.productUrl || null,
          inStock: ebayItem.inStock ?? null,
          rating: null,
          description: ebayItem.description || null,
          condition: ebayItem.attributes?.["Condition"],
          attributes: ebayItem.attributes,
        };
        
        console.log(`[CATALOG_PRODUCT] success correlationId=${correlationId} source=live-ebay ms=${Date.now() - startTime}`);
        
        return new Response(JSON.stringify({
          ok: true,
          status: "success",
          env: envName,
          id: fullProductId,
          item,
          product: item,
          source: "live",
          cached: false,
          error: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
        
      } catch (err) {
        console.error(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} ebay error=${err}`);
        return errorResponse("PROVIDER_ERROR", "eBay service error");
      }
    }
    
    // ========== LIVE FETCH: Rainforest (default) ==========
    const { product, error: rainforestError } = await fetchProductDetails(productId!, amazonDomain);

    if (rainforestError || !product) {
      console.log(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} rainforest error=${rainforestError || "NOT_FOUND"}`);
      return errorResponse(rainforestError || "NOT_FOUND", `Product not found on ${amazonDomain}`);
    }

    const liveBlockCheck = isDisallowedItem({
      title: product.title,
      productUrl: product.productUrl,
      categoryPath: product.categoryPath,
    });
    
    if (liveBlockCheck.isDisallowed) {
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

    await db.from("catalog_items").upsert(toCache, { onConflict: "id" });

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
      imageUrls: allImages,
      images: allImages,
      productUrl: product.productUrl || null,
      inStock: product.inStock ?? null,
      rating: product.rating ?? null,
      description: product.description || null,
      brand: product.brand || null,
    };

    console.log(`[CATALOG_PRODUCT] success correlationId=${correlationId} source=live-rainforest ms=${Date.now() - startTime}`);

    return new Response(JSON.stringify({
      ok: true,
      status: "success",
      env: envName,
      id: fullProductId,
      item,
      product: item,
      source: "live",
      cached: false,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} error=${errorMessage} ms=${Date.now() - startTime}`);
    return errorResponse("INTERNAL_ERROR", "Product service error");
  }
});
