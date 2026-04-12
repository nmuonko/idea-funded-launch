/**
 * extract-price: Extract product data (price, title, images) from a URL.
 * Used by Hot Products admin and SHEIN backfill.
 * Amazon: direct fetch first (most accurate price), Firecrawl fallback.
 * Others: Firecrawl primary.
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

    // ─── Strategy 1: Direct fetch for Amazon (most accurate, real-time price) ───
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
          // Check if we got a real product page (not CAPTCHA)
          const isCaptcha = html.includes("captcha") || (html.length < 5000 && !html.includes("corePrice"));
          if (!isCaptcha) {
            price = extractPriceFromHtml(html);
            const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
            if (titleMatch && !titleMatch[1].includes("Robot Check")) {
              title = decodeHtmlEntities(
                titleMatch[1].replace(/\s*:\s*Amazon\.com\s*:.*$/i, "").replace(/\s*\|.*$/, "").trim()
              );
            }
            images = extractImagesFromHtml(html, true);
            if (images.length > 0) imageUrl = images[0];
            console.log(`[EXTRACT_PRICE] Direct: price=${price} title="${title?.substring(0, 40)}" images=${images.length}`);
          } else {
            console.log(`[EXTRACT_PRICE] Direct: CAPTCHA detected, skipping`);
          }
        }
      } catch (e) {
        console.warn(`[EXTRACT_PRICE] direct fetch error: ${(e as Error).message}`);
      }
    }

    // ─── Strategy 2: Firecrawl (fallback for Amazon, primary for others) ───
    if (!price || images.length === 0 || (!isAmazon && !title)) {
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
              formats: ["rawHtml"],
              waitFor: 3000,
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
                title = decodeHtmlEntities(
                  title.replace(/\s*:\s*Amazon\.com\s*:.*$/i, "").replace(/\s*\|.*$/, "").trim()
                );
              }
            }
            if (!price) {
              price = extractPriceFromHtml(html);
              if (!price) price = extractPriceFromMarkdown(md);
            }
            if (images.length === 0) {
              images = extractImagesFromHtml(html, isAmazon);
              // OG image — only add for non-Amazon (Amazon OG is usually a tiny thumbnail)
              if (!isAmazon) {
                const ogImage = meta?.ogImage;
                if (ogImage && typeof ogImage === "string" && !images.includes(ogImage)) {
                  images.unshift(ogImage);
                }
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

    // ─── Strategy 3: DB fallback ───
    if (isAmazon && asin && (!price || images.length === 0)) {
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
          if (images.length === 0) {
            if (Array.isArray(dbItem.images)) {
              images = dbItem.images.filter((u: any) => typeof u === "string");
            }
            if (images.length === 0 && dbItem.image_url) {
              images = [dbItem.image_url];
            }
          }
          if (!imageUrl && images.length > 0) imageUrl = images[0];
          console.log(`[EXTRACT_PRICE] DB fallback: price=${price} images=${images.length}`);
        }
      } catch (e) {
        console.warn(`[EXTRACT_PRICE] DB fallback error: ${(e as Error).message}`);
      }
    }

    if (images.length > 0 && !imageUrl) imageUrl = images[0];

    const result = {
      title: title || null,
      price, price_usd: price, basePrice: price, priceUsd: price,
      image: imageUrl, image_url: imageUrl, imageUrl: imageUrl,
      images: images.slice(0, 10),
      provider, providerId: providerId || null, provider_product_id: providerId || null,
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

// ─── Helpers ───

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function extractPriceFromHtml(html: string): number | null {
  const corePriceMatch = html.match(/corePrice[^{]*\{[^}]*"value"\s*:\s*([\d.]+)/);
  if (corePriceMatch) {
    const v = parseFloat(corePriceMatch[1]);
    if (v > 0 && v < 100000) return v;
  }

  const patterns = [
    /id="priceblock_ourprice"[^>]*>\s*\$\s*([\d,]+\.?\d*)/i,
    /id="priceblock_dealprice"[^>]*>\s*\$\s*([\d,]+\.?\d*)/i,
    /class="a-price-whole"[^>]*>([\d,]+)<[^]*?class="a-price-fraction"[^>]*>(\d+)/s,
    /"price"\s*:\s*"?\$?([\d,]+\.\d{2})"?/,
    /\$\s*([\d,]+\.\d{2})\s*<\/span>/,
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

  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(m[1]);
      const offers = json?.offers || json?.Offers;
      const p = offers?.price || offers?.lowPrice;
      if (p) { const v = parseFloat(String(p)); if (v > 0) return v; }
    } catch { /* skip */ }
  }

  return null;
}

function extractPriceFromMarkdown(md: string): number | null {
  for (const pat of [/\$\s*([\d,]+\.\d{2})/, /Price:\s*\$\s*([\d,]+\.?\d*)/i, /Now:\s*\$\s*([\d,]+\.?\d*)/i]) {
    const m = md.match(pat);
    if (m) { const v = parseFloat(m[1].replace(/,/g, "")); if (v > 0 && v < 100000) return v; }
  }
  return null;
}

/**
 * Extract product images from HTML.
 * For Amazon: uses structured JS data (hiRes/large/colorImages) to get ONLY product gallery images.
 * Aggressively filters banners, ads, widgets, logos, and tiny thumbnails.
 */
function extractImagesFromHtml(html: string, isAmazon: boolean): string[] {
  const seen = new Set<string>();
  const images: string[] = [];

  const isAdOrJunk = (u: string): boolean => {
    if (/sprite|pixel|beacon|tracking|spacer|1x1|transparent/i.test(u)) return true;
    if (/play.button|overlay/i.test(u)) return true;
    if (isAmazon) {
      // Amazon ad/infrastructure paths
      if (/\/images\/[GSP]\//i.test(u)) return true;
      // Prime, subscribe, associate badges
      if (/prime|subs-|asso[c-]|badge|icon|logo|gift.?card/i.test(u)) return true;
      // Tiny thumbnails (SS50, SX38, SY69, etc.)
      if (/\._(?:SS|SX|SY)\d{2,3}[_.]/.test(u)) return true;
      // Very small brand logos (2-digit + letter IDs like 21w, 31e)
      if (/\/images\/I\/\d{2}[a-zA-Z]/.test(u)) return true;
      // PKmb (play button overlay images)
      if (/PKmb/i.test(u)) return true;
    }
    return false;
  };

  const push = (u: string) => {
    if (!u || seen.has(u) || isAdOrJunk(u)) return;
    seen.add(u);
    images.push(u);
  };

  if (isAmazon) {
    // ── Priority 1: colorImages JS block (THE authoritative product gallery) ──
    // Pattern: 'colorImages': {'initial': [{"hiRes":"...", "large":"...", ...}]}
    const colorImagesMatch = html.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[\s\S]*?\])\s*\}/);
    if (colorImagesMatch) {
      try {
        const arr = JSON.parse(colorImagesMatch[1]);
        for (const item of arr) {
          if (item?.hiRes) push(item.hiRes);
          else if (item?.large) push(item.large);
          else if (item?.main && typeof item.main === "object") {
            // Sometimes it's {main: {"url": ...}}
            const mainUrl = Object.keys(item.main).find(k => k.startsWith("http"));
            if (mainUrl) push(mainUrl);
          }
        }
        console.log(`[EXTRACT_IMAGES] colorImages found ${images.length} product images`);
      } catch { /* skip */ }
    }

    // ── Priority 2: "hiRes" standalone matches ──
    if (images.length === 0) {
      for (const match of html.matchAll(/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/gi)) {
        push(match[1]);
      }
    }

    // ── Priority 3: "large" standalone matches ──
    if (images.length === 0) {
      for (const match of html.matchAll(/"large"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/gi)) {
        push(match[1]);
      }
    }

    // ── Priority 4: landingImage (main product image on page) ──
    if (images.length === 0) {
      const landingMatch = html.match(/id="landingImage"[^>]+src="([^"]+)"/i);
      if (landingMatch) {
        push(upgradeAmazonImage(landingMatch[1]));
      }
    }

    // ── Priority 5: _AC_SL (confirmed product images) only ──
    if (images.length === 0) {
      for (const match of html.matchAll(
        /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9]+\._AC_SL\d+_\.(?:jpg|png|webp)/gi
      )) {
        push(match[0]);
      }
    }

    // ── Priority 6: Upgrade any _AC_ thumbnails to SL1500 ──
    if (images.length === 0) {
      const baseIds = new Set<string>();
      for (const match of html.matchAll(
        /(https:\/\/m\.media-amazon\.com\/images\/I\/([A-Za-z0-9]+))\._AC_[^.]+\.(?:jpg|png|webp)/gi
      )) {
        const baseId = match[2];
        if (!baseIds.has(baseId) && baseId.length >= 8) {
          baseIds.add(baseId);
          push(`https://m.media-amazon.com/images/I/${baseId}._AC_SL1500_.jpg`);
        }
      }
    }

    // ── Priority 7: JSON-LD images (last resort for Amazon) ──
    if (images.length === 0) {
      for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const parsed = JSON.parse(m[1]);
          const imgs = parsed?.image;
          if (Array.isArray(imgs)) {
            for (const i of imgs) push(typeof i === "string" ? i : i?.url || "");
          } else if (typeof imgs === "string") push(imgs);
        } catch { /* skip */ }
      }
    }
  } else {
    // Non-Amazon: OG images first
    for (const m of html.matchAll(
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi
    )) {
      push(m[1]);
    }

    // JSON-LD images
    for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const parsed = JSON.parse(m[1]);
        const imgs = parsed?.image;
        if (Array.isArray(imgs)) {
          for (const i of imgs) push(typeof i === "string" ? i : i?.url || i?.contentUrl || "");
        } else if (typeof imgs === "string") push(imgs);
      } catch { /* skip */ }
    }
  }

  // Final dedup: same base image ID at different sizes → keep first (usually largest)
  if (isAmazon) {
    const uniqueByBase = new Map<string, string>();
    for (const img of images) {
      const baseMatch = img.match(/\/images\/I\/([A-Za-z0-9]+)/);
      const baseId = baseMatch ? baseMatch[1] : img;
      if (!uniqueByBase.has(baseId)) uniqueByBase.set(baseId, img);
    }
    return Array.from(uniqueByBase.values()).slice(0, 10);
  }

  return images.slice(0, 10);
}

function upgradeAmazonImage(url: string): string {
  return url.replace(/\._[A-Z]{2}\d+_/, ".");
}
