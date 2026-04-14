/**
 * share-og – Server-rendered HTML with Open Graph meta tags
 * for WhatsApp / social media link previews.
 *
 * GET /share-og?id=<hot_product_id>
 *
 * Always returns HTML with product-specific OG tags plus an instant
 * client-side redirect to the public React share page.
 * This avoids relying on crawler User-Agent detection, which can fail
 * for messaging apps that unfurl links with generic fetchers.
 */

import { createClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

  const title = escapeHtml(product.title || "AfriShop Product");
  const description = escapeHtml(product.description_fr || product.title || "").slice(0, 200);
  const price = Math.ceil(product.total_price_usd || 0);
  const ogTitle = `${title} - $${price}`;
  const ogDesc = description || title;
  const galleryImages: string[] = product.gallery_images || [];
  const ogImage = galleryImages[0] || product.image_url || "";
  const publicShareUrl = url.toString();
  const sharePageUrl = `${frontendUrl}/share/hp/${product.id}`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${ogTitle}</title>
<meta name="description" content="${ogDesc}"/>
<meta name="robots" content="noindex, nofollow"/>
<link rel="canonical" href="${escapeHtml(publicShareUrl)}"/>
<meta property="og:type" content="product"/>
<meta property="og:title" content="${ogTitle}"/>
<meta property="og:description" content="${ogDesc}"/>
<meta property="og:image" content="${escapeHtml(ogImage)}"/>
<meta property="og:image:secure_url" content="${escapeHtml(ogImage)}"/>
<meta property="og:image:alt" content="${title}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${escapeHtml(publicShareUrl)}"/>
<meta property="og:site_name" content="AfriShop"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${ogTitle}"/>
<meta name="twitter:description" content="${ogDesc}"/>
<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(sharePageUrl)}"/>
<script>window.location.replace(${JSON.stringify(sharePageUrl)});</script>
</head>
<body>
<p>Redirecting to <a href="${escapeHtml(sharePageUrl)}">AfriShop</a>...</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
});
