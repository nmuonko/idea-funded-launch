// Shopify webhook receiver. Public endpoint (verify_jwt = false).
// Topics handled: products/create, products/update, products/delete,
// inventory_levels/update, collections/update, collections/delete.
// HMAC verification: enabled when SHOPIFY_API_SECRET_KEY is set; otherwise logged only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-topic, x-shopify-shop-domain, x-shopify-hmac-sha256",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET_KEY"); // optional for now
const SHOP_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")!;
const ADMIN_TOKEN = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN")!;
const API_VERSION = "2025-07";
const PROVIDER = "shopify";

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function verifyHmac(rawBody: string, hmac: string | null): Promise<boolean> {
  if (!SHOPIFY_API_SECRET || !hmac) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === hmac;
}

function gidNum(v: any): string {
  const s = String(v ?? "");
  const m = s.match(/(\d+)$/);
  return m ? m[1] : s;
}

const SINGLE_PRODUCT_QUERY = `
  query P($id: ID!) {
    product(id: $id) {
      id handle title descriptionHtml vendor productType tags status onlineStoreUrl totalInventory
      featuredImage { url }
      images(first: 10) { edges { node { url } } }
      variants(first: 50) {
        edges { node {
          id title sku price availableForSale inventoryQuantity
          inventoryItem { id } selectedOptions { name value }
        } }
      }
    }
  }`;

async function fetchAndUpsertProduct(productIdNum: string) {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": ADMIN_TOKEN },
    body: JSON.stringify({
      query: SINGLE_PRODUCT_QUERY,
      variables: { id: `gid://shopify/Product/${productIdNum}` },
    }),
  });
  const json = await res.json();
  const p = json?.data?.product;
  if (!p) return false;

  const variants = p.variants.edges.map((e: any) => e.node);
  const firstVariant = variants[0];
  const priceUsd = firstVariant ? parseFloat(firstVariant.price) : null;
  const images = (p.images.edges || []).map((e: any) => e.node.url).filter(Boolean);
  const now = new Date().toISOString();

  const row = {
    id: `${PROVIDER}_${productIdNum}`,
    provider: PROVIDER,
    provider_product_id: productIdNum,
    title: p.title,
    brand: p.vendor || null,
    image_url: p.featuredImage?.url || images[0] || null,
    images,
    product_url: p.onlineStoreUrl || `https://${SHOP_DOMAIN}/products/${p.handle}`,
    price_usd: priceUsd,
    currency: "USD",
    in_stock: (p.totalInventory ?? 0) > 0 || variants.some((v: any) => v.availableForSale),
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
  };
  const { error } = await sb().from("catalog_items").upsert(row, { onConflict: "id" });
  if (error) console.error("[shopify-webhooks] product upsert", error.message);
  return !error;
}

async function handleTopic(topic: string, payload: any) {
  const client = sb();
  switch (topic) {
    case "products/create":
    case "products/update": {
      const idNum = gidNum(payload.admin_graphql_api_id || payload.id);
      await fetchAndUpsertProduct(idNum);
      break;
    }
    case "products/delete": {
      const idNum = gidNum(payload.id);
      await client.from("catalog_items").update({ is_active: false, in_stock: false, updated_at: new Date().toISOString() }).eq("id", `${PROVIDER}_${idNum}`);
      break;
    }
    case "inventory_levels/update": {
      const itemId = gidNum(payload.inventory_item_id);
      const locId = gidNum(payload.location_id);
      const available = Number(payload.available ?? 0);
      const { data: existing } = await client.from("shopify_inventory_levels").select("variant_id, product_id").eq("inventory_item_id", itemId).maybeSingle();
      await client.from("shopify_inventory_levels").upsert({
        inventory_item_id: itemId,
        location_id: locId,
        available,
        variant_id: existing?.variant_id ?? null,
        product_id: existing?.product_id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "inventory_item_id,location_id" });
      // Refresh product stock if we know the product
      if (existing?.product_id) {
        await fetchAndUpsertProduct(existing.product_id);
      }
      break;
    }
    case "collections/create":
    case "collections/update": {
      const idNum = gidNum(payload.admin_graphql_api_id || payload.id);
      await client.from("shopify_collections").upsert({
        id: idNum,
        handle: payload.handle,
        title: payload.title,
        description: payload.body_html || null,
        image_url: payload.image?.src || null,
        product_ids: [],
        updated_at_shopify: payload.updated_at || new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }, { onConflict: "id" });
      break;
    }
    case "collections/delete": {
      await client.from("shopify_collections").delete().eq("id", gidNum(payload.id));
      break;
    }
    default:
      console.log(`[shopify-webhooks] unhandled topic ${topic}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  const topic = req.headers.get("x-shopify-topic") || "unknown";
  const shop = req.headers.get("x-shopify-shop-domain") || null;
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const rawBody = await req.text();

  if (!SHOPIFY_API_SECRET) {
    console.error("[shopify-webhooks] SHOPIFY_API_SECRET_KEY not configured; rejecting request");
    return new Response("server misconfigured", { status: 503, headers: corsHeaders });
  }
  const hmacValid = await verifyHmac(rawBody, hmac);
  if (!hmacValid) {
    console.warn("[shopify-webhooks] invalid HMAC", { topic, shop });
    return new Response("invalid hmac", { status: 401, headers: corsHeaders });
  }

  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch { /* ignore */ }

  // Log
  const client = sb();
  const { data: log } = await client.from("shopify_webhook_log").insert({
    topic, shop_domain: shop, payload, hmac_valid: hmacValid, processed: false,
  }).select("id").single();

  try {
    await handleTopic(topic, payload);
    if (log?.id) await client.from("shopify_webhook_log").update({ processed: true }).eq("id", log.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[shopify-webhooks] handler error", topic, msg);
    if (log?.id) await client.from("shopify_webhook_log").update({ error: msg }).eq("id", log.id);
  }

  // Always 200 so Shopify doesn't retry forever on transient handler errors
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
