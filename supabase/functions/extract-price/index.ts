/**
 * extract-price: Extract product data (price, title, images) from a URL.
 * Used by Hot Products admin and SHEIN backfill.
 * Uses Firecrawl for JS-heavy sites, direct fetch as fallback.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const url: string | undefined = body?.url;
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanUrl = url.trim();
    const isAmazon = /amazon\.\w/i.test(cleanUrl);
    const asinMatch = cleanUrl.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    const asin = asinMatch?.[1]?.toUpperCase() || null;

    let title: string | null = null;
    let price: number | null = null;
    let imageUrl: string | null = null;
    let images: string[] = [];
    let provider = "external";
    let providerId = "";

    if (isAmazon) {
      provider = "amazon";
      providerId = asin || "";
    } else if (/walmart\.com/i.test(cleanUrl)) {
      provider = "walmart";
      const m = cleanUrl.match(/\/ip\/[^/]*?\/(\d+)/);
      if (m) providerId = m[1];
    } else if (/shein\.com/i.test(cleanUrl)) {
      provider = "shein";
    } else if (/ebay\.com/i.test(cleanUrl)) {
      provider = "ebay";
    }

    // ─── Strategy 1: Direct fetch for Amazon (most accurate price) ───
    if (isAmazon && asin) {
      console.log(`[EXTRACT_PRICE] Direct fetch for Amazon ${asin}`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`https://www.amazon.com/dp/${asin}`, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow",
        });
        clearTimeout(timeout);
        if (res.ok) {
          const html = await res.text();
          price = extractPriceFromHtml(html);
          const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
          if (titleMatch) {
            title = titleMatch[1].replace(/\s*:\s*Amazon\.com\s*:.*$/i, "").replace(/\s*\|.*$/, "").trim();
          }
          images = extractImagesFromHtml(html, true);
          if (images.length > 0) imageUrl = images[0];
          console.log(`[EXTRACT_PRICE] Direct: price=${price} images=${images.length}`);
        }
      } catch (e) {
        console.warn(`[EXTRACT_PRICE] direct fetch error: ${(e as Error).message}`);
      }
    }

    // ─── Strategy 2: Firecrawl (fallback for Amazon, primary for others) ───
    if (!price || (!isAmazon && !title)) {
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (firecrawlKey) {
      const scraperUrl = isAmazon && asin ? `https://www.amazon.com/dp/${asin}` : cleanUrl;
      console.log(`[EXTRACT_PRICE] Firecrawl scraping ${scraperUrl}`);

      try {
        const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: scraperUrl,
            formats: ["markdown", "html"],
            waitFor: isAmazon ? 2000 : 3000,
            onlyMainContent: true,
          }),
        });

        if (fcRes.ok) {
          const fcData = await fcRes.json();
          const html = fcData?.data?.html || fcData?.html || "";
          const md = fcData?.data?.markdown || fcData?.markdown || "";
          const meta = fcData?.data?.metadata || fcData?.metadata || {};

          if (!title) {
            title = meta?.title || meta?.ogTitle || null;
            if (title) {
              title = title.replace(/\s*:\s*Amazon\.com\s*:.*$/i, "").replace(/\s*\|.*$/, "").trim();
            }
          }
          if (!price) {
            price = extractPriceFromHtml(html);
            if (!price) price = extractPriceFromMarkdown(md);
          }
          if (images.length === 0) {
            images = extractImagesFromHtml(html, isAmazon);
            const ogImage = meta?.ogImage;
            if (ogImage && typeof ogImage === "string" && !images.includes(ogImage)) {
              images.unshift(ogImage);
            }
            if (images.length > 0) imageUrl = images[0];
          }
          console.log(`[EXTRACT_PRICE] Firecrawl: price=${price} images=${images.length}`);
        } else {
          console.warn(`[EXTRACT_PRICE] Firecrawl HTTP ${fcRes.status}`);
        }
      } catch (e) {
        console.warn(`[EXTRACT_PRICE] Firecrawl error: ${(e as Error).message}`);
      }
    }
    }
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (firecrawlKey) {
      const scraperUrl = isAmazon && asin ? `https://www.amazon.com/dp/${asin}` : cleanUrl;
      console.log(`[EXTRACT_PRICE] Firecrawl scraping ${scraperUrl}`);

      try {
        const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: scraperUrl,
            formats: ["markdown", "html"],
            waitFor: isAmazon ? 2000 : 3000,
            onlyMainContent: true,
          }),
        });

        if (fcRes.ok) {
          const fcData = await fcRes.json();
          const html = fcData?.data?.html || fcData?.html || "";
          const md = fcData?.data?.markdown || fcData?.markdown || "";
          const meta = fcData?.data?.metadata || fcData?.metadata || {};

          // Title
          title = meta?.title || meta?.ogTitle || null;
          if (title) {
            // Clean Amazon title suffix
            title = title.replace(/\s*:\s*Amazon\.com\s*:.*$/i, "").replace(/\s*\|.*$/, "").trim();
          }

          // Price from HTML
          price = extractPriceFromHtml(html);

          // If no price from HTML, try markdown
          if (!price) {
            price = extractPriceFromMarkdown(md);
          }

          // Images from HTML
          images = extractImagesFromHtml(html, isAmazon);

          // OG image fallback
          const ogImage = meta?.ogImage;
          if (ogImage && typeof ogImage === "string" && !images.includes(ogImage)) {
            images.unshift(ogImage);
          }

          if (images.length > 0) {
            imageUrl = images[0];
          }

          console.log(`[EXTRACT_PRICE] Firecrawl result: title="${title?.substring(0, 50)}" price=${price} images=${images.length}`);
        } else {
          console.warn(`[EXTRACT_PRICE] Firecrawl HTTP ${fcRes.status}`);
        }
      } catch (e) {
        console.warn(`[EXTRACT_PRICE] Firecrawl error: ${(e as Error).message}`);
      }
    }

    // ─── Strategy 2: Direct fetch fallback (Amazon only) ───
    if (isAmazon && asin && !price) {
      console.log(`[EXTRACT_PRICE] Direct fetch fallback for ${asin}`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`https://www.amazon.com/dp/${asin}`, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow",
        });
        clearTimeout(timeout);

        if (res.ok) {
          const html = await res.text();
          if (!price) price = extractPriceFromHtml(html);
          if (!title) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
            if (titleMatch) {
              title = titleMatch[1].replace(/\s*:\s*Amazon\.com\s*:.*$/i, "").replace(/\s*\|.*$/, "").trim();
            }
          }
          if (images.length === 0) {
            images = extractImagesFromHtml(html, true);
            if (images.length > 0) imageUrl = images[0];
          }
        }
      } catch (e) {
        console.warn(`[EXTRACT_PRICE] direct fetch error: ${(e as Error).message}`);
      }
    }

    // ─── Strategy 3: DB fallback ───
    if (isAmazon && asin && (!price || !imageUrl)) {
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        const { data: dbItem } = await supabase
          .from("catalog_items")
          .select("title, price_usd, image_url, images")
          .eq("provider_product_id", asin)
          .in("provider", ["amazon", "rainforest"])
          .limit(1)
          .single();

        if (dbItem) {
          if (!price && dbItem.price_usd > 0) price = dbItem.price_usd;
          if (!title && dbItem.title) title = dbItem.title;
          if (!imageUrl && dbItem.image_url) imageUrl = dbItem.image_url;
          if (images.length === 0 && Array.isArray(dbItem.images)) {
            images = dbItem.images.filter((u: any) => typeof u === "string");
          }
        }
      } catch (e) {
        console.warn(`[EXTRACT_PRICE] DB fallback error: ${(e as Error).message}`);
      }
    }

    const result = {
      title: title || null,
      price: price,
      price_usd: price,
      basePrice: price,
      priceUsd: price,
      image: imageUrl,
      image_url: imageUrl,
      imageUrl: imageUrl,
      images: images.slice(0, 10),
      provider,
      providerId: providerId || null,
      provider_product_id: providerId || null,
    };

    console.log(`[EXTRACT_PRICE] Final: provider=${provider} id=${providerId} price=${price} images=${images.length}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error(`[EXTRACT_PRICE] error: ${(e as Error).message}`);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Price extraction helpers ───

function extractPriceFromHtml(html: string): number | null {
  // 1. corePrice
  const corePriceMatch = html.match(/corePrice[^{]*\{[^}]*"value"\s*:\s*([\d.]+)/);
  if (corePriceMatch) {
    const v = parseFloat(corePriceMatch[1]);
    if (v > 0 && v < 100000) return v;
  }

  // 2. Common price patterns
  const patterns = [
    /id="priceblock_ourprice"[^>]*>\s*\$\s*([\d,]+\.?\d*)/i,
    /id="priceblock_dealprice"[^>]*>\s*\$\s*([\d,]+\.?\d*)/i,
    /class="a-price-whole"[^>]*>([\d,]+)<[^]*?class="a-price-fraction"[^>]*>(\d+)/s,
    /"price"\s*:\s*"?\$?([\d,]+\.\d{2})"?/,
    /\$\s*([\d,]+\.\d{2})\s*<\/span>/,
    // Generic price
    /class="[^"]*price[^"]*"[^>]*>\s*\$\s*([\d,]+\.?\d*)/i,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      const raw = m[2] ? `${m[1]}.${m[2]}` : m[1];
      const v = parseFloat(raw.replace(/,/g, ""));
      if (v > 0 && v < 100000) return v;
    }
  }

  // 3. JSON-LD
  const jsonLdMatches = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of jsonLdMatches) {
    try {
      const json = JSON.parse(m[1]);
      const offers = json?.offers || json?.Offers;
      const p = offers?.price || offers?.lowPrice;
      if (p) {
        const v = parseFloat(String(p));
        if (v > 0) return v;
      }
    } catch {
      /* skip */
    }
  }

  return null;
}

function extractPriceFromMarkdown(md: string): number | null {
  // Look for price patterns in markdown
  const patterns = [
    /\$\s*([\d,]+\.\d{2})/,
    /Price:\s*\$\s*([\d,]+\.?\d*)/i,
    /Now:\s*\$\s*([\d,]+\.?\d*)/i,
  ];
  for (const pat of patterns) {
    const m = md.match(pat);
    if (m) {
      const v = parseFloat(m[1].replace(/,/g, ""));
      if (v > 0 && v < 100000) return v;
    }
  }
  return null;
}

function extractImagesFromHtml(html: string, isAmazon: boolean): string[] {
  const seen = new Set<string>();
  const images: string[] = [];

  const push = (u: string) => {
    if (!u || seen.has(u)) return;
    // Skip tiny/sprite/tracking pixels
    if (/sprite|pixel|beacon|tracking|spacer|1x1|transparent/i.test(u)) return;
    // Amazon banner filter
    if (/\/images\/I\/[A-Za-z0-9._%-]*(?:banner|promo|badge|icon)/i.test(u)) return;
    seen.add(u);
    images.push(u);
  };

  if (isAmazon) {
    // Amazon high-res image extraction
    const amazonImgMatches = html.matchAll(
      /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._%-]+\.(?:jpg|png|webp)/gi
    );
    for (const match of amazonImgMatches) {
      let img = match[0];
      // Upgrade to high-res
      img = img.replace(/\._[A-Z]{2}\d+_/, ".");
      push(img);
    }
  }

  // OG images
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi
  )) {
    push(m[1]);
  }

  // JSON-LD images
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const parsed = JSON.parse(m[1]);
      const imgs = parsed?.image;
      if (Array.isArray(imgs)) {
        for (const i of imgs) {
          push(typeof i === "string" ? i : i?.url || i?.contentUrl || "");
        }
      } else if (typeof imgs === "string") {
        push(imgs);
      }
    } catch {
      /* skip */
    }
  }

  return images.slice(0, 10);
}
