/**
 * catalog-smoke-home - Smoke test for home feed to prevent regressions
 * 
 * Validates:
 * 1. Cache exists and has items
 * 2. Every item.id starts with amazon_ or ebay_ (canonical format)
 * 3. Returns sample IDs for verification
 * 
 * GET /catalog-smoke-home
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function generateCorrelationId(): string {
  return `csh_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  console.log(`[SMOKE_HOME] start correlationId=${correlationId}`);

  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        correlationId,
        ts: Date.now(),
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Load cached feed from production
    const cacheRes = await fetch(
      `${supabaseUrl}/rest/v1/catalog_home_cache?id=eq.production:all`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );

    if (!cacheRes.ok || cacheRes.status === 406) {
      return new Response(JSON.stringify({
        ok: false,
        error: "No cache found for production:all",
        correlationId,
        ts: Date.now(),
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const cache = await cacheRes.json();
    const items = cache?.items || [];

    if (items.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Cache exists but has 0 items",
        correlationId,
        ts: Date.now(),
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Validate canonical IDs
    const invalidIds: string[] = [];
    const sampleIds: string[] = [];
    const amazonCount = { valid: 0, invalid: 0 };
    const ebayCount = { valid: 0, invalid: 0 };

    for (const item of items) {
      const id = item.id || "";
      
      if (id.startsWith("amazon_")) {
        // Validate ASIN format: amazon_<10 alphanumeric chars>
        const asin = id.slice(7);
        if (/^[A-Z0-9]{10}$/i.test(asin)) {
          amazonCount.valid++;
          if (sampleIds.length < 5) sampleIds.push(id);
        } else {
          amazonCount.invalid++;
          if (invalidIds.length < 5) invalidIds.push(id);
        }
      } else if (id.startsWith("ebay_")) {
        // Validate eBay format: ebay_<v1|...|... or 12+ digit numeric>
        const ebayId = id.slice(5);
        if (ebayId.startsWith("v1|") || /^\d{12,}$/.test(ebayId)) {
          ebayCount.valid++;
          if (sampleIds.length < 5) sampleIds.push(id);
        } else {
          ebayCount.invalid++;
          if (invalidIds.length < 5) invalidIds.push(id);
        }
      } else {
        invalidIds.push(id);
      }
    }

    const totalValid = amazonCount.valid + ebayCount.valid;
    const totalInvalid = amazonCount.invalid + ebayCount.invalid + invalidIds.length;
    const isHealthy = totalInvalid === 0 && totalValid > 0;

    const ms = Date.now() - startTime;
    console.log(`[SMOKE_HOME] done correlationId=${correlationId} ok=${isHealthy} totalItems=${items.length} valid=${totalValid} invalid=${totalInvalid} ms=${ms}`);

    return new Response(JSON.stringify({
      ok: isHealthy,
      totalItems: items.length,
      valid: totalValid,
      invalid: totalInvalid,
      amazonCount,
      ebayCount,
      sampleIds,
      invalidIds: invalidIds.slice(0, 5),
      cacheExpiresAt: cache.expires_at,
      correlationId,
      ms,
      ts: Date.now(),
    }), { 
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (err) {
    const ms = Date.now() - startTime;
    console.error(`[SMOKE_HOME] error correlationId=${correlationId} error=${err} ms=${ms}`);
    
    return new Response(JSON.stringify({
      ok: false,
      error: String(err),
      correlationId,
      ms,
      ts: Date.now(),
    }), { 
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
