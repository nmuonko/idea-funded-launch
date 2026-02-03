/**
 * Debug Search Endpoint
 * Shows raw results from eBay and Amazon without mixing/filtering
 * GET /catalog-debug-search?q=infiniti+qx80&limit=10
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { searchEbay } from "../_shared/ebayAdapter.ts";
import { searchRainforest } from "../_shared/rainforestAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
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

  // Create Supabase client for eBay token management
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`[DEBUG-SEARCH] Query: "${query}", Limit: ${limit}`);

  // Parallel fetch from both providers
  const [ebayResult, amazonResult] = await Promise.allSettled([
    searchEbay(supabase, query, 1, limit),
    searchRainforest(query, 1, limit, "amazon.com"),
  ]);

  // Extract eBay data
  const ebayData = ebayResult.status === "fulfilled" ? ebayResult.value : null;
  const ebayError = ebayResult.status === "rejected" ? String(ebayResult.reason) : null;

  // Extract Amazon data
  const amazonData = amazonResult.status === "fulfilled" ? amazonResult.value : null;
  const amazonError = amazonResult.status === "rejected" ? String(amazonResult.reason) : null;

  const response = {
    query,
    timestamp: new Date().toISOString(),
    
    ebay: {
      status: ebayResult.status,
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
      status: amazonResult.status,
      count: amazonData?.products?.length || 0,
      rawTotal: amazonData?.total || 0,
      hasMore: amazonData?.hasMore || false,
      error: amazonError || amazonData?.error || null,
      items: (amazonData?.products || []).map(item => ({
        title: item.title,
        price: item.priceUsd,
        currency: item.currency || "USD",
        provider: "amazon",
        id: item.providerProductId,
        url: item.productUrl,
        image: item.imageUrl,
      })),
    },
  };

  console.log(`[DEBUG-SEARCH] eBay: ${response.ebay.count}/${response.ebay.rawTotal}, Amazon: ${response.amazon.count}/${response.amazon.rawTotal}`);

  return new Response(
    JSON.stringify(response, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
