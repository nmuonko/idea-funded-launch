import { createClient } from "@supabase/supabase-js";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const FRONTEND = "https://afrishop-usa.com";
  const BUCKET = "product-images";
  const FOLDER = "share-previews";

  const { data: products, error } = await supabase
    .from("hot_products_showcase")
    .select("id, title, image_url, total_price_usd, description_fr, gallery_images")
    .eq("link_source", "link_generator");

  if (error || !products) {
    return new Response(JSON.stringify({ error: error?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  function esc(s: string): string {
    return s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  function clean(t: string): string {
    return t.replace(/\s+/g," ").trim().replace(/^[^:]{2,40}:\s*/,"").replace(/\s+:\s+[^:]{2,40}$/,"").trim();
  }
  function trunc(s: string, n: number): string {
    return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
  }

  const results: { id: string; status: string }[] = [];

  for (const p of products) {
    const gallery: string[] = p.gallery_images || [];
    const ogImage = gallery[0] || p.image_url || "";
    const descFr = (p.description_fr || "").replace(/\s+/g, " ").trim();
    let ogTitle: string;
    if (descFr) {
      const m = descFr.match(/^.*?[.!?](?:\s|$)/);
      ogTitle = trunc(m ? m[0].trim() : descFr, 110);
    } else {
      ogTitle = trunc(clean(p.title || "") || "Produit AfriShop", 110);
    }
    const ogDesc = descFr ? trunc(descFr, 180) : `Prix: $${Math.ceil(p.total_price_usd || 0)} · Livraison en RDC incluse`;

    const v = Date.now();
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${FOLDER}/${p.id}.html?v=${v}`;
    const redirectUrl = `${FRONTEND}/share/hp/${p.id}`;

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}" />
<meta name="robots" content="noindex, nofollow" />
<link rel="canonical" href="${esc(publicUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="AfriShop" />
<meta property="og:locale" content="fr_FR" />
<meta property="og:title" content="${esc(ogTitle)}" />
<meta property="og:description" content="${esc(ogDesc)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />
<meta property="og:image:alt" content="${esc(ogTitle)}" />
<meta property="og:url" content="${esc(publicUrl)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(ogTitle)}" />
<meta name="twitter:description" content="${esc(ogDesc)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
<meta http-equiv="refresh" content="0;url=${esc(redirectUrl)}" />
<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</head>
<body><p>Redirection vers <a href="${esc(redirectUrl)}">AfriShop</a>…</p></body>
</html>`;

    const path = `${FOLDER}/${p.id}.html`;
    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(
      path,
      new Blob([html], { type: "text/html; charset=utf-8" }),
      { upsert: true, cacheControl: "3600", contentType: "text/html; charset=utf-8" },
    );

    results.push({ id: p.id, status: uploadErr ? `error: ${uploadErr.message}` : "ok" });
  }

  return new Response(JSON.stringify({ count: products.length, results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});