/**
 * Debug Search Endpoint
 * Shows raw results from eBay (live) and Amazon (DB-only, no live calls)
 * GET /catalog-debug-search?q=infiniti+qx80&limit=10
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { searchEbay } from "../_shared/ebayAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 30);

  if (!query) {
    return new Response(
      JSON.stringify({ error: "Missing ?q= parameter" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`[DEBUG-SEARCH] Query: "${query}", Limit: ${limit}`);

  // eBay: live search
  const ebayResult = await Promise.allSettled([
    searchEbay(supabase, query, 1, limit),
  ]);

  const ebayData = ebayResult[0].status === "fulfilled" ? ebayResult[0].value : null;
  const ebayError = ebayResult[0].status === "rejected" ? String(ebayResult[0].reason) : null;

  // Amazon: DB-ONLY (no live Rainforest calls)
  const searchTokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  let amazonQuery = supabase
    .from("catalog_items")
    .select("id, title, price_usd, image_url, product_url, provider, provider_product_id, rating")
    .in("provider", ["rainforest", "amazon"])
    .eq("is_active", true);

  if (searchTokens.length > 0) {
    const topTokens = [...searchTokens].sort((a, b) => b.length - a.length).slice(0, 3);
    for (const token of topTokens) {
      amazonQuery = amazonQuery.ilike("title", `%${token}%`);
    }
  } else {
    amazonQuery = amazonQuery.ilike("title", `%${query}%`);
  }

  const { data: amazonDbItems, error: amazonDbError } = await amazonQuery
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(limit);

  const response = {
    query,
    timestamp: new Date().toISOString(),
    
    ebay: {
      status: ebayResult[0].status,
      count: ebayData?.items?.length || 0,
      rawTotal: ebayData?.total || 0,
      hasMore: ebayData?.hasMore || false,
      error: ebayError || ebayData?.debug?.error || null,
      items: (ebayData?.items || []).map(item => ({
        title: item.title,
        price: item.priceUsd,
        currency: item.currency,
        provider: "ebay",
        id: item.providerProductId,
        url: item.productUrl,
        image: item.imageUrl,
      })),
    },

    amazon: {
      status: amazonDbError ? "rejected" : "fulfilled",
      source: "db_only",
      note: "Amazon is offline-only. No live Rainforest API calls from user requests.",
      count: amazonDbItems?.length || 0,
      error: amazonDbError?.message || null,
      items: (amazonDbItems || []).map(item => ({
        title: item.title,
        price: item.price_usd,
        currency: "USD",
        provider: item.provider,
        id: item.provider_product_id,
        url: item.product_url,
        image: item.image_url,
      })),
    },
  };

  console.log(`[DEBUG-SEARCH] eBay: ${response.ebay.count}/${response.ebay.rawTotal}, Amazon(DB): ${response.amazon.count}`);

  return new Response(
    JSON.stringify(response, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
