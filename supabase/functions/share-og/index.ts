/**
 * share-og – Generates a static HTML page with Open Graph meta tags,
 * uploads it to Supabase Storage (which serves .html as text/html),
 * and redirects the crawler/user to the storage URL.
 *
 * This bypasses the Supabase Edge Function gateway which forces
 * Content-Type: text/plain on responses, breaking WhatsApp link previews.
 *
 * GET /share-og?id=<hot_product_id>
 */

import { createClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const productId = url.searchParams.get("id");

  if (!productId) {
    return new Response("Missing id", { status: 400, headers: corsHeaders });
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(productId)) {
    return new Response("Invalid id", { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: product, error } = await supabase
    .from("hot_products_showcase")
    .select("id, title, image_url, total_price_usd, description_fr, gallery_images")
    .eq("id", productId)
    .single();

  const frontendUrl =
    Deno.env.get("FRONTEND_BASE_URL") || "https://afrishop-usa.com";

  if (error || !product) {
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: frontendUrl },
    });
  }

  // Build OG metadata
  const descFr = (product.description_fr || "").replace(/\s+/g, " ").trim();
  const rawTitle = (product.title || "").replace(/\s+/g, " ").trim();
  let ogTitle: string;
  if (descFr) {
    const m = descFr.match(/^.*?[.!?](?:\s|$)/);
    ogTitle = trunc(m ? m[0].trim() : descFr, 110);
  } else {
    ogTitle = trunc(rawTitle || "Produit AfriShop", 110);
  }

  const price = Math.ceil(product.total_price_usd || 0);
  const ogDesc = descFr
    ? trunc(descFr, 180)
    : `Prix: $${price} · Livraison en RDC incluse`;
  const galleryImages: string[] = product.gallery_images || [];
  const ogImage = galleryImages[0] || product.image_url || "";
  const sharePageUrl = `${frontendUrl}/share/hp/${product.id}`;

  // Build the storage path and public URL
  const BUCKET = "product-images";
  const storagePath = `share-previews/${product.id}.html`;
  const storagePublicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}"/>
<meta name="robots" content="noindex, nofollow"/>
<meta property="og:type" content="product"/>
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta property="og:image:secure_url" content="${esc(ogImage)}"/>
<meta property="og:image:alt" content="${esc(ogTitle)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${esc(storagePublicUrl)}"/>
<meta property="og:site_name" content="AfriShop"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(ogTitle)}"/>
<meta name="twitter:description" content="${esc(ogDesc)}"/>
<meta name="twitter:image" content="${esc(ogImage)}"/>
<meta http-equiv="refresh" content="0;url=${esc(sharePageUrl)}"/>
<script>window.location.replace(${JSON.stringify(sharePageUrl)});</script>
</head>
<body>
<p>Redirection vers <a href="${esc(sharePageUrl)}">AfriShop</a>…</p>
</body>
</html>`;

  // Upload to storage (serves .html as text/html)
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, new Blob([html], { type: "text/html; charset=utf-8" }), {
      upsert: true,
      cacheControl: "300",
      contentType: "text/html; charset=utf-8",
    });

  if (uploadErr) {
    console.error("Storage upload failed:", uploadErr.message);
    // Fallback: redirect to the share page directly
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: sharePageUrl },
    });
  }

  // Redirect crawler/user to the storage URL which serves text/html
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: storagePublicUrl,
    },
  });
});
