// Full Shopify sync: products + collections + inventory -> catalog_items + shopify_* tables
// Trigger via cron, admin button, or one-off curl with x-cron-secret header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SHOP_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")!;
const ADMIN_TOKEN = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const API_VERSION = "2025-07";
const PROVIDER = "shopify";
const CACHE_TTL_DAYS = 30;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function adminGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors || json).slice(0, 500)}`);
  }
  return json.data;
}

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id handle title descriptionHtml vendor productType tags status onlineStoreUrl
          totalInventory
          featuredImage { url }
          images(first: 10) { edges { node { url } } }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 50) {
            edges { node {
              id title sku price availableForSale inventoryQuantity
              inventoryItem { id }
              selectedOptions { name value }
            } }
          }
        }
      }
    }
  }`;

const COLLECTIONS_QUERY = `
  query Collections($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id handle title descriptionHtml updatedAt
          image { url }
          products(first: 250) { edges { node { id } } }
        }
      }
    }
  }`;

function gidNum(gid: string): string {
  const m = String(gid || "").match(/(\d+)$/);
  return m ? m[1] : String(gid);
}

async function syncProducts(): Promise<{ count: number }> {
  const client = sb();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + CACHE_TTL_DAYS * 86400000).toISOString();
  let cursor: string | null = null;
  let total = 0;

  while (true) {
    const data = await adminGraphQL(PRODUCTS_QUERY, { cursor });
    const edges = data.products.edges as Array<{ node: any }>;
    const rows: any[] = [];
    const invRows: any[] = [];

    for (const { node: p } of edges) {
      const pidNum = gidNum(p.id);
      const variants = p.variants.edges.map((e: any) => e.node);
      const firstVariant = variants[0];
      const priceUsd = firstVariant ? parseFloat(firstVariant.price) : parseFloat(p.priceRangeV2?.minVariantPrice?.amount || "0") || null;
      const images = (p.images.edges || []).map((e: any) => e.node.url).filter(Boolean);
      const mainImage = p.featuredImage?.url || images[0] || null;
      const productUrl = p.onlineStoreUrl || `https://${SHOP_DOMAIN}/products/${p.handle}`;
      const inStock = (p.totalInventory ?? 0) > 0 || variants.some((v: any) => v.availableForSale);

      rows.push({
        id: `${PROVIDER}_${pidNum}`,
        provider: PROVIDER,
        provider_product_id: pidNum,
        title: p.title,
        brand: p.vendor || null,
        image_url: mainImage,
        images,
        product_url: productUrl,
        price_usd: priceUsd,
        currency: "USD",
        in_stock: inStock,
        is_active: p.status === "ACTIVE",
        is_disallowed: false,
        category_key: p.productType ? p.productType.toLowerCase() : null,
        unified_category: p.productType ? p.productType.toLowerCase() : null,
        tags: Array.isArray(p.tags) ? p.tags : (typeof p.tags === "string" ? p.tags.split(",").map((s: string) => s.trim()) : []),
        data_updated_at: now,
        price_updated_at: now,
        last_seen_at: now,
        last_checked_at: now,
        updated_at: now,
        expires_at: expires,
        metadata: {
          shopify: {
            handle: p.handle,
            description_html: p.descriptionHtml,
            variants: variants.map((v: any) => ({
              id: v.id,
              variant_id_num: gidNum(v.id),
              title: v.title,
              sku: v.sku,
              price: v.price,
              available: v.availableForSale,
              quantity: v.inventoryQuantity,
              options: v.selectedOptions,
            })),
          },
        },
      });

      for (const v of variants) {
        if (v.inventoryItem?.id) {
          invRows.push({
            inventory_item_id: gidNum(v.inventoryItem.id),
            location_id: "primary",
            available: v.inventoryQuantity ?? 0,
            variant_id: gidNum(v.id),
            product_id: pidNum,
            updated_at: now,
          });
        }
      }
    }

    if (rows.length) {
      const { error } = await client.from("catalog_items").upsert(rows, { onConflict: "id" });
      if (error) console.error("[shopify-sync] catalog_items upsert error", error.message);
      total += rows.length;
    }
    if (invRows.length) {
      const { error } = await client.from("shopify_inventory_levels").upsert(invRows, { onConflict: "inventory_item_id,location_id" });
      if (error) console.error("[shopify-sync] inventory upsert error", error.message);
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return { count: total };
}

async function syncCollections(): Promise<{ count: number }> {
  const client = sb();
  let cursor: string | null = null;
  let total = 0;
  while (true) {
    const data = await adminGraphQL(COLLECTIONS_QUERY, { cursor });
    const rows = data.collections.edges.map(({ node: c }: any) => ({
      id: gidNum(c.id),
      handle: c.handle,
      title: c.title,
      description: c.descriptionHtml || null,
      image_url: c.image?.url || null,
      product_ids: (c.products?.edges || []).map((e: any) => gidNum(e.node.id)),
      updated_at_shopify: c.updatedAt,
      synced_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await client.from("shopify_collections").upsert(rows, { onConflict: "id" });
      if (error) console.error("[shopify-sync] collections upsert error", error.message);
      total += rows.length;
    }
    if (!data.collections.pageInfo.hasNextPage) break;
    cursor = data.collections.pageInfo.endCursor;
  }
  return { count: total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: cron secret OR service role
  const cronHeader = req.headers.get("x-cron-secret");
  const auth = req.headers.get("authorization") || "";
  const isAuthorized =
    (CRON_SECRET && cronHeader === CRON_SECRET) ||
    auth.includes(SERVICE_ROLE);
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const started = Date.now();
    const [products, collections] = await Promise.all([syncProducts(), syncCollections()]);
    const ms = Date.now() - started;
    console.log(`[shopify-sync] done products=${products.count} collections=${collections.count} ms=${ms}`);
    return new Response(JSON.stringify({ ok: true, products: products.count, collections: collections.count, ms }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[shopify-sync] failed", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
