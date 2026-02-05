import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateCorrelationId(): string {
  return `ch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ProviderStatus {
  configured: boolean;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  itemCount?: number;
}

async function checkEbayHealth(): Promise<ProviderStatus> {
  const EBAY_APP_ID = Deno.env.get("EBAY_APP_ID");
  
  if (!EBAY_APP_ID) {
    return { configured: false, healthy: false, error: "EBAY_APP_ID not set" };
  }

  const startMs = Date.now();
  
  try {
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", "test");
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${EBAY_APP_ID}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    const latencyMs = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        configured: true,
        healthy: false,
        latencyMs,
        error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`,
      };
    }

    const data = await response.json();
    const itemCount = data.itemSummaries?.length || 0;

    return {
      configured: true,
      healthy: true,
      latencyMs,
      itemCount,
    };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      latencyMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkAmazonHealth(): Promise<ProviderStatus> {
  const RAINFOREST_API_KEY = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!RAINFOREST_API_KEY) {
    return { configured: false, healthy: false, error: "RAINFOREST_API_KEY not set" };
  }

  const startMs = Date.now();
  
  try {
    // Use a lightweight search request
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", RAINFOREST_API_KEY);
    url.searchParams.set("type", "search");
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("search_term", "test");
    url.searchParams.set("max_page", "1");

    const response = await fetch(url.toString());
    const latencyMs = Date.now() - startMs;

    if (!response.ok) {
      return {
        configured: true,
        healthy: false,
        latencyMs,
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    const itemCount = data.search_results?.length || 0;

    return {
      configured: true,
      healthy: true,
      latencyMs,
      itemCount,
    };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      latencyMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDatabaseHealth(): Promise<ProviderStatus> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      configured: false,
      healthy: false,
      error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set",
    };
  }

  const startMs = Date.now();

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from("catalog_sections")
      .select("key")
      .limit(1);

    const latencyMs = Date.now() - startMs;

    if (error) {
      return {
        configured: true,
        healthy: false,
        latencyMs,
        error: error.message,
      };
    }

    return {
      configured: true,
      healthy: true,
      latencyMs,
      itemCount: data?.length || 0,
    };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      latencyMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  console.log(`[CATALOG_HEALTH] start correlationId=${correlationId}`);

  try {
    // Check all providers in parallel
    const [ebayStatus, amazonStatus, dbStatus] = await Promise.all([
      checkEbayHealth(),
      checkAmazonHealth(),
      checkDatabaseHealth(),
    ]);

    const providerStatus = {
      ebay: ebayStatus,
      amazon: amazonStatus,
      database: dbStatus,
    };

    // Determine overall health
    const allHealthy = ebayStatus.healthy && dbStatus.healthy;
    // Note: Amazon is optional, so we don't require it for overall health

    const totalMs = Date.now() - startTime;

    console.log(`[CATALOG_HEALTH] done correlationId=${correlationId} ebay=${ebayStatus.healthy} amazon=${amazonStatus.healthy} db=${dbStatus.healthy} totalMs=${totalMs}`);

    if (allHealthy) {
      return jsonResponse({
        ok: true,
        providerStatus,
        correlationId,
        meta: {
          checkedAt: new Date().toISOString(),
          totalMs,
        },
      });
    } else {
      return jsonResponse({
        ok: false,
        error: "UNHEALTHY",
        message: "One or more required services are unhealthy",
        providerStatus,
        correlationId,
        meta: {
          checkedAt: new Date().toISOString(),
          totalMs,
        },
      });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[CATALOG_HEALTH][ERROR] correlationId=${correlationId} error=${errorMessage} stack=${stack}`);

    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Health check failed unexpectedly",
      correlationId,
    }, 200); // Always return 200 with structured error
  }
});
