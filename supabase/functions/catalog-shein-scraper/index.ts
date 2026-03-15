/**
 * Catalog SHEIN Scraper — Firecrawl Search Strategy
 * 
 * Uses Firecrawl Search API with "site:us.shein.com" queries to discover
 * SHEIN products from search engine indexes, completely bypassing SHEIN's
 * anti-bot protections.
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
const DEFAULT_QUERIES_PER_RUN = 12;
const RESULTS_PER_QUERY = 20; // Firecrawl search limit

// ── SEARCH QUERIES ─────────────────────────────────────────────────────────
// Each query targets a specific SHEIN product category via site: search

const SEARCH_QUERIES: { query: string; label: string }[] = [
  // WOMEN'S DRESSES
  { query: "site:us.shein.com women dresses new arrivals", label: "women_dresses_new" },
  { query: "site:us.shein.com women bodycon dress", label: "bodycon_dresses" },
  { query: "site:us.shein.com women maxi dress", label: "maxi_dresses" },
  { query: "site:us.shein.com women mini dress", label: "mini_dresses" },
  { query: "site:us.shein.com women midi dress floral", label: "midi_floral" },
  { query: "site:us.shein.com women party dress", label: "party_dresses" },
  { query: "site:us.shein.com women casual dress summer", label: "casual_dresses" },
  { query: "site:us.shein.com women formal dress elegant", label: "formal_dresses" },
  { query: "site:us.shein.com women wrap dress", label: "wrap_dresses" },
  { query: "site:us.shein.com women shirt dress", label: "shirt_dresses" },
  // WOMEN'S TOPS
  { query: "site:us.shein.com women blouse", label: "women_blouses" },
  { query: "site:us.shein.com women t-shirt graphic", label: "women_tshirts" },
  { query: "site:us.shein.com women crop top", label: "women_crop_tops" },
  { query: "site:us.shein.com women bodysuit", label: "women_bodysuits" },
  { query: "site:us.shein.com women tank top camisole", label: "women_tanks" },
  { query: "site:us.shein.com women peplum top", label: "women_peplum" },
  // WOMEN'S BOTTOMS
  { query: "site:us.shein.com women skirt", label: "women_skirts" },
  { query: "site:us.shein.com women jeans high waist", label: "women_jeans" },
  { query: "site:us.shein.com women pants wide leg", label: "women_pants" },
  { query: "site:us.shein.com women shorts", label: "women_shorts" },
  { query: "site:us.shein.com women leggings", label: "women_leggings" },
  { query: "site:us.shein.com women cargo pants", label: "women_cargo" },
  // WOMEN'S OUTERWEAR
  { query: "site:us.shein.com women jacket", label: "women_jackets" },
  { query: "site:us.shein.com women sweater cardigan", label: "women_sweaters" },
  { query: "site:us.shein.com women hoodie sweatshirt", label: "women_hoodies" },
  { query: "site:us.shein.com women blazer", label: "women_blazers" },
  { query: "site:us.shein.com women trench coat", label: "women_trench" },
  // WOMEN'S SETS & JUMPSUITS
  { query: "site:us.shein.com women two piece outfit set", label: "women_twopiece" },
  { query: "site:us.shein.com women jumpsuit romper", label: "women_jumpsuits" },
  { query: "site:us.shein.com women matching set co-ord", label: "women_coord" },
  // PLUS SIZE
  { query: "site:us.shein.com plus size dress", label: "plus_dresses" },
  { query: "site:us.shein.com plus size top blouse", label: "plus_tops" },
  { query: "site:us.shein.com plus size pants jeans", label: "plus_bottoms" },
  // WOMEN'S SHOES
  { query: "site:us.shein.com women heels pumps", label: "women_heels" },
  { query: "site:us.shein.com women sandals", label: "women_sandals" },
  { query: "site:us.shein.com women sneakers", label: "women_sneakers" },
  { query: "site:us.shein.com women boots", label: "women_boots" },
  { query: "site:us.shein.com women flats loafers", label: "women_flats" },
  // BAGS
  { query: "site:us.shein.com women crossbody bag", label: "crossbody_bags" },
  { query: "site:us.shein.com women tote bag handbag", label: "tote_bags" },
  { query: "site:us.shein.com women clutch bag evening", label: "clutch_bags" },
  { query: "site:us.shein.com women shoulder bag", label: "shoulder_bags" },
  // ACCESSORIES
  { query: "site:us.shein.com women jewelry necklace earring", label: "women_jewelry" },
  { query: "site:us.shein.com women sunglasses", label: "women_sunglasses" },
  { query: "site:us.shein.com women scarf hair accessories", label: "women_accessories" },
  // MEN'S
  { query: "site:us.shein.com men t-shirt", label: "men_tshirts" },
  { query: "site:us.shein.com men jacket coat", label: "men_jackets" },
  { query: "site:us.shein.com men pants trousers", label: "men_pants" },
  { query: "site:us.shein.com men jeans", label: "men_jeans" },
  { query: "site:us.shein.com men hoodie sweatshirt", label: "men_hoodies" },
  { query: "site:us.shein.com men shoes sneakers", label: "men_shoes" },
  { query: "site:us.shein.com men shorts", label: "men_shorts" },
  { query: "site:us.shein.com men polo shirt", label: "men_polo" },
  // KIDS
  { query: "site:us.shein.com girls dress", label: "girls_dresses" },
  { query: "site:us.shein.com boys clothing tops", label: "boys_tops" },
  { query: "site:us.shein.com baby girl clothing", label: "baby_girl" },
  { query: "site:us.shein.com baby boy clothing", label: "baby_boy" },
  // SWIM & LINGERIE
  { query: "site:us.shein.com women swimsuit bikini", label: "women_swim" },
  { query: "site:us.shein.com women lingerie bra", label: "women_lingerie" },
  // ACTIVEWEAR
  { query: "site:us.shein.com women activewear sports", label: "women_activewear" },
  { query: "site:us.shein.com women yoga pants leggings", label: "women_yoga" },
  // HOME & BEAUTY (bonus)
  { query: "site:us.shein.com home decor", label: "home_decor" },
  { query: "site:us.shein.com beauty makeup", label: "beauty" },
];

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
    const endMatch = u.pathname.match(/-(\d{7,})(?:\.html)?$/i);
    if (endMatch) return `p${endMatch[1]}`;
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
const isCategoryUrl = (u: string) => /-c-\d+\.html/i.test(u) || /-sc-\d+/i.test(u);

interface SheinProduct {
  title: string;
  price_usd: number;
  image_url: string;
  product_url: string;
  provider_product_id: string;
  brand: string;
  images: string[];
}

// ── FIRECRAWL SEARCH STRATEGY (PRIMARY) ───────────────────────────────────

async function searchSheinProducts(
  searchQuery: string,
  apiKey: string,
  label: string,
): Promise<{ products: SheinProduct[]; error?: string; creditsUsed: number }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: searchQuery,
        limit: RESULTS_PER_QUERY,
        lang: "en",
        country: "us",
        scrapeOptions: {
          formats: ["markdown"],
          onlyMainContent: true,
          waitFor: 3000,
        },
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[SHEIN_SEARCH] HTTP ${resp.status} for "${label}": ${errText.substring(0, 200)}`);
      return { products: [], error: `HTTP ${resp.status}`, creditsUsed: 1 };
    }

    const data = await resp.json();
    const results = data?.data || data?.results || [];
    
    if (!Array.isArray(results) || results.length === 0) {
      console.log(`[SHEIN_SEARCH] 0 results for "${label}"`);
      return { products: [], creditsUsed: 1 };
    }

    console.log(`[SHEIN_SEARCH] ${results.length} search results for "${label}"`);

    const products: SheinProduct[] = [];
    const seenIds = new Set<string>();

    for (const result of results) {
      const url = result.url || result.link || "";
      if (!url || !url.includes("shein.com")) continue;
      
      // Skip category pages — we only want product pages
      if (isCategoryUrl(url)) continue;

      const pid = extractSheinProductId(url);
      if (!pid || seenIds.has(pid)) continue;
      seenIds.add(pid);

      // Extract title from search result
      let title = result.title || "";
      // Clean up SHEIN title formatting
      title = title
        .replace(/\s*\|\s*SHEIN\s*(USA)?/gi, "")
        .replace(/\s*-\s*SHEIN\s*(USA)?/gi, "")
        .replace(/^SHEIN\s+/i, "")
        .replace(/\s*\|.*$/, "")
        .trim();
      if (title.length < 3) continue;

      // Extract price from markdown content or description
      let priceUsd = 0;
      const content = result.markdown || result.description || result.content || "";
      const priceMatches = content.match(/\$[\d,]+(?:\.\d{2})?/g);
      if (priceMatches) {
        for (const pm of priceMatches) {
          const p = parseUsd(pm);
          if (p && p > 0.5 && p < 5000) { priceUsd = p; break; }
        }
      }

      // Extract images from markdown content
      const imgUrls: string[] = [];
      // SHEIN CDN images
      const imgMatches = [...content.matchAll(/(https?:\/\/img\.ltwebstatic\.com\/[^\s"')]+\.(?:jpg|jpeg|png|webp)[^\s"')]*)/gi)];
      for (const im of imgMatches) {
        if (!isSwatchUrl(im[1]) && !/banner/i.test(im[1])) {
          imgUrls.push(im[1]);
        }
      }
      // Also check markdown image syntax
      const mdImgMatches = [...content.matchAll(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g)];
      for (const mim of mdImgMatches) {
        if (mim[1].includes("shein") || mim[1].includes("ltwebstatic")) {
          if (!isSwatchUrl(mim[1])) imgUrls.push(mim[1]);
        }
      }
      // OG image from metadata
      if (result.metadata?.ogImage) {
        imgUrls.unshift(result.metadata.ogImage);
      }

      const uniqueImages = [...new Set(imgUrls)].slice(0, 8);
      const imageUrl = uniqueImages[0] || "";

      products.push({
        title: title.substring(0, 200),
        price_usd: priceUsd,
        image_url: imageUrl,
        product_url: url,
        provider_product_id: pid,
        brand: "SHEIN",
        images: uniqueImages,
      });
    }

    // Credits: 1 for search + N for scraped pages
    const creditsUsed = 1 + results.length;
    console.log(`[SHEIN_SEARCH] "${label}": ${results.length} results → ${products.length} valid products (${creditsUsed} credits)`);
    return { products, creditsUsed };
  } catch (err) {
    console.error(`[SHEIN_SEARCH] error for "${label}": ${(err as Error).message}`);
    return { products: [], error: (err as Error).message, creditsUsed: 0 };
  }
}

// ── FIRECRAWL SEARCH WITHOUT SCRAPE (cheaper — 1 credit per query) ───────

async function searchSheinProductsLight(
  searchQuery: string,
  apiKey: string,
  label: string,
): Promise<{ products: SheinProduct[]; error?: string; creditsUsed: number }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: searchQuery,
        limit: RESULTS_PER_QUERY,
        lang: "en",
        country: "us",
        // No scrapeOptions → returns only search snippets (1 credit)
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { products: [], error: `HTTP ${resp.status}: ${errText.substring(0, 100)}`, creditsUsed: 1 };
    }

    const data = await resp.json();
    const results = data?.data || data?.results || [];

    if (!Array.isArray(results) || results.length === 0) {
      return { products: [], creditsUsed: 1 };
    }

    const products: SheinProduct[] = [];
    const seenIds = new Set<string>();

    for (const result of results) {
      const url = result.url || result.link || "";
      if (!url || !url.includes("shein.com")) continue;
      if (isCategoryUrl(url)) continue;

      const pid = extractSheinProductId(url);
      if (!pid || seenIds.has(pid)) continue;
      seenIds.add(pid);

      let title = (result.title || "")
        .replace(/\s*\|\s*SHEIN\s*(USA)?/gi, "")
        .replace(/\s*-\s*SHEIN\s*(USA)?/gi, "")
        .replace(/^SHEIN\s+/i, "")
        .replace(/\s*\|.*$/, "")
        .trim();
      if (title.length < 3) continue;

      // Extract price from snippet/description
      let priceUsd = 0;
      const snippet = result.description || result.snippet || "";
      const priceMatches = snippet.match(/\$[\d,]+(?:\.\d{2})?/g);
      if (priceMatches) {
        for (const pm of priceMatches) {
          const p = parseUsd(pm);
          if (p && p > 0.5 && p < 5000) { priceUsd = p; break; }
        }
      }

      products.push({
        title: title.substring(0, 200),
        price_usd: priceUsd,
        image_url: "", // No image from light search — will be filled by refresh worker
        product_url: url,
        provider_product_id: pid,
        brand: "SHEIN",
        images: [],
      });
    }

    console.log(`[SHEIN_SEARCH_LIGHT] "${label}": ${results.length} results → ${products.length} valid products`);
    return { products, creditsUsed: 1 };
  } catch (err) {
    return { products: [], error: (err as Error).message, creditsUsed: 0 };
  }
}

// ── STATEFUL ROTATION ─────────────────────────────────────────────────────

async function getRotationState(supabase: any): Promise<{ offset: number }> {
  try {
    const { data } = await supabase
      .from("cars_settings")
      .select("value")
      .eq("key", "scraper_rotation_shein")
      .single();
    return { offset: (data?.value as any)?.offset || 0 };
  } catch { return { offset: 0 }; }
}

async function setRotationState(supabase: any, offset: number): Promise<void> {
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
  const validProducts = products.filter(p => p.title && p.title.length > 5);
  if (validProducts.length === 0 || dryRun) return 0;

  const now = new Date().toISOString();

  // Split into new-inserts vs updates to protect existing prices
  const pids = validProducts.map(p => p.provider_product_id);
  const { data: existing } = await supabase
    .from("catalog_items")
    .select("provider_product_id, price_usd, image_url")
    .eq("provider", "shein")
    .in("provider_product_id", pids);
  const existingMap = new Map((existing || []).map((e: any) => [e.provider_product_id, e]));

  const rows = validProducts.map((p) => {
    const ex = existingMap.get(p.provider_product_id);
    // COALESCE: never overwrite a valid price/image with null
    const price = p.price_usd > 0 ? p.price_usd : (ex?.price_usd > 0 ? ex.price_usd : null);
    const image = p.image_url || ex?.image_url || null;
    return {
      provider: "shein",
      provider_product_id: p.provider_product_id,
      title: p.title.substring(0, 200),
      price_usd: price,
      image_url: image,
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
      images: p.images.length > 0 ? p.images : image ? [image] : null,
      metadata: { source: "firecrawl_search" },
    };
  });

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

// ── PRICE BACKFILL ─────────────────────────────────────────────────────────

async function backfillSheinPrices(
  supabase: any,
  batchSize: number = 50,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ processed: number; updated: number; failed: number; errors: string[] }> {
  // Find SHEIN items missing price or image
  const { data: items, error } = await supabase
    .from("catalog_items")
    .select("id, provider_product_id, product_url, price_usd, image_url")
    .eq("provider", "shein")
    .eq("is_active", true)
    .or("price_usd.is.null,image_url.is.null")
    .limit(batchSize);

  if (error || !items || items.length === 0) {
    console.log(`[SHEIN_BACKFILL] No items to backfill (${error?.message || "0 found"})`);
    return { processed: 0, updated: 0, failed: 0, errors: [] };
  }

  console.log(`[SHEIN_BACKFILL] Processing ${items.length} items`);
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (!item.product_url) {
      failed++;
      continue;
    }
    try {
      const extractUrl = `${supabaseUrl}/functions/v1/extract-price`;
      const resp = await fetch(extractUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: item.product_url }),
      });

      if (!resp.ok) {
        failed++;
        errors.push(`${item.provider_product_id}: HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const newPrice = data.price_usd || data.price || null;
      const newImage = data.image_url || data.image || null;

      if (!newPrice && !newImage) {
        failed++;
        continue;
      }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (newPrice && newPrice > 0) updates.price_usd = newPrice;
      if (newImage && !item.image_url) {
        updates.image_url = newImage;
        updates.images = [newImage];
      }

      const { error: upErr } = await supabase
        .from("catalog_items")
        .update(updates)
        .eq("id", item.id);

      if (upErr) {
        failed++;
        errors.push(`${item.provider_product_id}: ${upErr.message}`);
      } else {
        updated++;
      }

      // Rate limit: 500ms between extract-price calls
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      failed++;
      errors.push(`${item.provider_product_id}: ${(e as Error).message}`);
    }
  }

  console.log(`[SHEIN_BACKFILL] Done: processed=${items.length} updated=${updated} failed=${failed}`);
  return { processed: items.length, updated, failed, errors: errors.slice(0, 10) };
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = req.method === "POST" ? await req.json() : {};
    const queriesPerRun = body.queries_per_run || body.categories_per_run || DEFAULT_QUERIES_PER_RUN;
    const dryRun = body.dry_run || false;
    const useFullScrape = body.full_scrape !== false; // Default: scrape pages for images/prices
    const customQuery = body.custom_query?.trim() || undefined;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";

    if (!firecrawlKey) {
      return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Budget check
    const { data: budgetData } = await supabase.rpc("check_provider_budget", {
      p_provider: "firecrawl:shein",
      p_window_type: "day",
      p_limit: DAILY_CREDIT_CAP,
    });
    if (budgetData && !budgetData.allowed) {
      return new Response(JSON.stringify({
        ok: true, budget_exceeded: true, credits_used: budgetData.count,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get rotation state
    const rotationState = customQuery ? { offset: 0 } : await getRotationState(supabase);
    let { offset } = rotationState;

    // Select queries to run
    let queriesToRun: typeof SEARCH_QUERIES;
    if (customQuery) {
      queriesToRun = [{ query: customQuery, label: "custom" }];
    } else {
      queriesToRun = [];
      for (let i = 0; i < queriesPerRun; i++) {
        const idx = (offset + i) % SEARCH_QUERIES.length;
        queriesToRun.push(SEARCH_QUERIES[idx]);
      }
    }

    console.log(`[SHEIN_SCRAPER] START queries=${queriesToRun.length} offset=${offset} fullScrape=${useFullScrape} budget=${budgetData?.count || 0}/${DAILY_CREDIT_CAP}`);

    const allProducts: SheinProduct[] = [];
    const globalSeenIds = new Set<string>();
    let totalCreditsUsed = 0;
    const queryResults: Record<string, number> = {};

    for (const q of queriesToRun) {
      if (Date.now() - startTime > HARD_FUNCTION_CAP_MS - 15000) {
        console.log(`[SHEIN_SCRAPER] time limit approaching, stopping`);
        break;
      }

      // Use full scrape for richer data (images+prices) or light mode to save credits
      const searchFn = useFullScrape ? searchSheinProducts : searchSheinProductsLight;
      const { products, error, creditsUsed } = await searchFn(q.query, firecrawlKey, q.label);

      totalCreditsUsed += creditsUsed;

      // Track credits in budget
      for (let c = 0; c < creditsUsed; c++) {
        await supabase.rpc("increment_provider_budget", {
          p_provider: "firecrawl:shein",
          p_window_type: "day",
          p_limit: DAILY_CREDIT_CAP,
        });
      }

      if (error) {
        console.error(`[SHEIN_SCRAPER] error for "${q.label}": ${error}`);
        queryResults[q.label] = 0;
      } else {
        let added = 0;
        for (const p of products) {
          if (!globalSeenIds.has(p.provider_product_id)) {
            globalSeenIds.add(p.provider_product_id);
            allProducts.push(p);
            added++;
          }
        }
        queryResults[q.label] = added;
      }

      // Small delay between searches
      await new Promise((r) => setTimeout(r, 800));
    }

    // Advance rotation
    const nextOffset = customQuery ? offset : (offset + queriesToRun.length) % SEARCH_QUERIES.length;
    if (!customQuery) {
      await setRotationState(supabase, nextOffset);
    }

    // Upsert
    const upsertedCount = await upsertProducts(supabase, allProducts, dryRun);

    const elapsedMs = Date.now() - startTime;
    const result = {
      ok: true,
      provider: "shein",
      strategy: useFullScrape ? "firecrawl_search_full" : "firecrawl_search_light",
      queries_executed: queriesToRun.length,
      query_pool_size: SEARCH_QUERIES.length,
      rotation_offset: offset,
      next_offset: nextOffset,
      products_found: allProducts.length,
      products_with_images: allProducts.filter(p => p.image_url).length,
      products_with_prices: allProducts.filter(p => p.price_usd > 0).length,
      upserted_count: upsertedCount,
      credits_used: totalCreditsUsed,
      query_results: queryResults,
      sample: allProducts.slice(0, 5).map(p => ({
        pid: p.provider_product_id,
        title: p.title?.substring(0, 80),
        price: p.price_usd,
        image: p.image_url ? "yes" : "no",
        url: p.product_url?.substring(0, 100),
      })),
      elapsed_ms: elapsedMs,
      dry_run: dryRun,
    };

    console.log(`[SHEIN_SCRAPER] DONE ${elapsedMs}ms found=${allProducts.length} upserted=${upsertedCount} credits=${totalCreditsUsed}`);

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
