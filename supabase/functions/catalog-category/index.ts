/**
 * Catalog Category Endpoint
 * Get products within a category
 * GET /catalog-category?id=...&page=...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { CatalogProduct } from "../_shared/catalogProviders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300",
};

const PAGE_SIZE = 20;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    const categoryId = url.searchParams.get("id");
    const page = parseInt(url.searchParams.get("page") || "1", 10);

    if (!categoryId) {
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
      fn: "catalog-category",
      env: envName,
      categoryId,
      page,
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

    // Fetch category info
    const { data: category, error: catError } = await supabase
      .from("catalog_categories")
      .select("id, name, icon_url, parent_id")
      .eq("id", categoryId)
      .maybeSingle();

    if (catError || !category) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Category not found",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch products in category from cache
    // We check if category_path contains the category name
    const { data: products, error: prodError } = await supabase
      .from("catalog_products")
      .select(`
        id,
        provider_id,
        provider_product_id,
        title,
        brand,
        image_url,
        product_url,
        price_usd,
        currency,
        in_stock,
        rating,
        review_count
      `)
      .contains("category_path", [category.name])
      .gt("expires_at", new Date().toISOString())
      .order("rating", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (prodError) {
      console.error("[catalog-category] DB error:", prodError);
      throw new Error("Database error");
    }

    const mappedProducts: CatalogProduct[] = (products || []).map((p) => ({
      id: p.id,
      providerProductId: p.provider_product_id,
      providerId: p.provider_id,
      title: p.title || "",
      brand: p.brand,
      imageUrl: p.image_url,
      productUrl: p.product_url || "",
      priceUsd: Number(p.price_usd) || 0,
      currency: p.currency || "USD",
      inStock: p.in_stock ?? true,
      rating: p.rating ? Number(p.rating) : undefined,
      reviewCount: p.review_count,
    }));

    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "catalog-category",
      env: envName,
      categoryId,
      categoryName: category.name,
      productCount: mappedProducts.length,
      durationMs: Date.now() - startTime,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        category: {
          id: category.id,
          name: category.name,
          iconUrl: category.icon_url,
        },
        page,
        pageSize: PAGE_SIZE,
        products: mappedProducts,
        hasMore: mappedProducts.length === PAGE_SIZE,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (err) {
    console.error("[catalog-category] Error:", err);
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
