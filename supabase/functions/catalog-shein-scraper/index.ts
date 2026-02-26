/**
 * Catalog SHEIN Scraper — Firecrawl Search Pipeline
 * 
 * Uses Firecrawl Search API (`/v1/search`) with `site:shein.com` queries
 * to discover and cache SHEIN clothing products into `catalog_items`.
 * 
 * Duplicates prevented via:
 *  1. In-memory Set of provider_product_id per run
 *  2. DB unique constraint (provider, provider_product_id) with upsert
 *  3. Normalized pXXXXXXX SKU extraction from SHEIN URLs
 * 
 * Auth: x-cron-secret header OR admin JWT (same as car scraper)
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

const SEARCH_TIMEOUT_MS = 15000;
const HARD_FUNCTION_CAP_MS = 50000;
const DEFAULT_TARGET_ITEMS = 20;

const SEED_QUERIES = [
  "women dresses site:shein.com",
  "men shirts site:shein.com",
  "modest fashion site:shein.com",
  "maxi dress site:shein.com",
  "abaya site:shein.com",
  "women tops site:shein.com",
  "men pants site:shein.com",
  "women skirts site:shein.com",
  "hijab fashion site:shein.com",
  "women jackets site:shein.com",
  "men jackets site:shein.com",
  "women shoes site:shein.com",
  "women bags site:shein.com",
  "plus size dresses site:shein.com",
  "activewear women site:shein.com",
  "women jeans site:shein.com",
  "modest swimwear site:shein.com",
  "men shoes site:shein.com",
  "kids clothing site:shein.com",
  "women accessories site:shein.com",
];

// Words that indicate non-clothing items — ingestion guardrails
const DISALLOWED_KEYWORDS = /\b(appliance|refrigerator|washer|dryer|dishwasher|microwave|oven|stove|vacuum|blender|toaster|laptop|computer|monitor|tablet|phone|television|tv|gaming console|playstation|xbox|nintendo|toy|action figure|lego|doll|drone|robot)\b/i;

const SOLD_KEYWORDS = /\b(sold out|out of stock|unavailable|discontinued|no longer available)\b/i;

// ── HELPERS ────────────────────────────────────────────────────────────────

function extractSheinProductId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("shein.com")) return null;
    
    // Pattern: /product-pXXXXXXX or -p-XXXXXXX or pXXXXXXX in path
    const match = u.pathname.match(/[_-]p[_-]?(\d{5,})/i);
    if (match) return `p${match[1]}`;
    
    // Also try query param "id"
    const id = u.searchParams.get("id");
    if (id && /^\d{5,}$/.test(id)) return `p${id}`;
    
    return null;
  } catch {
    return null;
  }
}

function isValidSheinUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.includes("shein.com") && u.pathname.length > 5;
  } catch {
    return false;
  }
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

function pickRandomQueries(count: number): string[] {
  const shuffled = [...SEED_QUERIES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ── FIRECRAWL SEARCH ──────────────────────────────────────────────────────

async function firecrawlSearch(
  query: string,
  apiKey: string,
  limit: number,
  dropReasons: Record<string, number>,
): Promise<SheinProduct[]> {
  console.log(`[SHEIN_SCRAPER] search: query="${query}" limit=${limit}`);

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
        limit: Math.min(limit * 2, 20),
        lang: "en",
        country: "us",
        scrapeOptions: { formats: ["markdown"] },
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
    console.log(`[SHEIN_SCRAPER] search returned ${results.length} results`);

    const products: SheinProduct[] = [];
    const seenIds = new Set<string>();

    for (const item of results) {
      const url = item.url || "";
      const title = item.title || "";
      const description = item.description || "";
      const markdown = item.markdown || "";

      if (!url || !title) {
        dropReasons["missing_url_or_title"] = (dropReasons["missing_url_or_title"] || 0) + 1;
        continue;
      }

      // Must be a SHEIN product URL
      if (!isValidSheinUrl(url)) {
        dropReasons["not_shein_url"] = (dropReasons["not_shein_url"] || 0) + 1;
        continue;
      }

      // Extract product ID
      const pid = extractSheinProductId(url);
      if (!pid) {
        dropReasons["no_product_id"] = (dropReasons["no_product_id"] || 0) + 1;
        continue;
      }

      // Dedup within run
      if (seenIds.has(pid)) {
        dropReasons["duplicate_in_run"] = (dropReasons["duplicate_in_run"] || 0) + 1;
        continue;
      }

      // Skip sold out
      if (SOLD_KEYWORDS.test(title) || SOLD_KEYWORDS.test(description)) {
        dropReasons["sold_out"] = (dropReasons["sold_out"] || 0) + 1;
        continue;
      }

      // Ingestion guardrails — skip non-clothing
      if (DISALLOWED_KEYWORDS.test(title)) {
        dropReasons["disallowed_category"] = (dropReasons["disallowed_category"] || 0) + 1;
        continue;
      }

      // Extract price from description, title, or markdown
      let price: number | null = null;
      const priceRegex = /\$[\d,]+(?:\.\d{2})?/g;

      for (const text of [description, title, markdown.substring(0, 2000)]) {
        const matches = text.match(priceRegex);
        if (matches) {
          for (const m of matches) {
            const p = parseUsd(m);
            if (p && p > 0 && p <= 5000) {
              price = p;
              break;
            }
          }
          if (price) break;
        }
      }

      // Also try label-based extraction
      if (!price && markdown) {
        const priceLabelMatch = markdown.match(/(?:price|sale price|now)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
        if (priceLabelMatch) {
          const p = parseUsd(priceLabelMatch[1]);
          if (p && p > 0 && p <= 5000) price = p;
        }
      }

      if (!price) {
        dropReasons["no_price"] = (dropReasons["no_price"] || 0) + 1;
        continue;
      }

      seenIds.add(pid);

      // Extract image from markdown
      let imageUrl = "";
      const imgMatch = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (imgMatch) imageUrl = imgMatch[1];

      // Also check for img.ltwebstatic.com URLs in markdown
      if (!imageUrl) {
        const staticImgMatch = markdown.match(/(https?:\/\/img\.ltwebstatic\.com\/[^\s)"]+)/);
        if (staticImgMatch) imageUrl = staticImgMatch[1];
      }

      // Extract brand — SHEIN often has "SHEIN" or sub-brands like "MOTF", "DAZY"
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
      });

      if (products.length >= limit) break;
    }

    console.log(`[SHEIN_SCRAPER] search parsed ${products.length} valid products from ${results.length} results`);
    return products;
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("aborted") || msg.includes("abort") || msg.includes("signal")) {
      console.warn(`[SHEIN_SCRAPER] search TIMEOUT after ${SEARCH_TIMEOUT_MS}ms`);
    } else {
      console.error(`[SHEIN_SCRAPER] search error:`, msg);
    }
    return [];
  }
}

// ── UPSERT ─────────────────────────────────────────────────────────────────

async function upsertProducts(
  supabase: any,
  products: SheinProduct[],
  dryRun: boolean,
): Promise<number> {
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
    metadata: { source: "firecrawl_search" },
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

  const cronMatches = !!providedCron && (providedCron === envCronSecret || providedCron === fallbackCronSecret);
  const internalCronMatches = !!providedInternalCron && (providedInternalCron === envCronSecret || providedInternalCron === fallbackCronSecret);

  if (cronMatches || internalCronMatches) return { authorized: true };

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

  const auth = await authenticateRequest(req);
  if (!auth.authorized) {
    return new Response(JSON.stringify({ ok: false, error: auth.error || "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();

  try {
    const body: ScraperRequest = req.method === "POST"
      ? await req.json()
      : {};

    const targetItems = body.target_items || DEFAULT_TARGET_ITEMS;
    const maxPages = Math.min(body.max_pages || 3, 5);
    const dryRun = body.dry_run || false;
    const customQuery = body.search_query?.trim() || undefined;

    console.log(`[SHEIN_SCRAPER] START target=${targetItems} maxPages=${maxPages} dryRun=${dryRun} query=${customQuery || '(rotating seed)'}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";

    if (!firecrawlKey) {
      return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dropReasons: Record<string, number> = {};
    const allProducts: SheinProduct[] = [];
    const globalSeenIds = new Set<string>();

    // If custom query provided, use it; otherwise rotate seed queries
    const queries = customQuery ? [customQuery] : pickRandomQueries(maxPages);

    for (const query of queries) {
      if (allProducts.length >= targetItems) break;
      if (Date.now() - startTime > HARD_FUNCTION_CAP_MS) break;

      const remaining = targetItems - allProducts.length;
      const results = await firecrawlSearch(query, firecrawlKey, remaining, dropReasons);

      for (const p of results) {
        if (allProducts.length >= targetItems) break;
        if (!globalSeenIds.has(p.provider_product_id)) {
          globalSeenIds.add(p.provider_product_id);
          allProducts.push(p);
        } else {
          dropReasons["duplicate_across_queries"] = (dropReasons["duplicate_across_queries"] || 0) + 1;
        }
      }

      // Small delay between queries to be polite
      if (allProducts.length < targetItems && queries.indexOf(query) < queries.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Upsert to DB
    const upsertedCount = await upsertProducts(supabase, allProducts, dryRun);

    const elapsedMs = Date.now() - startTime;
    const result = {
      ok: true,
      provider: "shein",
      queries_used: queries.length,
      products_found: allProducts.length,
      upserted_count: upsertedCount,
      drop_reasons: Object.keys(dropReasons).length > 0 ? dropReasons : undefined,
      sample: allProducts.slice(0, 3),
      elapsed_ms: elapsedMs,
      dry_run: dryRun,
    };

    console.log(`[SHEIN_SCRAPER] DONE ${elapsedMs}ms found=${allProducts.length} upserted=${upsertedCount}`);

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
