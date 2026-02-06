/**
 * catalog-smoke-product - Smoke test for product detail to prevent regressions
 * 
 * Validates:
 * 1. catalog-product endpoint returns ok:true for given ID
 * 2. Tests canonical ID formats (amazon_ASIN, ebay_v1|...)
 * 
 * GET /catalog-smoke-product?id=amazon_B0DQVHHTFN
 * GET /catalog-smoke-product (tests default sample IDs)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function generateCorrelationId(): string {
  return `csp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Sample canonical IDs to test if none provided
const SAMPLE_IDS = [
  "amazon_B0DQVHHTFN", // Samsung Galaxy
  "amazon_B0CS5S84GR", // iPhone
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  const url = new URL(req.url);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  console.log(`[SMOKE_PRODUCT] start correlationId=${correlationId}`);

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

    // Get ID to test from query param or use samples
    const testId = url.searchParams.get("id");
    const idsToTest = testId ? [testId] : SAMPLE_IDS;
    
    const results: Array<{
      id: string;
      ok: boolean;
      hasProduct: boolean;
      source?: string;
      error?: string;
      ms: number;
    }> = [];

    for (const id of idsToTest) {
      const testStart = Date.now();
      
      try {
        // Call catalog-product with canonical ID (no provider param needed)
        const productUrl = `${supabaseUrl}/functions/v1/catalog-product?id=${encodeURIComponent(id)}`;
        
        const res = await fetch(productUrl, {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        });

        const data = await res.json();
        const testMs = Date.now() - testStart;

        results.push({
          id,
          ok: data.ok === true,
          hasProduct: !!(data.item || data.product),
          source: data.source,
          error: data.error?.message,
          ms: testMs,
        });

        console.log(`[SMOKE_PRODUCT] test id=${id} ok=${data.ok} source=${data.source} ms=${testMs}`);

      } catch (err) {
        const testMs = Date.now() - testStart;
        results.push({
          id,
          ok: false,
          hasProduct: false,
          error: String(err),
          ms: testMs,
        });
      }
    }

    const allPassed = results.every(r => r.ok && r.hasProduct);
    const ms = Date.now() - startTime;

    console.log(`[SMOKE_PRODUCT] done correlationId=${correlationId} ok=${allPassed} tested=${results.length} ms=${ms}`);

    return new Response(JSON.stringify({
      ok: allPassed,
      tested: results.length,
      passed: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
      correlationId,
      ms,
      ts: Date.now(),
    }), { 
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (err) {
    const ms = Date.now() - startTime;
    console.error(`[SMOKE_PRODUCT] error correlationId=${correlationId} error=${err} ms=${ms}`);
    
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
