/**
 * share-og – Server-rendered HTML with Open Graph meta tags
 * for WhatsApp / social media link previews.
 *
 * GET /share-og?id=<hot_product_id>
 *
 * For bot crawlers (WhatsApp, Facebook, Twitter, etc.): returns a minimal
 * HTML page with OG tags only — no redirect, no JavaScript.
 *
 * For real browsers: returns HTML with OG tags + JS redirect to the
 * interactive share page.
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

/** Detect social media / link preview crawlers */
function isBot(ua: string): boolean {
  return /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|googlebot|bingbot|bot|crawl|spider|preview/i.test(ua);
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

  // Build OG metadata – prefer French description
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

  const userAgent = req.headers.get("user-agent") || "";
  const isCrawler = isBot(userAgent);

  // For bots: pure OG tags, NO redirect, NO JavaScript
  // For browsers: OG tags + redirect to the interactive page
  const redirectTags = isCrawler ? "" : `
<meta http-equiv="refresh" content="0;url=${esc(sharePageUrl)}"/>
<script>window.location.replace(${JSON.stringify(sharePageUrl)});</script>`;

  const html = `<!DOCTYPE html>
<html lang="fr" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}"/>
<meta property="og:type" content="product"/>
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta property="og:url" content="${esc(url.href)}"/>
<meta property="og:site_name" content="AfriShop"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(ogTitle)}"/>
<meta name="twitter:description" content="${esc(ogDesc)}"/>
<meta name="twitter:image" content="${esc(ogImage)}"/>${redirectTags}
</head>
<body>
<h1>${esc(ogTitle)}</h1>
<img src="${esc(ogImage)}" alt="${esc(ogTitle)}" style="max-width:600px"/>
<p>${esc(ogDesc)}</p>
<p><a href="${esc(sharePageUrl)}">Voir sur AfriShop</a></p>
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
