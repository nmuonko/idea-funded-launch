import { createClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "product-images";
const FOLDER = "share-previews";
const DEFAULT_FRONTEND = "https://afrishop-usa.com";
const DEFAULT_OG_IMAGE = "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f6837956-cb37-470d-abe4-1d3a6dc2112b/id-preview-a5a94eb4--be032233-aa83-4242-8bb0-99d7374821f2.lovable.app-1771132505550.png";
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SharePreviewProduct = {
  id: string;
  title: string | null;
  image_url: string | null;
  total_price_usd: number | null;
  description_fr: string | null;
  gallery_images: string[] | null;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

function isHttpsUrl(value: string | null | undefined): value is string {
  return !!value && /^https:\/\//i.test(value);
}

function pickShareImage(product: SharePreviewProduct): string {
  const gallery = Array.isArray(product.gallery_images) ? product.gallery_images : [];
  const candidates = [product.image_url, ...gallery].filter(isHttpsUrl);
  return candidates[0] || DEFAULT_OG_IMAGE;
}

function buildSharePageHtml(product: SharePreviewProduct, frontendUrl: string, publicUrl: string): string {
  const title = trunc(normalizeText(product.title) || "Produit AfriShop", 110);
  const description = normalizeText(product.description_fr)
    ? trunc(normalizeText(product.description_fr), 180)
    : `Prix: $${Math.ceil(product.total_price_usd || 0)} · Livraison en RDC incluse`;
  const ogImage = pickShareImage(product);
  const productPageUrl = `${frontendUrl}/share/hp/${product.id}`;
  const price = Math.ceil(product.total_price_usd || 0);

  return `<!DOCTYPE html>
<html lang="fr" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="noindex, nofollow" />
<link rel="canonical" href="${esc(publicUrl)}" />
<meta property="og:type" content="product" />
<meta property="og:site_name" content="AfriShop" />
<meta property="og:locale" content="fr_FR" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />
<meta property="og:image:alt" content="${esc(title)}" />
<meta property="og:url" content="${esc(publicUrl)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
</head>
<body style="margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b0b0b;color:#ffffff;">
  <main style="max-width:720px;margin:0 auto;padding:32px 20px 48px;">
    <div style="background:#151515;border:1px solid rgba(255,255,255,.08);border-radius:24px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35);">
      <img src="${esc(ogImage)}" alt="${esc(title)}" style="display:block;width:100%;max-height:560px;object-fit:contain;background:#ffffff;" />
      <div style="padding:24px;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f59e0b;">AfriShop</p>
        <h1 style="margin:0 0 12px;font-size:32px;line-height:1.1;">${esc(title)}</h1>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:rgba(255,255,255,.82);">${esc(description)}</p>
        <p style="margin:0 0 24px;font-size:22px;font-weight:800;color:#34d399;">$${price} · Livraison en RDC incluse</p>
        <a href="${esc(productPageUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#f59e0b;color:#111827;text-decoration:none;font-weight:800;">Voir le produit</a>
      </div>
    </div>
  </main>
</body>
</html>`;
}

async function readRequestedIds(req: Request): Promise<{ ids: string[] | null; error?: string }> {
  const url = new URL(req.url);
  const queryIds = url.searchParams.getAll("id").map((value) => value.trim()).filter(Boolean);
  let requestedIds: string[] | null = queryIds.length > 0 ? queryIds : null;

  if (req.method !== "GET") {
    const rawBody = await req.text();
    if (rawBody.trim()) {
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { ids: null, error: "Invalid JSON body" };
      }

      if (body && typeof body === "object") {
        const record = body as { id?: unknown; ids?: unknown };
        if (typeof record.id === "string" && record.id.trim()) {
          requestedIds = [record.id.trim()];
        }
        if (record.ids !== undefined) {
          if (!Array.isArray(record.ids) || record.ids.some((value) => typeof value !== "string")) {
            return { ids: null, error: "ids must be an array of strings" };
          }
          requestedIds = record.ids.map((value) => value.trim()).filter(Boolean);
        }
      }
    }
  }

  if (requestedIds && requestedIds.some((id) => !uuidRegex.test(id))) {
    return { ids: null, error: "Invalid id format" };
  }

  return { ids: requestedIds ? [...new Set(requestedIds)] : null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const frontendUrl = Deno.env.get("FRONTEND_BASE_URL") || DEFAULT_FRONTEND;

  const { ids, error: validationError } = await readRequestedIds(req);
  if (validationError) {
    return new Response(JSON.stringify({ error: validationError }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let query = supabase
    .from("hot_products_showcase")
    .select("id, title, image_url, total_price_usd, description_fr, gallery_images")
    .eq("is_active", true);

  if (ids && ids.length > 0) {
    query = query.in("id", ids);
  }

  const { data: products, error } = await query;

  if (error || !products) {
    return new Response(JSON.stringify({ error: error?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: { id: string; status: string; url: string }[] = [];
  const foundIds = new Set<string>();

  for (const p of products) {
    foundIds.add(p.id);
    const path = `${FOLDER}/${p.id}.html`;
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
    const html = buildSharePageHtml(p, frontendUrl, publicUrl);

    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(
      path,
      new Blob([html], { type: "text/html; charset=utf-8" }),
      { upsert: true, cacheControl: "3600", contentType: "text/html; charset=utf-8" },
    );

    results.push({ id: p.id, status: uploadErr ? `error: ${uploadErr.message}` : "ok", url: publicUrl });
  }

  const missingIds = ids ? ids.filter((id) => !foundIds.has(id)) : [];

  return new Response(JSON.stringify({ count: products.length, missingIds, results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});