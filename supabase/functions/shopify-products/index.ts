import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOREFRONT_DOMAIN =
  Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN") ||
  Deno.env.get("SHOPIFY_STORE_DOMAIN");
const STOREFRONT_TOKEN =
  Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN") ||
  Deno.env.get("SHOPIFY_STOREFRONT_TOKEN");
const ADMIN_TOKEN = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const API_VERSION = "2025-07";
const SHOPIFY_CHINA_PROVIDER = "shopify_china";
const CACHE_TTL_DAYS = 30;

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

function buildSupabase() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Upsert each Shopify product into catalog_items so we always have a cache.
async function cacheProducts(products: any[]) {
  if (!products.length) return;
  try {
    const sb = buildSupabase();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
    const rows = products.map((p) => ({
      id: `${SHOPIFY_CHINA_PROVIDER}_${p.id}`,
      provider: SHOPIFY_CHINA_PROVIDER,
      provider_product_id: String(p.id),
      title: p.title,
      image_url: p.image_url,
      images: p.images || [],
      product_url: p.product_url,
      price_usd: p.base_price_usd,
      currency: "USD",
      in_stock: !!p.in_stock,
      is_active: true,
      is_disallowed: false,
      category_key: "china",
      unified_category: "china",
      data_updated_at: now,
      price_updated_at: now,
      last_seen_at: now,
      last_checked_at: now,
      updated_at: now,
      expires_at: expires,
      metadata: {
        shopify: {
          description: p.description,
          options: p.options,
          variants: p.variants,
          est_weight_kg: p.est_weight_kg,
        },
      },
    }));
    const { error } = await sb.from("catalog_items").upsert(rows, { onConflict: "id" });
    if (error) console.error("[shopify-products] cache upsert error", error.message);
    else console.log(`[shopify-products] cached ${rows.length} products`);
  } catch (e) {
    console.error("[shopify-products] cache exception", e instanceof Error ? e.message : String(e));
  }
}

// Read cached products when Shopify is unavailable.
async function readCachedProducts(limit: number): Promise<any[]> {
  try {
    const sb = buildSupabase();
    const { data, error } = await sb
      .from("catalog_items")
      .select("provider_product_id, title, image_url, images, product_url, price_usd, in_stock, metadata")
      .eq("provider", SHOPIFY_CHINA_PROVIDER)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[shopify-products] cache read error", error.message);
      return [];
    }
    return (data || []).map((row: any) => {
      const meta = row.metadata?.shopify || {};
      return {
        id: String(row.provider_product_id),
        country: "china",
        title: row.title,
        image_url: row.image_url,
        images: Array.isArray(row.images) ? row.images : [],
        product_url: row.product_url,
        base_price_usd: Number(row.price_usd) || 0,
        est_weight_kg: Number(meta.est_weight_kg) || 0.8,
        description: meta.description || null,
        measurements: null,
        in_stock: !!row.in_stock,
        options: meta.options || [],
        variants: meta.variants || [],
      };
    });
  } catch (e) {
    console.error("[shopify-products] cache read exception", e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function respondFromCache(limit: number, reason: string, status: number, details?: unknown) {
  const cached = await readCachedProducts(limit);
  console.log(`[shopify-products] serving ${cached.length} cached products (reason=${reason})`);
  return new Response(JSON.stringify({
    products: cached,
    count: cached.length,
    cached: true,
    cache_reason: reason,
    upstream_status: status,
    details,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 250);

  if (!STOREFRONT_DOMAIN || (!STOREFRONT_TOKEN && !ADMIN_TOKEN)) {
    return await respondFromCache(limit, "credentials_missing", 0);
  }

  try {
    const domain = STOREFRONT_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");

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
        return await respondFromCache(limit, `storefront_${res.status}`, res.status, body.slice(0, 500));
      }

      const json = await res.json();
      if (json.errors) {
        console.error("[shopify-products] GraphQL errors", JSON.stringify(json.errors).slice(0, 300));
        return await respondFromCache(limit, "graphql_errors", 200, json.errors);
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
        })
        .filter((p: any) => p.image_url && p.images.length > 0);

      // Persist EVERY product so the catalog never goes empty.
      if (products.length > 0) {
        await cacheProducts(products);
      } else {
        // Live returned 0 — fall back to cache instead of returning empty.
        return await respondFromCache(limit, "live_empty", 200);
      }

      return new Response(JSON.stringify({ products, count: products.length, cached: false }), {
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
      return await respondFromCache(limit, `admin_${res.status}`, res.status, body.slice(0, 500));
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
      })
      .filter((p: any) => p.image_url && p.images.length > 0);

    if (products.length > 0) {
      await cacheProducts(products);
    } else {
      return await respondFromCache(limit, "admin_live_empty", 200);
    }

    return new Response(JSON.stringify({ products, count: products.length, cached: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[shopify-products] Exception:", msg);
    return await respondFromCache(limit, "exception", 0, msg);
  }
});
