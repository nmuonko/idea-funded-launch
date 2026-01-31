/**
 * Debug eBay Item Endpoint
 * Quick self-test for eBay API getItem integration - shows raw image sources
 * 
 * GET /debug-ebay-item?id=226415688103
 * 
 * Returns: raw image fields from eBay API response
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEbayToken } from "../_shared/ebayAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
};

const EBAY_ENDPOINTS = {
  production: "https://api.ebay.com/buy/browse/v1",
  sandbox: "https://api.sandbox.ebay.com/buy/browse/v1",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const itemId = url.searchParams.get("id") || "226415688103";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured",
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const environment = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";

    // Get token
    const { token, debug: tokenDebug } = await getEbayToken(supabase);
    
    if (!tokenDebug.ok) {
      return new Response(JSON.stringify({
        ok: false,
        tokenOk: false,
        error: tokenDebug.error,
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch item with PRODUCT fieldgroup
    const cleanId = itemId.startsWith("ebay:") ? itemId.slice(5) : itemId;
    const encodedId = cleanId.replace(/\|/g, "%7C");
    
    // Try with PRODUCT fieldgroup for more images
    const endpoint = `${EBAY_ENDPOINTS[environment]}/item/${encodedId}?fieldgroups=PRODUCT`;
    
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({
        ok: false,
        tokenOk: true,
        httpStatus: response.status,
        error: errorText.slice(0, 500),
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const item = await response.json();
    
    // Extract ALL image-related fields to debug
    const imageAnalysis = {
      // Primary image
      primaryImage: item.image?.imageUrl || null,
      
      // Additional images array
      additionalImages: item.additionalImages?.map((img: any) => img?.imageUrl) || [],
      additionalImagesCount: item.additionalImages?.length ?? 0,
      
      // Product catalog images (from PRODUCT fieldgroup)
      productImage: item.product?.image?.imageUrl || null,
      productAdditionalImages: item.product?.additionalImages?.map((img: any) => img?.imageUrl) || [],
      productAdditionalImagesCount: item.product?.additionalImages?.length ?? 0,
      
      // Item group images (multi-variation)
      itemGroupImage: item.primaryItemGroup?.itemGroupImage?.imageUrl || null,
      itemGroupAdditionalImages: item.primaryItemGroup?.itemGroupAdditionalImages?.map((img: any) => img?.imageUrl) || [],
      itemGroupAdditionalImagesCount: item.primaryItemGroup?.itemGroupAdditionalImages?.length ?? 0,
      
      // Gallery images (legacy)
      galleryImages: item.galleryImages?.map((img: any) => img?.imageUrl) || [],
      galleryImagesCount: item.galleryImages?.length ?? 0,
      
      // Flat images array
      imagesArray: item.images?.map((img: any) => typeof img === "string" ? img : img?.imageUrl) || [],
      imagesArrayCount: item.images?.length ?? 0,
      
      // Picture URLs (eBay-specific)
      pictureURLs: item.pictureURLs || [],
      pictureURLsCount: item.pictureURLs?.length ?? 0,
      
      // Thumbnail images
      thumbnailImages: item.thumbnailImages?.map((img: any) => img?.imageUrl) || [],
      thumbnailImagesCount: item.thumbnailImages?.length ?? 0,
    };
    
    // Calculate total unique images we can extract
    const allUrls = new Set<string>();
    const addUrl = (url: string | null | undefined) => {
      if (url && typeof url === "string") {
        const upgraded = url.replace(/s-l\d+/g, "s-l1600");
        allUrls.add(upgraded);
      }
    };
    
    addUrl(imageAnalysis.primaryImage);
    imageAnalysis.additionalImages.forEach(addUrl);
    addUrl(imageAnalysis.productImage);
    imageAnalysis.productAdditionalImages.forEach(addUrl);
    addUrl(imageAnalysis.itemGroupImage);
    imageAnalysis.itemGroupAdditionalImages.forEach(addUrl);
    imageAnalysis.galleryImages.forEach(addUrl);
    imageAnalysis.imagesArray.forEach(addUrl);
    imageAnalysis.pictureURLs.forEach(addUrl);
    
    const totalUniqueImages = allUrls.size;
    const allImageUrls = Array.from(allUrls);

    return new Response(JSON.stringify({
      ok: true,
      tokenOk: true,
      itemId: cleanId,
      title: item.title?.slice(0, 80),
      totalUniqueImages,
      allImageUrls,
      imageAnalysis,
      // Raw fields for debugging
      rawFields: {
        hasImage: !!item.image,
        hasAdditionalImages: !!item.additionalImages,
        hasProduct: !!item.product,
        hasPrimaryItemGroup: !!item.primaryItemGroup,
        hasGalleryImages: !!item.galleryImages,
        hasImagesArray: !!item.images,
        hasPictureURLs: !!item.pictureURLs,
        hasThumbnailImages: !!item.thumbnailImages,
      },
      durationMs: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[debug-ebay-item] Error:", errorMessage);
    
    return new Response(JSON.stringify({
      ok: false,
      tokenOk: false,
      error: errorMessage,
      durationMs: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
