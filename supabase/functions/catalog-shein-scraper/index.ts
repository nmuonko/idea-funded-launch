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
const DEFAULT_CATEGORIES_PER_RUN = 15;
const MAX_PAGES_PER_CATEGORY = 10; // SHEIN categories have many pages

// ── SHEIN CATEGORY URLs ────────────────────────────────────────────────────
// Each category page yields ~20 unique products per scrape

const CATEGORY_URLS: { url: string; category: string; label: string }[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S DRESSES (high priority — Congolese love standout dresses)
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Dresses-c-1727.html", category: "clothing_shoes", label: "women_dresses" },
  { url: "https://us.shein.com/Women-Bodycon-Dresses-c-4464.html", category: "clothing_shoes", label: "bodycon_dresses" },
  { url: "https://us.shein.com/Women-A-Line-Dresses-c-4465.html", category: "clothing_shoes", label: "aline_dresses" },
  { url: "https://us.shein.com/Women-Maxi-Dresses-c-2340.html", category: "clothing_shoes", label: "maxi_dresses" },
  { url: "https://us.shein.com/Women-Mini-Dresses-c-4463.html", category: "clothing_shoes", label: "mini_dresses" },
  { url: "https://us.shein.com/Women-Midi-Dresses-c-4462.html", category: "clothing_shoes", label: "midi_dresses" },
  { url: "https://us.shein.com/Women-Shirt-Dresses-c-4466.html", category: "clothing_shoes", label: "shirt_dresses" },
  { url: "https://us.shein.com/Women-Wrap-Dresses-c-14752.html", category: "clothing_shoes", label: "wrap_dresses" },
  { url: "https://us.shein.com/Women-Floral-Dresses-c-12287.html", category: "clothing_shoes", label: "floral_dresses" },
  { url: "https://us.shein.com/Women-Party-Dresses-c-12289.html", category: "clothing_shoes", label: "party_dresses" },
  { url: "https://us.shein.com/Women-Formal-Dresses-c-12288.html", category: "clothing_shoes", label: "formal_dresses" },
  { url: "https://us.shein.com/Women-Sweater-Dresses-c-12290.html", category: "clothing_shoes", label: "sweater_dresses" },

  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S TOPS — Blouses, Tees, Crop Tops
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Blouses-c-1733.html", category: "clothing_shoes", label: "women_blouses" },
  { url: "https://us.shein.com/Women-T-Shirts-c-1738.html", category: "clothing_shoes", label: "women_tshirts" },
  { url: "https://us.shein.com/Women-Tank-Tops-Camis-c-2223.html", category: "clothing_shoes", label: "women_tanks" },
  { url: "https://us.shein.com/Women-Bodysuits-c-5765.html", category: "clothing_shoes", label: "women_bodysuits" },
  { url: "https://us.shein.com/Women-Crop-Tops-c-4606.html", category: "clothing_shoes", label: "women_crop_tops" },
  { url: "https://us.shein.com/Women-Graphic-Tees-c-12204.html", category: "clothing_shoes", label: "women_graphic_tees" },
  { url: "https://us.shein.com/Women-Tube-Tops-c-12235.html", category: "clothing_shoes", label: "women_tube_tops" },
  { url: "https://us.shein.com/Women-Peplum-Tops-c-12236.html", category: "clothing_shoes", label: "women_peplum" },

  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S BOTTOMS — Skirts (long/modest), Pants, Jeans
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Skirts-c-1732.html", category: "clothing_shoes", label: "women_skirts" },
  { url: "https://us.shein.com/Women-Maxi-Skirts-c-12245.html", category: "clothing_shoes", label: "women_maxi_skirts" },
  { url: "https://us.shein.com/Women-Midi-Skirts-c-12244.html", category: "clothing_shoes", label: "women_midi_skirts" },
  { url: "https://us.shein.com/Women-Pencil-Skirts-c-12247.html", category: "clothing_shoes", label: "women_pencil_skirts" },
  { url: "https://us.shein.com/Women-Pleated-Skirts-c-12248.html", category: "clothing_shoes", label: "women_pleated_skirts" },
  { url: "https://us.shein.com/Women-Jeans-c-1888.html", category: "clothing_shoes", label: "women_jeans" },
  { url: "https://us.shein.com/Women-Pants-c-1740.html", category: "clothing_shoes", label: "women_pants" },
  { url: "https://us.shein.com/Women-Shorts-c-1912.html", category: "clothing_shoes", label: "women_shorts" },
  { url: "https://us.shein.com/Women-Leggings-c-1741.html", category: "clothing_shoes", label: "women_leggings" },
  { url: "https://us.shein.com/Women-Wide-Leg-Pants-c-11766.html", category: "clothing_shoes", label: "women_wide_leg" },
  { url: "https://us.shein.com/Women-Cargo-Pants-c-12208.html", category: "clothing_shoes", label: "women_cargo" },

  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S OUTERWEAR — Jackets, Sweaters, Hoodies, Blazers
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Jackets-Coats-c-1735.html", category: "clothing_shoes", label: "women_jackets" },
  { url: "https://us.shein.com/Women-Sweaters-c-1734.html", category: "clothing_shoes", label: "women_sweaters" },
  { url: "https://us.shein.com/Women-Hoodies-Sweatshirts-c-2219.html", category: "clothing_shoes", label: "women_hoodies" },
  { url: "https://us.shein.com/Women-Cardigans-c-2217.html", category: "clothing_shoes", label: "women_cardigans" },
  { url: "https://us.shein.com/Women-Blazers-c-2218.html", category: "clothing_shoes", label: "women_blazers" },
  { url: "https://us.shein.com/Women-Trench-Coats-c-12211.html", category: "clothing_shoes", label: "women_trench" },
  { url: "https://us.shein.com/Women-Denim-Jackets-c-12213.html", category: "clothing_shoes", label: "women_denim_jackets" },

  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S SUITS & SETS
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Two-Piece-Outfits-c-2207.html", category: "clothing_shoes", label: "women_twopiece" },
  { url: "https://us.shein.com/Women-Jumpsuits-c-1860.html", category: "clothing_shoes", label: "women_jumpsuits" },
  { url: "https://us.shein.com/Women-Rompers-c-6042.html", category: "clothing_shoes", label: "women_rompers" },
  { url: "https://us.shein.com/Women-Suits-c-12253.html", category: "clothing_shoes", label: "women_suits" },

  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S ACTIVEWEAR
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Sports-Bras-c-2310.html", category: "clothing_shoes", label: "sports_bras" },
  { url: "https://us.shein.com/Women-Sports-Leggings-c-11786.html", category: "clothing_shoes", label: "sports_leggings" },
  { url: "https://us.shein.com/Women-Sports-Tops-c-11785.html", category: "clothing_shoes", label: "sports_tops" },

  // ═══════════════════════════════════════════════════════════════════════
  // PLUS SIZE WOMEN
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Plus-Size-Dresses-c-3680.html", category: "clothing_shoes", label: "plus_dresses" },
  { url: "https://us.shein.com/Plus-Size-Tops-c-3681.html", category: "clothing_shoes", label: "plus_tops" },
  { url: "https://us.shein.com/Plus-Size-Bottoms-c-3682.html", category: "clothing_shoes", label: "plus_bottoms" },
  { url: "https://us.shein.com/Plus-Size-Outerwear-c-3683.html", category: "clothing_shoes", label: "plus_outerwear" },
  { url: "https://us.shein.com/Plus-Size-Jumpsuits-c-12266.html", category: "clothing_shoes", label: "plus_jumpsuits" },
  { url: "https://us.shein.com/Plus-Size-Two-Piece-Outfits-c-12265.html", category: "clothing_shoes", label: "plus_twopiece" },

  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S SHOES
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Heels-c-1750.html", category: "clothing_shoes", label: "women_heels" },
  { url: "https://us.shein.com/Women-Sandals-c-1751.html", category: "clothing_shoes", label: "women_sandals" },
  { url: "https://us.shein.com/Women-Sneakers-c-2150.html", category: "clothing_shoes", label: "women_sneakers" },
  { url: "https://us.shein.com/Women-Boots-c-1748.html", category: "clothing_shoes", label: "women_boots" },
  { url: "https://us.shein.com/Women-Flats-c-1749.html", category: "clothing_shoes", label: "women_flats" },
  { url: "https://us.shein.com/Women-Slippers-c-2151.html", category: "clothing_shoes", label: "women_slippers" },
  { url: "https://us.shein.com/Women-Pumps-c-5789.html", category: "clothing_shoes", label: "women_pumps" },
  { url: "https://us.shein.com/Women-Wedges-c-12271.html", category: "clothing_shoes", label: "women_wedges" },
  { url: "https://us.shein.com/Women-Loafers-c-12272.html", category: "clothing_shoes", label: "women_loafers" },
  { url: "https://us.shein.com/Women-Mules-c-12273.html", category: "clothing_shoes", label: "women_mules" },

  // ═══════════════════════════════════════════════════════════════════════
  // WOMEN'S BAGS & HANDBAGS
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Women-Crossbody-Bags-c-2155.html", category: "clothing_shoes", label: "crossbody_bags" },
  { url: "https://us.shein.com/Women-Tote-Bags-c-2154.html", category: "clothing_shoes", label: "tote_bags" },
  { url: "https://us.shein.com/Women-Backpacks-c-2158.html", category: "clothing_shoes", label: "backpacks" },
  { url: "https://us.shein.com/Women-Clutches-c-2156.html", category: "clothing_shoes", label: "clutches" },
  { url: "https://us.shein.com/Women-Shoulder-Bags-c-2153.html", category: "clothing_shoes", label: "shoulder_bags" },
  { url: "https://us.shein.com/Women-Satchels-c-12275.html", category: "clothing_shoes", label: "satchels" },
  { url: "https://us.shein.com/Women-Hobo-Bags-c-12276.html", category: "clothing_shoes", label: "hobo_bags" },
  { url: "https://us.shein.com/Women-Bucket-Bags-c-12277.html", category: "clothing_shoes", label: "bucket_bags" },

  // ═══════════════════════════════════════════════════════════════════════
  // MEN'S CLOTHING & SHOES
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Men-T-Shirts-c-1980.html", category: "clothing_shoes", label: "men_tshirts" },
  { url: "https://us.shein.com/Men-Jackets-Coats-c-1981.html", category: "clothing_shoes", label: "men_jackets" },
  { url: "https://us.shein.com/Men-Pants-c-1982.html", category: "clothing_shoes", label: "men_pants" },
  { url: "https://us.shein.com/Men-Jeans-c-1986.html", category: "clothing_shoes", label: "men_jeans" },
  { url: "https://us.shein.com/Men-Shorts-c-1984.html", category: "clothing_shoes", label: "men_shorts" },
  { url: "https://us.shein.com/Men-Hoodies-Sweatshirts-c-1989.html", category: "clothing_shoes", label: "men_hoodies" },
  { url: "https://us.shein.com/Men-Polo-Shirts-c-1979.html", category: "clothing_shoes", label: "men_polos" },
  { url: "https://us.shein.com/Men-Shirts-c-1978.html", category: "clothing_shoes", label: "men_shirts" },
  { url: "https://us.shein.com/Men-Suits-Blazers-c-5803.html", category: "clothing_shoes", label: "men_suits" },
  { url: "https://us.shein.com/Men-Sweaters-c-1988.html", category: "clothing_shoes", label: "men_sweaters" },
  { url: "https://us.shein.com/Men-Sweatpants-c-12299.html", category: "clothing_shoes", label: "men_sweatpants" },
  { url: "https://us.shein.com/Men-Two-Piece-Outfits-c-12300.html", category: "clothing_shoes", label: "men_twopiece" },
  { url: "https://us.shein.com/Men-Shoes-c-1993.html", category: "clothing_shoes", label: "men_shoes" },
  { url: "https://us.shein.com/Men-Sneakers-c-12301.html", category: "clothing_shoes", label: "men_sneakers" },
  { url: "https://us.shein.com/Men-Boots-c-12302.html", category: "clothing_shoes", label: "men_boots" },
  { url: "https://us.shein.com/Men-Sandals-c-12303.html", category: "clothing_shoes", label: "men_sandals" },
  { url: "https://us.shein.com/Men-Loafers-c-12304.html", category: "clothing_shoes", label: "men_loafers" },

  // ═══════════════════════════════════════════════════════════════════════
  // KIDS & BABY — Girls, Boys, Toddlers, Babies
  // ═══════════════════════════════════════════════════════════════════════
  { url: "https://us.shein.com/Girls-Dresses-c-2059.html", category: "clothing_shoes", label: "girls_dresses" },
  { url: "https://us.shein.com/Girls-Tops-c-2055.html", category: "clothing_shoes", label: "girls_tops" },
  { url: "https://us.shein.com/Girls-Bottoms-c-2056.html", category: "clothing_shoes", label: "girls_bottoms" },
  { url: "https://us.shein.com/Girls-Outerwear-c-2057.html", category: "clothing_shoes", label: "girls_outerwear" },
  { url: "https://us.shein.com/Girls-Sets-c-12310.html", category: "clothing_shoes", label: "girls_sets" },
  { url: "https://us.shein.com/Girls-Shoes-c-2063.html", category: "clothing_shoes", label: "girls_shoes" },
  { url: "https://us.shein.com/Boys-Tops-c-2022.html", category: "clothing_shoes", label: "boys_tops" },
  { url: "https://us.shein.com/Boys-Bottoms-c-2023.html", category: "clothing_shoes", label: "boys_bottoms" },
  { url: "https://us.shein.com/Boys-Outerwear-c-2024.html", category: "clothing_shoes", label: "boys_outerwear" },
  { url: "https://us.shein.com/Boys-Sets-c-12311.html", category: "clothing_shoes", label: "boys_sets" },
  { url: "https://us.shein.com/Boys-Shoes-c-2030.html", category: "clothing_shoes", label: "boys_shoes" },
  { url: "https://us.shein.com/Baby-Boy-Clothing-c-2072.html", category: "clothing_shoes", label: "baby_boy" },
  { url: "https://us.shein.com/Baby-Girl-Clothing-c-2073.html", category: "clothing_shoes", label: "baby_girl" },
  { url: "https://us.shein.com/Baby-Bodysuits-c-12312.html", category: "clothing_shoes", label: "baby_bodysuits" },
  { url: "https://us.shein.com/Baby-Sets-c-12313.html", category: "clothing_shoes", label: "baby_sets" },
  { url: "https://us.shein.com/Baby-Shoes-c-12314.html", category: "clothing_shoes", label: "baby_shoes" },
  { url: "https://us.shein.com/Toddler-Girls-Clothing-c-12315.html", category: "clothing_shoes", label: "toddler_girls" },
  { url: "https://us.shein.com/Toddler-Boys-Clothing-c-12316.html", category: "clothing_shoes", label: "toddler_boys" },
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
  "crop_",
  "graphic_",
  "wide_leg",
  "cardigans",
  "twopiece",
  "jumpsuits",
  "rompers",
  "floral_",
  "party_",
  "formal_",
  "sweater_d",
  "peplum",
  "pencil_",
  "pleated_",
  "trench",
  "denim_j",
  "crossbody",
  "tote_",
  "clutches",
  "shoulder_",
  "satchels",
  "hobo_",
  "bucket_",
  "wedges",
  "loafers",
  "mules",
  "pumps",
  "heels",
  "sandals",
  "sneakers",
  "boots",
  "flats",
  "slippers",
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

// ── FIRECRAWL JSON/LLM EXTRACTION (PRIMARY) ──────────────────────────────

const SHEIN_PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Product name/title" },
          price: { type: "number", description: "Price in USD" },
          image_url: { type: "string", description: "Main product image URL (full https URL from img.ltwebstatic.com CDN)" },
          product_url: { type: "string", description: "Full product page URL on shein.com" },
          product_id: { type: "string", description: "SHEIN product ID (numeric, from the URL -p-NNNNN pattern)" },
        },
        required: ["name"],
      },
    },
  },
  required: ["products"],
};

async function scrapeCategoryPageLLM(
  url: string,
  apiKey: string,
): Promise<{ products: SheinProduct[]; error?: string; strategy: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    // Strategy 1: JSON/LLM extraction (most reliable against anti-bot)
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["extract"],
        extract: {
          schema: SHEIN_PRODUCT_SCHEMA,
          prompt: "Extract ALL product listings from this SHEIN category page. For each product, get the name, price in USD, main product image URL (from img.ltwebstatic.com CDN, not color swatches), the full product page URL, and the numeric product ID from the URL.",
        },
        waitFor: 8000,
        onlyMainContent: false,
        actions: [
          { type: "wait", milliseconds: 3000 },
          { type: "scroll", direction: "down", amount: 3 },
          { type: "wait", milliseconds: 2000 },
        ],
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`[SHEIN_SCRAPER] LLM extraction HTTP ${resp.status}: ${errText.substring(0, 200)}`);
      // Fall back to HTML strategy
      return scrapeCategoryPageHTML(url, apiKey);
    }

    const data = await resp.json();
    const jsonData = data?.data?.json || data?.json;

    if (!jsonData?.products || !Array.isArray(jsonData.products) || jsonData.products.length === 0) {
      console.warn(`[SHEIN_SCRAPER] LLM returned 0 products, falling back to HTML strategy`);
      return scrapeCategoryPageHTML(url, apiKey);
    }

    const products: SheinProduct[] = [];
    const baseOrigin = new URL(url).origin;

    for (const p of jsonData.products) {
      if (!p.name || p.name.length < 3) continue;

      let pid = p.product_id || "";
      let productUrl = p.product_url || "";

      // Normalize product URL
      if (productUrl && productUrl.startsWith("/")) productUrl = baseOrigin + productUrl;
      
      // Extract PID from URL if not provided
      if (!pid && productUrl) {
        const extracted = extractSheinProductId(productUrl);
        if (extracted) pid = extracted;
      }
      if (!pid) continue; // Skip if we can't identify the product

      // Normalize PID format
      if (/^\d+$/.test(pid)) pid = `p${pid}`;
      if (!pid.startsWith("p")) pid = `p${pid}`;

      let imageUrl = p.image_url || "";
      // Reject swatch URLs
      if (isSwatchUrl(imageUrl)) imageUrl = "";

      const price = typeof p.price === "number" && p.price > 0 && p.price < 10000 ? Math.round(p.price * 100) / 100 : 0;

      products.push({
        title: p.name.substring(0, 200),
        price_usd: price,
        image_url: imageUrl,
        product_url: productUrl || `${baseOrigin}/-p-${pid.replace("p", "")}.html`,
        provider_product_id: pid,
        brand: "SHEIN",
        images: imageUrl ? [imageUrl] : [],
      });
    }

    console.log(`[SHEIN_SCRAPER] LLM extraction: ${jsonData.products.length} raw → ${products.length} valid`);
    return { products, strategy: "llm_json" };
  } catch (err) {
    console.warn(`[SHEIN_SCRAPER] LLM error: ${(err as Error).message}, falling back to HTML`);
    return scrapeCategoryPageHTML(url, apiKey);
  }
}

// ── FIRECRAWL HTML FALLBACK ───────────────────────────────────────────────

async function scrapeCategoryPageHTML(
  url: string,
  apiKey: string,
): Promise<{ products: SheinProduct[]; error?: string; strategy: string }> {
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
        waitFor: 8000,
        onlyMainContent: false,
        actions: [
          { type: "wait", milliseconds: 3000 },
          { type: "scroll", direction: "down", amount: 3 },
          { type: "wait", milliseconds: 2000 },
        ],
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      return { products: [], error: `HTTP ${resp.status}: ${errText.substring(0, 200)}`, strategy: "html_fallback" };
    }

    const data = await resp.json();
    const markdown = data?.data?.markdown || data?.markdown || "";
    const html = data?.data?.html || data?.html || "";
    const links: string[] = data?.data?.links || data?.links || [];

    const products = extractProductsFromContent(markdown, html, links, url);
    return { products, strategy: "html_fallback" };
  } catch (err) {
    return { products: [], error: (err as Error).message, strategy: "html_fallback" };
  }
}

// ── STATEFUL ROTATION ─────────────────────────────────────────────────────

async function getRotationState(supabase: any): Promise<{ offset: number; page: number }> {
  try {
    const { data } = await supabase
      .from("cars_settings")
      .select("value")
      .eq("key", "scraper_rotation_shein")
      .single();
    return {
      offset: (data?.value as any)?.offset || 0,
      page: (data?.value as any)?.page || 1,
    };
  } catch { return { offset: 0, page: 1 }; }
}

async function setRotationState(supabase: any, offset: number, page: number): Promise<void> {
  try {
    await supabase
      .from("cars_settings")
      .upsert({
        key: "scraper_rotation_shein",
        value: { offset, page, updated_at: new Date().toISOString() },
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

    // Get rotation state (category offset + page number)
    const rotationState = customUrl ? { offset: 0, page: 1 } : await getRotationState(supabase);
    let { offset, page: currentPage } = rotationState;
    
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

    console.log(`[SHEIN_SCRAPER] START categories=${categoriesToScrape.length} offset=${offset} page=${currentPage} dryRun=${dryRun} budget=${budgetData?.count || 0}/${DAILY_CREDIT_CAP}`);

    const allProducts: SheinProduct[] = [];
    const globalSeenIds = new Set<string>();
    let categoriesProcessed = 0;
    const categoryResults: Record<string, number> = {};

    for (const cat of categoriesToScrape) {
      if (Date.now() - startTime > HARD_FUNCTION_CAP_MS - 10000) {
        console.log(`[SHEIN_SCRAPER] time limit approaching, stopping`);
        break;
      }

      // Append page parameter for pagination (SHEIN uses ?page=N)
      const separator = cat.url.includes('?') ? '&' : '?';
      const pageUrl = currentPage > 1 ? `${cat.url}${separator}page=${currentPage}` : cat.url;

      console.log(`[SHEIN_SCRAPER] scraping ${cat.label} page=${currentPage}: ${pageUrl}`);
      const { products, error, strategy } = await scrapeCategoryPageLLM(pageUrl, firecrawlKey);

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
        console.log(`[SHEIN_SCRAPER] ${cat.label} page=${currentPage} strategy=${strategy || "unknown"}: ${products.length} extracted, ${added} new unique`);
      }

      categoriesProcessed++;
      
      // Small delay between scrapes
      await new Promise((r) => setTimeout(r, 500));
    }

    // Advance rotation: cycle through pages, then advance category offset
    let nextPage = currentPage + 1;
    let nextOffset = offset;
    if (nextPage > MAX_PAGES_PER_CATEGORY) {
      // Done with all pages for these categories, advance to next batch
      nextPage = 1;
      nextOffset = (offset + categoriesProcessed) % CATEGORY_URLS.length;
    }

    // Update rotation state
    if (!customUrl) {
      await setRotationState(supabase, nextOffset, nextPage);
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
      current_page: currentPage,
      next_offset: nextOffset,
      next_page: nextPage,
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
