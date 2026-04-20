const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
const ADMIN_TOKEN = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN");
const API_VERSION = "2024-10";

interface ShopifyImage { src: string }
interface ShopifyVariant {
  id: number;
  price: string;
  grams: number;
  inventory_quantity?: number;
}
interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  handle: string;
  status: string;
  images: ShopifyImage[];
  image: ShopifyImage | null;
  variants: ShopifyVariant[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!STORE_DOMAIN || !ADMIN_TOKEN) {
    return new Response(JSON.stringify({
      error: "Shopify credentials not configured",
      products: [],
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 250);

    const domain = STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const apiUrl = `https://${domain}/admin/api/${API_VERSION}/products.json?limit=${limit}&status=active`;

    const res = await fetch(apiUrl, {
      headers: {
        "X-Shopify-Access-Token": ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[shopify-products] API error", res.status, body);
      return new Response(JSON.stringify({
        error: `Shopify API error ${res.status}`,
        details: body.slice(0, 500),
        products: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await res.json() as { products: ShopifyProduct[] };

    const products = (data.products || [])
      .filter((p) => p.variants && p.variants.length > 0)
      .map((p) => {
        const v = p.variants[0];
        const basePrice = Number(v.price) || 0;
        const grams = Number(v.grams) || 0;
        const weightKg = grams > 0 ? grams / 1000 : 0.5; // default 500g if missing
        const images = (p.images || []).map((i) => i.src).filter(Boolean);
        const imageUrl = p.image?.src || images[0] || "";
        return {
          id: String(p.id),
          country: "china",
          title: p.title,
          image_url: imageUrl,
          images,
          product_url: `https://${domain}/products/${p.handle}`,
          base_price_usd: basePrice,
          est_weight_kg: weightKg,
          description: p.body_html ? p.body_html.replace(/<[^>]+>/g, "").trim() : null,
          measurements: null,
          in_stock: (v.inventory_quantity ?? 1) > 0,
        };
      });

    return new Response(JSON.stringify({ products, count: products.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[shopify-products] Exception:", msg);
    return new Response(JSON.stringify({ error: msg, products: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
