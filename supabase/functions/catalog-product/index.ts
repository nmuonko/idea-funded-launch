/**
 * Catalog Product Detail Endpoint
 * Get a single product by ID
 * GET /catalog-product?id=...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { CatalogProduct } from "../_shared/catalogProviders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    const productId = url.searchParams.get("id");
    const includeEstimates = url.searchParams.get("includeEstimates") === "true";

    if (!productId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Query parameter 'id' is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Detect environment
    const envName = getEnvironmentFromRequest(req);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-product",
      env: envName,
      productId,
      catalogEnabled: isCatalogEnabled(envConfig),
    }));

    // Check if catalog is enabled for this environment
    if (!isCatalogEnabled(envConfig)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Catalog not enabled for this environment",
          env: envName,
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch product from cache
    const { data: productRow, error } = await supabase
      .from("catalog_products")
      .select(`
        id,
        provider_id,
        provider_product_id,
        title,
        brand,
        description,
        image_url,
        product_url,
        price_usd,
        currency,
        in_stock,
        category_path,
        rating,
        review_count,
        raw,
        catalog_providers!inner(name, display_name)
      `)
      .eq("id", productId)
      .maybeSingle();

    if (error) {
      console.error("[catalog-product] DB error:", error);
      throw new Error("Database error");
    }

    if (!productRow) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Product not found",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const product: CatalogProduct = {
      id: productRow.id,
      providerProductId: productRow.provider_product_id,
      providerId: productRow.provider_id,
      providerName: (productRow.catalog_providers as any)?.name,
      title: productRow.title || "",
      brand: productRow.brand,
      description: productRow.description,
      imageUrl: productRow.image_url,
      productUrl: productRow.product_url || "",
      priceUsd: Number(productRow.price_usd) || 0,
      currency: productRow.currency || "USD",
      inStock: productRow.in_stock ?? true,
      categoryPath: productRow.category_path,
      rating: productRow.rating ? Number(productRow.rating) : undefined,
      reviewCount: productRow.review_count,
      raw: productRow.raw,
    };

    // Build response
    const response: any = {
      success: true,
      product,
    };

    // Optional: include price estimates if requested
    if (includeEstimates) {
      // Fetch settings for estimates
      const { data: settings } = await supabase
        .from("settings")
        .select("markup_percent, shipping_base_fee_usd, shipping_percent")
        .limit(1)
        .maybeSingle();

      if (settings) {
        const markupPercent = Number(settings.markup_percent) || 15;
        const shippingBase = Number(settings.shipping_base_fee_usd) || 20;
        const shippingPercent = Number(settings.shipping_percent) || 10;

        const markupEstimateUsd = product.priceUsd * (markupPercent / 100);
        const shippingEstimateUsd = shippingBase + (product.priceUsd * (shippingPercent / 100));
        const totalEstimateUsd = product.priceUsd + markupEstimateUsd + shippingEstimateUsd;

        response.estimates = {
          priceUsd: product.priceUsd,
          markupEstimateUsd: Math.round(markupEstimateUsd * 100) / 100,
          shippingEstimateUsd: Math.round(shippingEstimateUsd * 100) / 100,
          totalEstimateUsd: Math.round(totalEstimateUsd * 100) / 100,
        };
      }
    }

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-product",
      env: envName,
      productId,
      found: true,
      priceUsd: product.priceUsd,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[catalog-product] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
