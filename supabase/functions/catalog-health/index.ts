import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache for eBay OAuth token
let ebayTokenCache: { token: string; expiresAt: number } | null = null;

function generateCorrelationId(): string {
  return `ch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getEbayToken(): Promise<string | null> {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60000) {
    return ebayTokenCache.token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      await response.text();
      return null;
    }

    const data = await response.json();
    const token = data.access_token;
    const expiresIn = data.expires_in || 7200;

    ebayTokenCache = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return token;
  } catch {
    return null;
  }
}

interface ProviderStatus {
  configured: boolean;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  itemCount?: number;
}

async function checkEbayHealth(): Promise<ProviderStatus> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  
  if (!clientId || !clientSecret) {
    return { configured: false, healthy: false, error: "EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not set" };
  }

  const startMs = Date.now();
  
  try {
    const token = await getEbayToken();
    if (!token) {
      return {
        configured: true,
        healthy: false,
        latencyMs: Date.now() - startMs,
        error: "Failed to obtain eBay OAuth token",
      };
    }

    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", "test");
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
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

  // Skip live call - just check config
  return {
    configured: true,
    healthy: true,
    latencyMs: 0,
    error: undefined,
  };
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
    const response = await fetch(
      `${supabaseUrl}/rest/v1/catalog_sections?select=key&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  console.log(`[CATALOG_HEALTH] start correlationId=${correlationId}`);

  try {
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

    const allHealthy = ebayStatus.healthy && dbStatus.healthy;
    const totalMs = Date.now() - startTime;

    console.log(`[CATALOG_HEALTH] done correlationId=${correlationId} ebay=${ebayStatus.healthy} amazon=${amazonStatus.healthy} db=${dbStatus.healthy} totalMs=${totalMs}`);

    return jsonResponse({
      ok: allHealthy,
      error: allHealthy ? undefined : "UNHEALTHY",
      message: allHealthy ? undefined : "One or more required services are unhealthy",
      providerStatus,
      correlationId,
      meta: {
        checkedAt: new Date().toISOString(),
        totalMs,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[CATALOG_HEALTH][ERROR] correlationId=${correlationId} error=${errorMessage}`);

    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Health check failed unexpectedly",
      correlationId,
    });
  }
});
