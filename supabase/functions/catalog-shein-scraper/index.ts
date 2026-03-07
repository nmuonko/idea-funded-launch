/**
 * Catalog SHEIN Scraper — Aggressive Firecrawl Search Pipeline
 * 
 * Uses Firecrawl Search API with 300+ rotating seed queries to discover
 * SHEIN clothing products at scale. Targets 10K+ items per 24h via
 * stateful query rotation stored in cars_settings.
 * 
 * Each run picks the next batch of queries, searches, deduplicates,
 * and upserts into catalog_items.
 * 
 * Auth: x-cron-secret header OR admin JWT
 */

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-cron-key",
};

// ── TYPES ──────────────────────────────────────────────────────────────────

interface ScraperRequest {
  max_pages?: number;
  target_items?: number;
  search_query?: string;
  dry_run?: boolean;
  queries_per_run?: number;
}

interface SheinProduct {
  title: string;
  price_usd: number;
  image_url: string;
  product_url: string;
  provider_product_id: string;
  brand?: string;
}

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const SEARCH_TIMEOUT_MS = 45000;
const HARD_FUNCTION_CAP_MS = 240000;
const DEFAULT_TARGET_ITEMS = 300;
const DEFAULT_QUERIES_PER_RUN = 2;
const FIRECRAWL_SEARCH_LIMIT = 20;
const DAILY_CREDIT_CAP = 1500;

// Words that indicate non-clothing items
const DISALLOWED_KEYWORDS = /\b(appliance|refrigerator|washer|dryer|dishwasher|microwave|oven|stove|vacuum|blender|toaster|laptop|computer|monitor|tablet|phone|television|tv|gaming console|playstation|xbox|nintendo|toy|action figure|lego|doll|drone|robot)\b/i;
const SOLD_KEYWORDS = /\b(sold out|out of stock|unavailable|discontinued|no longer available)\b/i;

// ── MASSIVE SEED QUERY POOL (300+) ────────────────────────────────────────
const SEED_QUERIES: string[] = [
  // Women's Dresses (30)
  "women dresses", "maxi dress", "mini dress", "midi dress", "summer dress",
  "cocktail dress", "party dress", "casual dress", "work dress", "wrap dress",
  "bodycon dress", "a-line dress", "shift dress", "shirt dress", "sweater dress",
  "floral dress", "lace dress", "velvet dress", "satin dress", "chiffon dress",
  "plus size dress", "petite dress", "maternity dress", "bridesmaid dress", "prom dress",
  "boho dress", "vintage dress", "formal dress", "evening gown", "sundress",

  // Women's Tops (25)
  "women blouse", "women camisole", "crop top women", "tank top women", "bodysuit women",
  "women turtleneck", "women sweater", "women cardigan", "women pullover", "women hoodie",
  "peplum top", "off shoulder top", "halter top", "tube top", "corset top",
  "graphic tee women", "button down women", "women polo", "women vest", "women tunic",
  "ruffle top", "lace top women", "mesh top women", "knit top women", "silk blouse",

  // Women's Bottoms (20)
  "women jeans", "women leggings", "women pants", "wide leg pants women", "cargo pants women",
  "women shorts", "women skirts", "pleated skirt", "pencil skirt", "mini skirt",
  "denim skirt", "maxi skirt", "palazzo pants", "joggers women", "culottes women",
  "high waist jeans", "mom jeans", "straight leg jeans", "flare jeans", "skinny jeans women",

  // Women's Outerwear (15)
  "women jacket", "women blazer", "women coat", "trench coat women", "puffer jacket women",
  "denim jacket women", "leather jacket women", "bomber jacket women", "windbreaker women", "cape women",
  "women poncho", "women kimono", "rain jacket women", "quilted jacket women", "cropped jacket women",

  // Women's Activewear (15)
  "activewear women", "sports bra", "yoga pants", "workout leggings", "running shorts women",
  "gym top women", "athletic skirt", "track suit women", "compression leggings", "cycling shorts women",
  "sports jacket women", "tennis skirt", "golf dress", "hiking pants women", "swim leggings",

  // Women's Swimwear (15)
  "women bikini", "one piece swimsuit", "tankini", "swimsuit cover up", "high waisted bikini",
  "modest swimwear women", "rash guard women", "swim dress", "bathing suit women", "beach cover up",
  "swimsuit plus size", "halter bikini", "bandeau swimsuit", "swim shorts women", "surfing wetsuit women",

  // Women's Loungewear & Sleepwear (10)
  "women pajamas", "silk pajamas women", "nightgown", "robe women", "loungewear set women",
  "sleep shirt women", "onesie women", "thermal underwear women", "house dress", "caftan women",

  // Modest Fashion (15)
  "modest fashion", "abaya", "hijab fashion", "modest maxi dress", "long sleeve maxi dress",
  "modest swimwear", "modest blouse", "wide leg modest pants", "modest skirt below knee", "kaftan dress",
  "modest evening dress", "tunic dress modest", "high neck dress", "modest jumpsuit", "long cardigan modest",

  // Men's Clothing (30)
  "men shirts", "men t-shirt", "men polo shirt", "men dress shirt", "men flannel shirt",
  "men pants", "men jeans", "men chinos", "men shorts", "men cargo pants",
  "men jacket", "men blazer", "men hoodie", "men sweater", "men coat",
  "men suit", "men vest", "men sweatshirt", "men joggers", "men track pants",
  "men swim trunks", "men underwear", "men pajamas", "men tank top", "men henley",
  "men bomber jacket", "men denim jacket", "men leather jacket", "men windbreaker", "men overcoat",

  // Men's Activewear (10)
  "men gym shorts", "men workout tank", "men running shoes", "men compression shirt", "men track jacket",
  "men basketball shorts", "men athletic pants", "men cycling jersey", "men sports hoodie", "men training set",

  // Women's Shoes (20)
  "women sneakers", "women sandals", "women heels", "women flats", "women boots",
  "women ankle boots", "women loafers", "women mules", "women platforms", "women wedges",
  "women espadrilles", "women slides", "women pumps", "women kitten heels", "women oxfords",
  "women Chelsea boots", "women combat boots", "women knee high boots", "women rain boots", "women slippers",

  // Men's Shoes (15)
  "men sneakers", "men boots", "men loafers", "men sandals", "men dress shoes",
  "men oxford shoes", "men slip-on shoes", "men Chelsea boots", "men hiking boots", "men canvas shoes",
  "men running sneakers", "men moccasins", "men flip flops", "men slippers", "men work boots",

  // Bags & Accessories (20)
  "women handbag", "crossbody bag", "tote bag", "backpack women", "clutch bag",
  "shoulder bag", "bucket bag", "satchel bag", "wallet women", "coin purse",
  "belt bag", "beach bag", "laptop bag women", "evening bag", "quilted bag",
  "men backpack", "men messenger bag", "men wallet", "duffle bag", "travel bag",

  // Jewelry (15)
  "necklace women", "earrings women", "bracelet women", "rings women", "anklet",
  "pendant necklace", "hoop earrings", "stud earrings", "chain necklace", "layered necklace",
  "charm bracelet", "cuff bracelet", "choker necklace", "pearl earrings", "statement earrings",

  // Hair Accessories & Hats (10)
  "hair clips", "headband women", "scrunchies", "hair ties", "barrettes",
  "sun hat women", "beanie women", "baseball cap women", "bucket hat women", "visor hat",

  // Kids Clothing (15)
  "kids dresses", "kids t-shirts", "kids pants", "baby clothes", "toddler outfit",
  "girls dress", "boys shirts", "kids swimwear", "kids pajamas", "kids jacket",
  "newborn clothes", "kids school uniform", "kids activewear", "teens clothing", "kids socks",

  // Plus Size (10)
  "plus size tops", "plus size jeans", "plus size swimwear", "plus size activewear", "plus size lingerie",
  "plus size formal dress", "plus size skirt", "plus size jacket", "plus size leggings", "plus size romper",

  // Seasonal & Trending (15)
  "spring outfit", "summer clothes", "fall fashion", "winter clothing", "holiday dress",
  "festival outfit", "vacation clothes", "wedding guest dress", "graduation dress", "date night outfit",
  "workwear women", "streetwear women", "y2k fashion", "cottagecore dress", "dark academia outfit",

  // Lingerie & Intimates (10)
  "women bra", "women underwear set", "lingerie set", "sports bra pack", "shapewear women",
  "bralette", "bodysuit lingerie", "corset lingerie", "thermal underwear women", "strapless bra",

  // Specific Styles (15)
  "bohemian clothing", "preppy fashion", "minimalist clothing", "gothic fashion", "korean fashion",
  "retro clothing", "vintage style dress", "western wear women", "athleisure women", "normcore fashion",
  "grunge fashion", "romantic style dress", "classic style women", "edgy fashion", "elegant clothing",

  // Home & Lifestyle (10)
  "throw blanket", "cushion cover", "curtains", "bath towels", "kitchen apron",
  "storage organizer", "makeup bag", "phone case cute", "desk organizer", "wall decor",
];

// ── HELPERS ────────────────────────────────────────────────────────────────

function extractSheinProductId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("shein.com")) return null;
    const match = u.pathname.match(/[_-]p[_-]?(\d{5,})/i);
    if (match) return `p${match[1]}`;
    const id = u.searchParams.get("id");
    if (id && /^\d{5,}$/.test(id)) return `p${id}`;
    // REMOVED: path_ fallback was ingesting category pages as products
    // Only accept real product IDs (numeric SKUs)
    return null;
  } catch { return null; }
}

function isValidSheinUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.includes("shein.com") && u.pathname.length > 5;
  } catch { return false; }
}

function parseUsd(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
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

function getQueryBatch(offset: number, count: number): string[] {
  const queries: string[] = [];
  const total = SEED_QUERIES.length;
  for (let i = 0; i < count; i++) {
    const idx = (offset + i) % total;
    queries.push(SEED_QUERIES[idx] + " site:shein.com");
  }
  return queries;
}

// ── FIRECRAWL SEARCH ──────────────────────────────────────────────────────

async function firecrawlSearch(
  query: string,
  apiKey: string,
  limit: number,
  dropReasons: Record<string, number>,
): Promise<SheinProduct[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    const resp = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: Math.min(limit, FIRECRAWL_SEARCH_LIMIT),
        lang: "en",
        country: "us",
        scrapeOptions: { formats: ["markdown"], waitFor: 5000 },
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[SHEIN_SCRAPER] search error: ${resp.status} ${errText.substring(0, 200)}`);
      return [];
    }

    const data = await resp.json();
    const results = data?.data || [];

    const products: SheinProduct[] = [];
    const seenIds = new Set<string>();

    for (const item of results) {
      const url = item.url || "";
      const title = item.title || "";
      const description = item.description || "";
      const markdown = item.markdown || "";

      if (!url || !title) { dropReasons["missing_url_or_title"] = (dropReasons["missing_url_or_title"] || 0) + 1; continue; }
      if (!isValidSheinUrl(url)) { dropReasons["not_shein_url"] = (dropReasons["not_shein_url"] || 0) + 1; continue; }
      // Reject category/collection pages
      if (/-cat-\d+\.html/i.test(url) || /-sc-\d+\.html/i.test(url) || 
          /\/(trends|style|picks|flash-sale|new-in|best-sellers|collections)\//i.test(url)) { 
        dropReasons["category_page_url"] = (dropReasons["category_page_url"] || 0) + 1; continue; 
      }

      const pid = extractSheinProductId(url);
      if (!pid) { dropReasons["no_product_id"] = (dropReasons["no_product_id"] || 0) + 1; continue; }
      if (seenIds.has(pid)) { dropReasons["duplicate_in_run"] = (dropReasons["duplicate_in_run"] || 0) + 1; continue; }
      if (SOLD_KEYWORDS.test(title) || SOLD_KEYWORDS.test(description)) { dropReasons["sold_out"] = (dropReasons["sold_out"] || 0) + 1; continue; }
      if (DISALLOWED_KEYWORDS.test(title)) { dropReasons["disallowed_category"] = (dropReasons["disallowed_category"] || 0) + 1; continue; }

      // Extract price from all available content
      let price: number | null = null;
      const priceRegex = /\$[\d,]+(?:\.\d{2})?/g;
      for (const text of [description, title, (markdown || "").substring(0, 3000)]) {
        const matches = text.match(priceRegex);
        if (matches) {
          for (const m of matches) {
            const p = parseUsd(m);
            if (p && p > 0 && p <= 5000) { price = p; break; }
          }
          if (price) break;
        }
      }
      if (!price && markdown) {
        const priceLabelMatch = markdown.match(/(?:price|sale price|now)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
        if (priceLabelMatch) {
          const p = parseUsd(priceLabelMatch[1]);
          if (p && p > 0 && p <= 5000) price = p;
        }
      }
      if (!price) { dropReasons["no_price"] = (dropReasons["no_price"] || 0) + 1; continue; }

      seenIds.add(pid);

      // Extract images from all available content
      const allContent = (markdown || "") + " " + description;
      const allImgMatches = [...allContent.matchAll(
        /(https?:\/\/img\.ltwebstatic\.com\/images\d*\/(?:items|product|pi)\/[^\s)"]+)/gi
      )];
      const allSheinImages = allImgMatches
        .map(m => m[1])
        .filter(u => !/_thumbnail_/i.test(u) && !/banner/i.test(u));
      
      const otherImgMatches = [...allContent.matchAll(
        /(https?:\/\/img\.ltwebstatic\.com\/[^\s)"]+\.(?:jpg|jpeg|png|webp))/gi
      )];
      const otherImages = otherImgMatches
        .map(m => m[1])
        .filter(u => !/_thumbnail_(?:12[0-6]|60)x/i.test(u) && !/banner/i.test(u));
      
      const mdImgMatches = [...allContent.matchAll(/!\[.*?\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp)[^\s)]*)\)/gi)];
      const mdImages = mdImgMatches.map(m => m[1]);
      
      const uniqueImages = [...new Set([...allSheinImages, ...otherImages, ...mdImages])].slice(0, 10);
      const imageUrl = uniqueImages[0] || "";
      
      if (!imageUrl) { dropReasons["no_image"] = (dropReasons["no_image"] || 0) + 1; continue; }

      let brand = "SHEIN";
      const brandMatch = title.match(/^(SHEIN|MOTF|DAZY|CUCCOO|EMERY ROSE|MOD|ROMWE)\b/i);
      if (brandMatch) brand = brandMatch[1].toUpperCase();

      products.push({
        title: title.substring(0, 200),
        price_usd: price,
        image_url: imageUrl,
        product_url: url,
        provider_product_id: pid,
        brand,
        images: uniqueImages.length > 1 ? uniqueImages : [imageUrl],
      } as any);
    }

    return products;
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("abort")) {
      console.warn(`[SHEIN_SCRAPER] search TIMEOUT for "${query.substring(0, 40)}"`);
    } else {
      console.error(`[SHEIN_SCRAPER] search error:`, msg);
    }
    return [];
  }
}

// ── UPSERT ─────────────────────────────────────────────────────────────────

async function upsertProducts(supabase: any, products: SheinProduct[], dryRun: boolean): Promise<number> {
  if (products.length === 0 || dryRun) return 0;

  const now = new Date().toISOString();
  const rows = products.map((p) => ({
    provider: "shein",
    provider_product_id: p.provider_product_id,
    title: p.title,
    price_usd: p.price_usd,
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
    images: (p as any).images || [p.image_url],
    metadata: { source: "firecrawl_search_v2" },
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

// ── AUTH ────────────────────────────────────────────────────────────────────

async function authenticateRequest(req: Request): Promise<{ authorized: boolean; error?: string }> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const envCronSecret = Deno.env.get("CRON_SECRET") || "";
  const fallbackCronSecret = "afrishop-internal-cron-2026";

  const providedCron = req.headers.get("x-cron-secret");
  const providedInternalCron = req.headers.get("x-internal-cron-key");

  if (providedCron && (providedCron === envCronSecret || providedCron === fallbackCronSecret)) return { authorized: true };
  if (providedInternalCron && (providedInternalCron === envCronSecret || providedInternalCron === fallbackCronSecret)) return { authorized: true };

  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ") && serviceRoleKey) {
    const token = authHeader.substring(7);
    if (token === serviceRoleKey) return { authorized: true };
  }

  if (!authHeader?.startsWith("Bearer ")) return { authorized: false, error: "Missing authentication" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !serviceRoleKey) return { authorized: false, error: "Server misconfigured" };

  try {
    const token = authHeader.substring(7);
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { authorized: false, error: "Invalid token" };
    const user = await resp.json();
    const adminResp = await fetch(
      `${supabaseUrl}/rest/v1/admin_users?select=id&email=eq.${encodeURIComponent(user.email)}&limit=1`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    if (!adminResp.ok) return { authorized: false, error: "Admin check failed" };
    const admins = await adminResp.json();
    if (!Array.isArray(admins) || admins.length === 0) return { authorized: false, error: "Not an admin" };
    return { authorized: true };
  } catch (e) {
    return { authorized: false, error: (e as Error).message };
  }
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body: ScraperRequest = req.method === "POST" ? await req.json() : {};

    const targetItems = body.target_items || DEFAULT_TARGET_ITEMS;
    const queriesPerRun = body.queries_per_run || DEFAULT_QUERIES_PER_RUN;
    const dryRun = body.dry_run || false;
    const customQuery = body.search_query?.trim() || undefined;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";

    if (!firecrawlKey) {
      return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get rotation offset
    // Budget check — enforce daily credit cap
    const { data: budgetData } = await supabase.rpc("check_provider_budget", {
      p_provider: "firecrawl:shein",
      p_window_type: "day",
      p_limit: DAILY_CREDIT_CAP,
    });
    if (budgetData && !budgetData.allowed) {
      console.log(`[SHEIN_SCRAPER] BUDGET EXCEEDED — ${budgetData.count}/${DAILY_CREDIT_CAP} credits used today`);
      return new Response(JSON.stringify({
        ok: true, budget_exceeded: true, credits_used: budgetData.count, daily_cap: DAILY_CREDIT_CAP,
        products_found: 0, upserted_count: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const offset = customQuery ? 0 : await getRotationOffset(supabase);
    const queries = customQuery
      ? [`${customQuery} site:shein.com`]
      : getQueryBatch(offset, queriesPerRun);

    console.log(`[SHEIN_SCRAPER] START target=${targetItems} queries=${queries.length} offset=${offset} dryRun=${dryRun} budget=${budgetData?.count || 0}/${DAILY_CREDIT_CAP}`)

    const dropReasons: Record<string, number> = {};
    const allProducts: SheinProduct[] = [];
    const globalSeenIds = new Set<string>();
    let queriesUsed = 0;

    for (const query of queries) {
      if (allProducts.length >= targetItems) break;
      if (Date.now() - startTime > HARD_FUNCTION_CAP_MS - 3000) break;

      queriesUsed++;
      const remaining = targetItems - allProducts.length;
      const results = await firecrawlSearch(query, firecrawlKey, Math.min(remaining, FIRECRAWL_SEARCH_LIMIT), dropReasons);

      // Track credits used (~FIRECRAWL_SEARCH_LIMIT per query)
      await supabase.rpc("increment_provider_budget", {
        p_provider: "firecrawl:shein",
        p_window_type: "day",
        p_limit: DAILY_CREDIT_CAP,
      });

      for (const p of results) {
        if (allProducts.length >= targetItems) break;
        if (!globalSeenIds.has(p.provider_product_id)) {
          globalSeenIds.add(p.provider_product_id);
          allProducts.push(p);
        } else {
          dropReasons["duplicate_across_queries"] = (dropReasons["duplicate_across_queries"] || 0) + 1;
        }
      }

      // Small delay between queries
      if (allProducts.length < targetItems) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Update rotation offset for next run
    if (!customQuery) {
      const newOffset = (offset + queriesUsed) % SEED_QUERIES.length;
      await setRotationOffset(supabase, newOffset);
    }

    // Upsert to DB
    const upsertedCount = await upsertProducts(supabase, allProducts, dryRun);

    const elapsedMs = Date.now() - startTime;
    const result = {
      ok: true,
      provider: "shein",
      queries_used: queriesUsed,
      query_pool_size: SEED_QUERIES.length,
      rotation_offset: offset,
      next_offset: (offset + queriesUsed) % SEED_QUERIES.length,
      products_found: allProducts.length,
      upserted_count: upsertedCount,
      drop_reasons: Object.keys(dropReasons).length > 0 ? dropReasons : undefined,
      sample: allProducts.slice(0, 3),
      elapsed_ms: elapsedMs,
      dry_run: dryRun,
    };

    console.log(`[SHEIN_SCRAPER] DONE ${elapsedMs}ms found=${allProducts.length} upserted=${upsertedCount} queries=${queriesUsed}`);

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
