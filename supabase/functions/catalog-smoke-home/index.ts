/**
 * catalog-smoke-home - Guaranteed valid 8-section mobile payload for testing
 * 
 * Returns a hardcoded valid response with 8 sections to test
 * if mobile can fetch and parse the expected structure correctly.
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

// 8 sections matching mobile app expectations
const MOBILE_SECTIONS = [
  { key: "phones", title_fr: "Téléphones", title_en: "Phones" },
  { key: "electronics", title_fr: "Électronique", title_en: "Electronics" },
  { key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles" },
  { key: "video_games", title_fr: "Jeux vidéo", title_en: "Video Games" },
  { key: "clothing_fashion", title_fr: "Vêtements et mode", title_en: "Clothing & Fashion" },
  { key: "home_garden", title_fr: "Maison et jardin", title_en: "Home & Garden" },
  { key: "toys", title_fr: "Jouets", title_en: "Toys" },
  { key: "sporting_goods", title_fr: "Articles de sport", title_en: "Sporting Goods" },
];

// Generate a fake test item for a section
function createTestItem(sectionKey: string, index: number) {
  return {
    id: `amazon_B0TEST${sectionKey.toUpperCase()}${index}`,
    provider: "amazon",
    provider_product_id: `B0TEST${sectionKey.toUpperCase()}${index}`,
    title: `Smoke Test Item - ${sectionKey} #${index + 1}`,
    price_usd: 99.99,
    priceUsd: 99.99,
    currency: "USD",
    image_url: `https://via.placeholder.com/300x300?text=${encodeURIComponent(sectionKey)}`,
    imageUrl: `https://via.placeholder.com/300x300?text=${encodeURIComponent(sectionKey)}`,
    product_url: `https://amazon.com/dp/B0TEST${sectionKey.toUpperCase()}${index}`,
    productUrl: `https://amazon.com/dp/B0TEST${sectionKey.toUpperCase()}${index}`,
    in_stock: true,
  };
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

  // Build 8 sections with 3 test items each
  const sections = MOBILE_SECTIONS.map(sec => ({
    key: sec.key,
    title: sec.title_en, // Default title
    title_fr: sec.title_fr,
    title_en: sec.title_en,
    items: [
      createTestItem(sec.key, 0),
      createTestItem(sec.key, 1),
      createTestItem(sec.key, 2),
    ],
  }));

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  const response = {
    ok: true,
    sections,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    totalItems,
    hasMore: false,
    hasMoreCached: false,
    ttlSeconds: 3600,
    correlationId,
    meta: {
      client: "mobile",
      envUsed: "production",
      envRequested: "production",
      source: "smoke_test",
      isStale: false,
      correlationId,
      ts: Date.now(),
    },
  };

  console.log(`[SMOKE_HOME] done correlationId=${correlationId} ok=true sections=8 items=${totalItems}`);

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: corsHeaders,
  });
});
