/**
 * catalog-smoke-home - Guaranteed valid payload for mobile testing
 * 
 * Returns a hardcoded valid response with 1 fake item to test
 * if mobile can fetch and parse correctly - independent of actual data.
 * 
 * GET /catalog-smoke-home
 * 
 * No auth required.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type",
  "Content-Type": "application/json; charset=utf-8",
};

function generateCorrelationId(): string {
  return `csh_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

Deno.serve(async (req) => {
  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    });
  }

  const correlationId = generateCorrelationId();
  console.log(`[SMOKE_HOME] start correlationId=${correlationId}`);

  // Always return a guaranteed valid payload with 1 fake item
  const response = {
    ok: true,
    sections: [
      {
        key: "featured",
        title: "",
        title_en: "",
        title_fr: "",
        hideTitle: true,
        items: [
          {
            id: "amazon_B0TESTTEST0",
            provider: "amazon",
            provider_product_id: "B0TESTTEST0",
            title: "Smoke Test Item - If you see this, fetch/parse works!",
            price_usd: 1.00,
            priceUsd: 1.00,
            currency: "USD",
            image_url: "https://via.placeholder.com/300x300?text=Smoke+Test",
            imageUrl: "https://via.placeholder.com/300x300?text=Smoke+Test",
            product_url: "https://amazon.com/dp/B0TESTTEST0",
            productUrl: "https://amazon.com/dp/B0TESTTEST0",
            in_stock: true,
          },
        ],
      },
    ],
    meta: {
      source: "smoke_test",
      isStale: false,
      correlationId,
      ts: Date.now(),
    },
  };

  console.log(`[SMOKE_HOME] done correlationId=${correlationId} ok=true items=1`);

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: corsHeaders,
  });
});
