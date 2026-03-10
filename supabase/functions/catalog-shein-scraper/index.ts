/**
 * Catalog SHEIN Scraper — Category Page Crawl Strategy
 * 
 * Instead of searching for individual products (which returns category pages),
 * this scraper:
 * 1. Scrapes SHEIN category pages using Firecrawl
 * 2. Extracts product links, titles, prices, and images from the HTML
 * 3. Upserts discovered products into catalog_items
 * 
 * Auth: x-cron-secret header OR admin JWT
 */

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-cron-key",
};

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const HARD_FUNCTION_CAP_MS = 240000;
const DAILY_CREDIT_CAP = 5000;
const DEFAULT_CATEGORIES_PER_RUN = 8;

// ── SHEIN CATEGORY URLs ────────────────────────────────────────────────────
// These are real SHEIN category page URLs that list products
// Includes paginated URLs to maximize yield per category

function buildPagedUrls(baseUrl: string, category: string, label: string, pages: number = 3): { url: string; category: string; label: string }[] {
  const results = [{ url: baseUrl, category, label }];
  for (let p = 2; p <= pages; p++) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    results.push({ url: `${baseUrl}${separator}page=${p}`, category, label: `${label}_p${p}` });
  }
  return results;
}

const CATEGORY_URLS: { url: string; category: string; label: string }[] = [
  // Women's Dresses (high-yield categories with pagination)
  ...buildPagedUrls("https://us.shein.com/Women-Dresses-c-1727.html", "clothing_shoes", "women_dresses", 5),
  ...buildPagedUrls("https://us.shein.com/Women-Bodycon-Dresses-c-4464.html", "clothing_shoes", "bodycon_dresses", 3),
  ...buildPagedUrls("https://us.shein.com/Women-A-Line-Dresses-c-4465.html", "clothing_shoes", "aline_dresses", 3),
  ...buildPagedUrls("https://us.shein.com/Women-Maxi-Dresses-c-2340.html", "clothing_shoes", "maxi_dresses", 3),
  { url: "https://us.shein.com/Women-Mini-Dresses-c-4463.html", category: "clothing_shoes", label: "mini_dresses" },
  { url: "https://us.shein.com/Women-Midi-Dresses-c-4462.html", category: "clothing_shoes", label: "midi_dresses" },

  // Women's Tops (with pagination)
  ...buildPagedUrls("https://us.shein.com/Women-Blouses-c-1733.html", "clothing_shoes", "women_blouses", 4),
  ...buildPagedUrls("https://us.shein.com/Women-T-Shirts-c-1738.html", "clothing_shoes", "women_tshirts", 4),
  ...buildPagedUrls("https://us.shein.com/Women-Tank-Tops-Camis-c-2223.html", "clothing_shoes", "women_tanks", 3),
  { url: "https://us.shein.com/Women-Bodysuits-c-5765.html", category: "clothing_shoes", label: "women_bodysuits" },
  { url: "https://us.shein.com/Women-Crop-Tops-c-4606.html", category: "clothing_shoes", label: "women_crop_tops" },
  { url: "https://us.shein.com/Women-Graphic-Tees-c-12204.html", category: "clothing_shoes", label: "women_graphic_tees" },

  // Women's Bottoms (with pagination)
  ...buildPagedUrls("https://us.shein.com/Women-Jeans-c-1888.html", "clothing_shoes", "women_jeans", 3),
  ...buildPagedUrls("https://us.shein.com/Women-Skirts-c-1732.html", "clothing_shoes", "women_skirts", 3),
  ...buildPagedUrls("https://us.shein.com/Women-Pants-c-1740.html", "clothing_shoes", "women_pants", 3),
  { url: "https://us.shein.com/Women-Shorts-c-1912.html", category: "clothing_shoes", label: "women_shorts" },
  { url: "https://us.shein.com/Women-Leggings-c-1741.html", category: "clothing_shoes", label: "women_leggings" },
  { url: "https://us.shein.com/Women-Wide-Leg-Pants-c-11766.html", category: "clothing_shoes", label: "women_wide_leg" },

  // Women's Outerwear
  ...buildPagedUrls("https://us.shein.com/Women-Jackets-Coats-c-1735.html", "clothing_shoes", "women_jackets", 3),
  { url: "https://us.shein.com/Women-Sweaters-c-1734.html", category: "clothing_shoes", label: "women_sweaters" },
  { url: "https://us.shein.com/Women-Hoodies-Sweatshirts-c-2219.html", category: "clothing_shoes", label: "women_hoodies" },
  { url: "https://us.shein.com/Women-Cardigans-c-2217.html", category: "clothing_shoes", label: "women_cardigans" },

  // Women's Lingerie & Sleepwear
  { url: "https://us.shein.com/Women-Lingerie-Sleep-Lounge-c-1862.html", category: "clothing_shoes", label: "women_lingerie" },
  { url: "https://us.shein.com/Women-Bras-c-2370.html", category: "clothing_shoes", label: "women_bras" },
  { url: "https://us.shein.com/Women-Panties-c-2371.html", category: "clothing_shoes", label: "women_panties" },
  { url: "https://us.shein.com/Women-Pajama-Sets-c-2373.html", category: "clothing_shoes", label: "women_pajamas" },

  // Women's Swimwear
  { url: "https://us.shein.com/Women-Bikinis-c-2193.html", category: "clothing_shoes", label: "women_bikinis" },
  { url: "https://us.shein.com/Women-One-Pieces-c-4656.html", category: "clothing_shoes", label: "women_onepieces" },
  { url: "https://us.shein.com/Women-Cover-Ups-c-2194.html", category: "clothing_shoes", label: "women_coverups" },

  // Women's Activewear
  { url: "https://us.shein.com/Women-Sports-Bras-c-2310.html", category: "clothing_shoes", label: "sports_bras" },
  { url: "https://us.shein.com/Women-Yoga-c-5787.html", category: "clothing_shoes", label: "yoga_wear" },
  { url: "https://us.shein.com/Women-Sports-Leggings-c-11786.html", category: "clothing_shoes", label: "sports_leggings" },

  // Shoes (with pagination)
  ...buildPagedUrls("https://us.shein.com/Women-Heels-c-1750.html", "clothing_shoes", "women_heels", 3),
  ...buildPagedUrls("https://us.shein.com/Women-Sandals-c-1751.html", "clothing_shoes", "women_sandals", 3),
  ...buildPagedUrls("https://us.shein.com/Women-Sneakers-c-2150.html", "clothing_shoes", "women_sneakers", 3),
  { url: "https://us.shein.com/Women-Boots-c-1748.html", category: "clothing_shoes", label: "women_boots" },
  { url: "https://us.shein.com/Women-Flats-c-1749.html", category: "clothing_shoes", label: "women_flats" },
  { url: "https://us.shein.com/Women-Slippers-c-2151.html", category: "clothing_shoes", label: "women_slippers" },

  // Bags (with pagination)
  ...buildPagedUrls("https://us.shein.com/Women-Crossbody-Bags-c-2155.html", "clothing_shoes", "crossbody_bags", 3),
  ...buildPagedUrls("https://us.shein.com/Women-Tote-Bags-c-2154.html", "clothing_shoes", "tote_bags", 3),
  { url: "https://us.shein.com/Women-Backpacks-c-2158.html", category: "clothing_shoes", label: "backpacks" },
  { url: "https://us.shein.com/Women-Clutches-c-2156.html", category: "clothing_shoes", label: "clutches" },
  { url: "https://us.shein.com/Women-Wallets-c-2160.html", category: "clothing_shoes", label: "wallets" },

  // Accessories
  ...buildPagedUrls("https://us.shein.com/Women-Jewelry-c-1761.html", "clothing_shoes", "women_jewelry", 3),
  { url: "https://us.shein.com/Women-Hair-Accessories-c-1874.html", category: "clothing_shoes", label: "hair_accessories" },
  { url: "https://us.shein.com/Women-Sunglasses-c-1770.html", category: "clothing_shoes", label: "sunglasses" },
  { url: "https://us.shein.com/Women-Watches-c-1773.html", category: "clothing_shoes", label: "watches" },
  { url: "https://us.shein.com/Women-Scarves-c-1872.html", category: "clothing_shoes", label: "scarves" },
  { url: "https://us.shein.com/Women-Belts-c-1875.html", category: "clothing_shoes", label: "belts" },
  { url: "https://us.shein.com/Women-Hats-c-1871.html", category: "clothing_shoes", label: "hats" },

  // Plus Size (with pagination)
  ...buildPagedUrls("https://us.shein.com/Plus-Size-Dresses-c-3680.html", "clothing_shoes", "plus_dresses", 3),
  ...buildPagedUrls("https://us.shein.com/Plus-Size-Tops-c-3681.html", "clothing_shoes", "plus_tops", 3),
  { url: "https://us.shein.com/Plus-Size-Bottoms-c-3682.html", category: "clothing_shoes", label: "plus_bottoms" },

  // Co-ords & Sets
  { url: "https://us.shein.com/Women-Two-Piece-Outfits-c-2207.html", category: "clothing_shoes", label: "women_twopiece" },
  { url: "https://us.shein.com/Women-Jumpsuits-c-1860.html", category: "clothing_shoes", label: "women_jumpsuits" },
  { url: "https://us.shein.com/Women-Rompers-c-6042.html", category: "clothing_shoes", label: "women_rompers" },

  // Beauty
  { url: "https://us.shein.com/Beauty-Tools-Accessories-c-2040.html", category: "beauty", label: "beauty_tools" },
  { url: "https://us.shein.com/Makeup-c-2036.html", category: "beauty", label: "makeup" },
  { url: "https://us.shein.com/Skin-Care-c-2035.html", category: "beauty", label: "skincare" },

  // Men's (with pagination)
  ...buildPagedUrls("https://us.shein.com/Men-T-Shirts-c-1980.html", "clothing_shoes", "men_tshirts", 3),
  ...buildPagedUrls("https://us.shein.com/Men-Jackets-Coats-c-1981.html", "clothing_shoes", "men_jackets", 3),
  { url: "https://us.shein.com/Men-Pants-c-1982.html", category: "clothing_shoes", label: "men_pants" },
  { url: "https://us.shein.com/Men-Jeans-c-1986.html", category: "clothing_shoes", label: "men_jeans" },
  { url: "https://us.shein.com/Men-Shorts-c-1984.html", category: "clothing_shoes", label: "men_shorts" },
  { url: "https://us.shein.com/Men-Hoodies-Sweatshirts-c-1989.html", category: "clothing_shoes", label: "men_hoodies" },
  { url: "https://us.shein.com/Men-Polo-Shirts-c-1979.html", category: "clothing_shoes", label: "men_polos" },
  { url: "https://us.shein.com/Men-Shoes-c-1993.html", category: "clothing_shoes", label: "men_shoes" },

  // Home
  { url: "https://us.shein.com/Home-Decor-c-2087.html", category: "home", label: "home_decor" },
  { url: "https://us.shein.com/Bedding-c-2066.html", category: "home", label: "bedding" },
  { url: "https://us.shein.com/Kitchen-Dining-c-2093.html", category: "home", label: "kitchen" },
  { url: "https://us.shein.com/Bath-c-2082.html", category: "home", label: "bath" },
];

const WOMEN_PRIORITY_HINTS = [
  "women_",
  "plus_",
  "bodycon",
  "aline",
  "maxi",
  "mini_",
  "midi_",
  "sports_",
  "yoga_",
  "crop_",
  "graphic_",
  "wide_leg",
  "coverups",
  "pajamas",
  "cardigans",
  "twopiece",
  "jumpsuits",
  "rompers",
];

const WOMEN_CATEGORIES = CATEGORY_URLS.filter((c) =>
  WOMEN_PRIORITY_HINTS.some((hint) => c.label.includes(hint))
);

const OTHER_CATEGORIES = CATEGORY_URLS.filter(
  (c) => !WOMEN_CATEGORIES.some((w) => w.label === c.label)
);

// ── HELPERS ────────────────────────────────────────────────────────────────

function extractSheinProductId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("shein.com")) return null;
    // Pattern: -p-12345678.html
    const match = u.pathname.match(/[_-]p[_-]?(\d{5,})/i);
    if (match) return `p${match[1]}`;
    const id = u.searchParams.get("id");
    if (id && /^\d{5,}$/.test(id)) return `p${id}`;
    // Pattern: /-12345678.html at end of path  
    const endMatch = u.pathname.match(/-(\d{7,})(?:\.html)?$/i);
    if (endMatch) return `p${endMatch[1]}`;
    // Any long numeric in path (not category)
    const anyNumeric = u.pathname.match(/(\d{7,})/);
    if (anyNumeric && !/-c[at]*-\d/i.test(u.pathname) && !/-sc-/i.test(u.pathname)) return `p${anyNumeric[1]}`;
    return null;
  } catch { return null; }
}

function parseUsd(value: string): number | null {
  const cleaned = value.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) return null;
  return Math.round(parsed * 100) / 100;
}

const isSwatchUrl = (u: string) => /\/v4\/p\/ccc\//i.test(u) || /\/p\/ccc\//i.test(u);

interface SheinProduct {
  title: string;
  price_usd: number;
  image_url: string;
  product_url: string;
  provider_product_id: string;
  brand: string;
  images: string[];
}

// ── EXTRACT PRODUCTS FROM SCRAPED CONTENT ──────────────────────────────────

function extractProductsFromContent(markdown: string, html: string, links: string[], baseUrl: string): SheinProduct[] {
  const products: SheinProduct[] = [];
  const seenIds = new Set<string>();
  const baseOrigin = new URL(baseUrl).origin;

  // Collect ALL product URLs from multiple sources
  const productUrls = new Set<string>();

  // From markdown links
  const mdLinkRegex = /\((https?:\/\/[^\s)]*shein\.com[^\s)]*-p-\d+[^\s)]*)\)/gi;
  let m;
  while ((m = mdLinkRegex.exec(markdown)) !== null) productUrls.add(m[1]);

  // From HTML href
  const hrefRegex = /href="([^"]*-p-\d+[^"]*)"/gi;
  while ((m = hrefRegex.exec(html)) !== null) {
    let url = m[1].replace(/&amp;/g, "&");
    if (url.startsWith("/")) url = baseOrigin + url;
    if (url.includes("shein.com")) productUrls.add(url);
  }

  // From links array
  for (const link of links) {
    if (typeof link === "string" && link.includes("shein.com") && /-p-\d+/.test(link)) {
      productUrls.add(link);
    }
  }

  console.log(`[SHEIN_SCRAPER] found ${productUrls.size} product URLs from content`);

  // Build a map of product-id to surrounding context for metadata extraction
  const allContent = markdown + " " + html;

  for (const url of productUrls) {
    const pid = extractSheinProductId(url);
    if (!pid || seenIds.has(pid)) continue;
    seenIds.add(pid);

    const pidNum = pid.replace('p', '');
    
    // Extract title: look for text near the product link
    let title = "";
    // Try markdown: [Title](url)
    const titleRegex = new RegExp(`\\[([^\\]]{5,200})\\]\\([^)]*${pidNum}[^)]*\\)`, 'i');
    const titleMatch = markdown.match(titleRegex);
    if (titleMatch) {
      title = titleMatch[1].replace(/^[-\d%\s\\n]+/, '').trim();
    }
    // Fallback: extract from URL slug
    if (!title) {
      try {
        const slug = new URL(url).pathname.split('/').pop()?.replace(/-p-\d+.*$/, '').replace(/-/g, ' ') || '';
        if (slug.length > 5) title = slug.substring(0, 200);
      } catch {}
    }

    // Extract price from nearby context
    let price = 0;
    const pidIdx = allContent.indexOf(pidNum);
    if (pidIdx >= 0) {
      const context = allContent.substring(Math.max(0, pidIdx - 500), Math.min(allContent.length, pidIdx + 500));
      const prices = context.match(/\$[\d,]+(?:\.\d{2})?/g);
      if (prices) {
        for (const pm of prices) {
          const p = parseUsd(pm);
          if (p && p > 0.5 && p < 5000) { price = p; break; }
        }
      }
    }

    // Extract images: look for SHEIN CDN URLs near product ID
    const imgUrls: string[] = [];
    if (pidIdx >= 0) {
      const imgContext = allContent.substring(Math.max(0, pidIdx - 2000), Math.min(allContent.length, pidIdx + 2000));
      const imgMatches = [...imgContext.matchAll(/(https?:\/\/img\.ltwebstatic\.com\/[^\s"')]+\.(?:jpg|jpeg|png|webp)[^\s"')]*)/gi)];
      for (const im of imgMatches) {
        const imgUrl = im[1];
        if (!isSwatchUrl(imgUrl) && !/_thumbnail_(?:12[0-6]|60)x/i.test(imgUrl) && !/banner/i.test(imgUrl)) {
          imgUrls.push(imgUrl);
        }
      }
    }

    // Also look for data-src or lazy-load images in HTML near product
    const htmlPidIdx = html.indexOf(pidNum);
    if (htmlPidIdx >= 0) {
      const htmlContext = html.substring(Math.max(0, htmlPidIdx - 3000), Math.min(html.length, htmlPidIdx + 3000));
      const dataSrcMatches = [...htmlContext.matchAll(/(?:data-src|src|data-lazy-img)="(https?:\/\/img\.ltwebstatic\.com\/[^"]+)"/gi)];
      for (const ds of dataSrcMatches) {
        if (!isSwatchUrl(ds[1]) && !/banner/i.test(ds[1])) {
          imgUrls.push(ds[1]);
        }
      }
    }

    const uniqueImages = [...new Set(imgUrls)].slice(0, 8);
    
    // Construct a fallback image URL from product ID if we have no images
    // SHEIN image CDN pattern: images3_pi/{date}/{hash}.webp — not predictable
    // So we'll just skip if no image found

    const imageUrl = uniqueImages[0] || "";

    products.push({
      title: title || `SHEIN Product ${pidNum}`,
      price_usd: price,
      image_url: imageUrl,
      product_url: url,
      provider_product_id: pid,
      brand: "SHEIN",
      images: uniqueImages,
    });
  }

  return products;
}

// ── FIRECRAWL SCRAPE ──────────────────────────────────────────────────────

async function scrapeCategoryPage(
  url: string,
  apiKey: string,
): Promise<{ products: SheinProduct[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html", "links"],
        waitFor: 2500,
        onlyMainContent: false,
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      return { products: [], error: `HTTP ${resp.status}: ${errText.substring(0, 200)}` };
    }

    const data = await resp.json();
    const markdown = data?.data?.markdown || data?.markdown || "";
    const html = data?.data?.html || data?.html || "";
    const links: string[] = data?.data?.links || data?.links || [];

    // Extract products from HTML/markdown/links
    const products = extractProductsFromContent(markdown, html, links, url);

    return { products };
  } catch (err) {
    return { products: [], error: (err as Error).message };
  }
}

// ── STATEFUL ROTATION ─────────────────────────────────────────────────────

async function getRotationOffset(supabase: any): Promise<number> {
  try {
    const { data } = await supabase
      .from("cars_settings")
      .select("value")
      .eq("key", "scraper_rotation_shein")
      .single();
    return (data?.value as any)?.offset || 0;
  } catch { return 0; }
}

async function setRotationOffset(supabase: any, offset: number): Promise<void> {
  try {
    await supabase
      .from("cars_settings")
      .upsert({
        key: "scraper_rotation_shein",
        value: { offset, updated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
  } catch (e) {
    console.warn(`[SHEIN_SCRAPER] rotation save error:`, (e as Error).message);
  }
}

// ── UPSERT ─────────────────────────────────────────────────────────────────

async function upsertProducts(supabase: any, products: SheinProduct[], dryRun: boolean): Promise<number> {
  // Filter to only products with at least title OR image
  const validProducts = products.filter(p => 
    (p.title && p.title.length > 5) && p.image_url
  );

  if (validProducts.length === 0 || dryRun) return 0;

  const now = new Date().toISOString();
  const rows = validProducts.map((p) => ({
    provider: "shein",
    provider_product_id: p.provider_product_id,
    title: p.title.substring(0, 200),
    price_usd: p.price_usd > 0 ? p.price_usd : null,
    image_url: p.image_url,
    product_url: p.product_url,
    brand: p.brand || "SHEIN",
    category_key: "clothing_shoes",
    unified_category: "clothing_shoes_accessories",
    currency: "USD",
    in_stock: true,
    is_active: true,
    is_disallowed: false,
    last_seen_at: now,
    last_checked_at: now,
    images: p.images.length > 0 ? p.images : [p.image_url],
    metadata: { source: "firecrawl_category_scrape" },
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase
      .from("catalog_items")
      .upsert(batch, { onConflict: "provider,provider_product_id" });
    if (error) {
      console.error(`[SHEIN_SCRAPER] upsert batch ${i} error:`, error.message);
    } else {
      upserted += batch.length;
    }
  }
  return upserted;
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = req.method === "POST" ? await req.json() : {};
    const categoriesPerRun = body.categories_per_run || DEFAULT_CATEGORIES_PER_RUN;
    const dryRun = body.dry_run || false;
    const customUrl = body.category_url?.trim() || undefined;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";

    if (!firecrawlKey) {
      return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Budget check
    const { data: budgetData } = await supabase.rpc("check_provider_budget", {
      p_provider: "firecrawl:shein",
      p_window_type: "day",
      p_limit: DAILY_CREDIT_CAP,
    });
    if (budgetData && !budgetData.allowed) {
      console.log(`[SHEIN_SCRAPER] BUDGET EXCEEDED — ${budgetData.count}/${DAILY_CREDIT_CAP} credits used today`);
      return new Response(JSON.stringify({
        ok: true, budget_exceeded: true, credits_used: budgetData.count,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get rotation offset for category rotation
    const offset = customUrl ? 0 : await getRotationOffset(supabase);
    
    // Select categories to scrape
    let categoriesToScrape: typeof CATEGORY_URLS;
    if (customUrl) {
      categoriesToScrape = [{ url: customUrl, category: "clothing_shoes", label: "custom" }];
    } else {
      const womenTarget = Math.max(1, Math.ceil(categoriesPerRun * 0.8));
      const otherTarget = Math.max(0, categoriesPerRun - womenTarget);

      const womenSelection: typeof CATEGORY_URLS = [];
      for (let i = 0; i < womenTarget; i++) {
        const idx = (offset + i) % WOMEN_CATEGORIES.length;
        womenSelection.push(WOMEN_CATEGORIES[idx]);
      }

      const otherSelection: typeof CATEGORY_URLS = [];
      for (let i = 0; i < otherTarget; i++) {
        const idx = (offset + i) % OTHER_CATEGORIES.length;
        otherSelection.push(OTHER_CATEGORIES[idx]);
      }

      categoriesToScrape = [...womenSelection, ...otherSelection];
    }

    console.log(`[SHEIN_SCRAPER] START categories=${categoriesToScrape.length} offset=${offset} dryRun=${dryRun} budget=${budgetData?.count || 0}/${DAILY_CREDIT_CAP}`);

    const allProducts: SheinProduct[] = [];
    const globalSeenIds = new Set<string>();
    let categoriesProcessed = 0;
    const categoryResults: Record<string, number> = {};

    for (const cat of categoriesToScrape) {
      if (Date.now() - startTime > HARD_FUNCTION_CAP_MS - 10000) {
        console.log(`[SHEIN_SCRAPER] time limit approaching, stopping`);
        break;
      }

      console.log(`[SHEIN_SCRAPER] scraping ${cat.label}: ${cat.url}`);
      const { products, error } = await scrapeCategoryPage(cat.url, firecrawlKey);

      // Track credits
      await supabase.rpc("increment_provider_budget", {
        p_provider: "firecrawl:shein",
        p_window_type: "day",
        p_limit: DAILY_CREDIT_CAP,
      });

      if (error) {
        console.error(`[SHEIN_SCRAPER] error scraping ${cat.label}: ${error}`);
        categoryResults[cat.label] = 0;
      } else {
        let added = 0;
        for (const p of products) {
          if (!globalSeenIds.has(p.provider_product_id)) {
            globalSeenIds.add(p.provider_product_id);
            allProducts.push(p);
            added++;
          }
        }
        categoryResults[cat.label] = added;
        console.log(`[SHEIN_SCRAPER] ${cat.label}: ${products.length} extracted, ${added} new unique`);
      }

      categoriesProcessed++;
      
      // Small delay between scrapes
      await new Promise((r) => setTimeout(r, 500));
    }

    // Update rotation offset
    if (!customUrl) {
      const newOffset = (offset + categoriesProcessed) % CATEGORY_URLS.length;
      await setRotationOffset(supabase, newOffset);
    }

    // Upsert
    const upsertedCount = await upsertProducts(supabase, allProducts, dryRun);

    const elapsedMs = Date.now() - startTime;
    const result = {
      ok: true,
      provider: "shein",
      strategy: "category_scrape",
      categories_processed: categoriesProcessed,
      category_pool_size: CATEGORY_URLS.length,
      rotation_offset: offset,
      next_offset: (offset + categoriesProcessed) % CATEGORY_URLS.length,
      products_found: allProducts.length,
      products_with_images: allProducts.filter(p => p.image_url).length,
      products_with_prices: allProducts.filter(p => p.price_usd > 0).length,
      upserted_count: upsertedCount,
      category_results: categoryResults,
      sample: allProducts.slice(0, 3).map(p => ({
        pid: p.provider_product_id,
        title: p.title?.substring(0, 60),
        price: p.price_usd,
        image: p.image_url?.substring(0, 80),
        url: p.product_url?.substring(0, 80),
      })),
      elapsed_ms: elapsedMs,
      dry_run: dryRun,
    };

    console.log(`[SHEIN_SCRAPER] DONE ${elapsedMs}ms found=${allProducts.length} upserted=${upsertedCount} categories=${categoriesProcessed}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    console.error(`[SHEIN_SCRAPER] FATAL ${elapsedMs}ms`, (err as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, elapsed_ms: elapsedMs }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
