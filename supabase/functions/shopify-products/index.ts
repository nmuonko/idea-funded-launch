const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// New Lovable-managed Shopify connection secrets
const STOREFRONT_DOMAIN =
  Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN") ||
  Deno.env.get("SHOPIFY_STORE_DOMAIN");
const STOREFRONT_TOKEN =
  Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN") ||
  Deno.env.get("SHOPIFY_STOREFRONT_TOKEN");
// Fallback: legacy admin token
const ADMIN_TOKEN = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN");

const API_VERSION = "2025-07";

const STOREFRONT_QUERY = `
  query GetProducts($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          description
          handle
          onlineStoreUrl
          options { name values }
          images(first: 10) {
            edges { node { url altText } }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price { amount currencyCode }
                weight
                weightUnit
                availableForSale
                selectedOptions { name value }
                image { url }
              }
            }
          }
        }
      }
    }
  }
`;

function gidToNumeric(gid: string): string {
  const m = gid.match(/(\d+)$/);
  return m ? m[1] : gid;
}

function weightToKg(weight: number, unit: string): number {
  if (!weight || weight <= 0) return 0.5;
  switch ((unit || "").toUpperCase()) {
    case "KILOGRAMS": return weight;
    case "GRAMS": return weight / 1000;
    case "POUNDS": return weight * 0.453592;
    case "OUNCES": return weight * 0.0283495;
    default: return weight;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!STOREFRONT_DOMAIN || (!STOREFRONT_TOKEN && !ADMIN_TOKEN)) {
    return new Response(JSON.stringify({
      error: "Shopify credentials not configured",
      products: [],
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 250);
    const domain = STOREFRONT_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");

    // Prefer Storefront API (works with new Lovable-managed connection)
    if (STOREFRONT_TOKEN) {
      const apiUrl = `https://${domain}/api/${API_VERSION}/graphql.json`;
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN,
        },
        body: JSON.stringify({ query: STOREFRONT_QUERY, variables: { first: limit } }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error("[shopify-products] Storefront error", res.status, body.slice(0, 300));
        return new Response(JSON.stringify({
          error: `Shopify Storefront error ${res.status}`,
          details: body.slice(0, 500),
          products: [],
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const json = await res.json();
      if (json.errors) {
        console.error("[shopify-products] GraphQL errors", JSON.stringify(json.errors).slice(0, 300));
        return new Response(JSON.stringify({
          error: "GraphQL errors",
          details: json.errors,
          products: [],
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const edges = json?.data?.products?.edges || [];
      const products = edges
        .map((e: any) => e.node)
        .filter((p: any) => p?.variants?.edges?.length > 0)
        .map((p: any) => {
          const variantNodes = (p.variants?.edges || []).map((e: any) => e.node);
          const v = variantNodes[0];
          const basePrice = Number(v?.price?.amount) || 0;
          const weightKg = weightToKg(Number(v?.weight) || 0, v?.weightUnit);
          const productImages = (p.images?.edges || []).map((i: any) => i.node?.url).filter(Boolean);
          const variantImages = variantNodes.map((vn: any) => vn?.image?.url).filter(Boolean);
          const images = Array.from(new Set([...productImages, ...variantImages]));
          const imageUrl = images[0] || "";
          const numericId = gidToNumeric(p.id);
          const productUrl =
            p.onlineStoreUrl || `https://${domain}/products/${p.handle}`;
          const variants = variantNodes.map((vn: any) => ({
            id: gidToNumeric(vn.id),
            gid: vn.id,
            title: vn.title,
            price_usd: Number(vn?.price?.amount) || 0,
            available: !!vn?.availableForSale,
            selected_options: (vn.selectedOptions || []).map((o: any) => ({ name: o.name, value: o.value })),
            image_url: vn?.image?.url || null,
          }));
          return {
            id: String(numericId),
            country: "china",
            title: p.title,
            image_url: imageUrl,
            images,
            product_url: productUrl,
            base_price_usd: basePrice,
            est_weight_kg: weightKg,
            description: p.description ? String(p.description).trim() : null,
            measurements: null,
            in_stock: !!v?.availableForSale,
            options: (p.options || []).map((o: any) => ({ name: o.name, values: o.values })),
            variants,
          };
        });

      return new Response(JSON.stringify({ products, count: products.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Legacy fallback: Admin REST API
    const apiUrl = `https://${domain}/admin/api/2024-10/products.json?limit=${limit}&status=active`;
    const res = await fetch(apiUrl, {
      headers: {
        "X-Shopify-Access-Token": ADMIN_TOKEN!,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[shopify-products] Admin API error", res.status, body.slice(0, 300));
      return new Response(JSON.stringify({
        error: `Shopify API error ${res.status}`,
        details: body.slice(0, 500),
        products: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await res.json();
    const products = (data.products || [])
      .filter((p: any) => p.variants && p.variants.length > 0)
      .map((p: any) => {
        const v = p.variants[0];
        const basePrice = Number(v.price) || 0;
        const grams = Number(v.grams) || 0;
        const weightKg = grams > 0 ? grams / 1000 : 0.5;
        const images = (p.images || []).map((i: any) => i.src).filter(Boolean);
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
