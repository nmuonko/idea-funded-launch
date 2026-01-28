/**
 * Debug eBay Endpoint
 * Quick self-test for eBay API integration
 * 
 * GET /debug-ebay?q=iphone
 * 
 * Returns: { ok, tokenOk, status, itemCount, firstItem, error }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { debugEbaySearch } from "../_shared/ebayAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "iphone";
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") || "5", 10)));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({
        ok: false,
        tokenOk: false,
        itemCount: 0,
        error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured",
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if eBay credentials are configured
    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    const environment = Deno.env.get("EBAY_ENV") || "production";

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({
        ok: false,
        tokenOk: false,
        itemCount: 0,
        error: "EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured",
        config: {
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
          environment,
        },
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run the debug search
    const result = await debugEbaySearch(supabase, query, limit);

    return new Response(JSON.stringify({
      ...result,
      query,
      limit,
      environment,
      durationMs: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[debug-ebay] Error:", errorMessage);
    
    return new Response(JSON.stringify({
      ok: false,
      tokenOk: false,
      itemCount: 0,
      error: errorMessage,
      durationMs: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
