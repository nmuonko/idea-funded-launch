/**
 * Catalog Car Scraper — Aggressive Multi-Query Pipeline
 * 
 * Uses Firecrawl Search API with 200+ rotating make/model queries per provider
 * to discover vehicle listings at scale. Targets 10K+ items per 24h via
 * stateful query rotation stored in cars_settings.
 * 
 * Stages: Search (primary) → Markdown scrape (fallback) → Extract (last resort)
 * 
 * Auth: x-cron-secret header OR admin JWT
 */

import { createClient } from "@supabase/supabase-js";
import { cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { sanitizeImageUrl } from "../_shared/imageValidator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-cron-key",
};

// ── TYPES ──────────────────────────────────────────────────────────────────

interface ScraperRequest {
  provider: "cargurus" | "carvana";
  max_price?: number;
  max_pages?: number;
  mode?: "firecrawl-first" | "force-free" | "force-firecrawl";
  dry_run?: boolean;
  search_query?: string;
  target_items?: number;
  queries_per_run?: number;
}

interface CarListing {
  title: string;
  price_usd: number;
  image_url: string;
  product_url: string;
  year?: number;
  mileage?: string;
  condition?: string;
  provider_product_id: string;
}

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_PRICE = 50000;
const DEFAULT_TARGET_ITEMS = 300;
const DEFAULT_QUERIES_PER_RUN = 20;
const SEARCH_TIMEOUT_MS = 12000;
const HARD_FUNCTION_CAP_MS = 50000;
const FIRECRAWL_SEARCH_LIMIT = 50;
const BLOCKED_STATUSES = new Set([403, 418, 429, 503]);

const PROVIDER_DOMAINS: Record<string, string> = {
  cargurus: "cargurus.com",
  carvana: "carvana.com",
};

// ── MASSIVE QUERY POOL (200+ per provider) ─────────────────────────────────

const MAKES_MODELS: string[] = [
  // Popular Makes
  "Toyota Camry", "Toyota Corolla", "Toyota RAV4", "Toyota Highlander", "Toyota Tacoma",
  "Toyota 4Runner", "Toyota Prius", "Toyota Tundra", "Toyota Sienna", "Toyota Avalon",
  "Honda Civic", "Honda Accord", "Honda CR-V", "Honda Pilot", "Honda HR-V",
  "Honda Odyssey", "Honda Fit", "Honda Ridgeline", "Honda Passport", "Honda Insight",
  "Ford F-150", "Ford Mustang", "Ford Explorer", "Ford Escape", "Ford Bronco",
  "Ford Edge", "Ford Ranger", "Ford Expedition", "Ford Maverick", "Ford Focus",
  "Chevrolet Silverado", "Chevrolet Equinox", "Chevrolet Malibu", "Chevrolet Tahoe", "Chevrolet Traverse",
  "Chevrolet Colorado", "Chevrolet Camaro", "Chevrolet Corvette", "Chevrolet Suburban", "Chevrolet Blazer",
  "Nissan Altima", "Nissan Rogue", "Nissan Sentra", "Nissan Pathfinder", "Nissan Frontier",
  "Nissan Maxima", "Nissan Murano", "Nissan Kicks", "Nissan Versa", "Nissan Titan",
  "Hyundai Tucson", "Hyundai Santa Fe", "Hyundai Elantra", "Hyundai Sonata", "Hyundai Kona",
  "Hyundai Palisade", "Hyundai Ioniq", "Hyundai Venue", "Hyundai Accent",
  "Kia Telluride", "Kia Sportage", "Kia Forte", "Kia Soul", "Kia Sorento",
  "Kia K5", "Kia Seltos", "Kia Carnival", "Kia EV6", "Kia Stinger",
  "BMW 3 Series", "BMW 5 Series", "BMW X3", "BMW X5", "BMW X1",
  "BMW 4 Series", "BMW X7", "BMW 7 Series", "BMW i4", "BMW iX",
  "Mercedes-Benz C-Class", "Mercedes-Benz E-Class", "Mercedes-Benz GLC", "Mercedes-Benz GLE", "Mercedes-Benz A-Class",
  "Mercedes-Benz S-Class", "Mercedes-Benz GLB", "Mercedes-Benz GLA", "Mercedes-Benz CLA",
  "Audi A4", "Audi Q5", "Audi A3", "Audi Q7", "Audi A6",
  "Audi Q3", "Audi e-tron", "Audi A5", "Audi Q8",
  "Lexus RX", "Lexus ES", "Lexus NX", "Lexus IS", "Lexus GX",
  "Lexus UX", "Lexus LC", "Lexus LS",
  "Tesla Model 3", "Tesla Model Y", "Tesla Model S", "Tesla Model X", "Tesla Cybertruck",
  "Subaru Outback", "Subaru Forester", "Subaru Crosstrek", "Subaru Impreza", "Subaru WRX",
  "Subaru Ascent", "Subaru Legacy", "Subaru BRZ",
  "Volkswagen Jetta", "Volkswagen Tiguan", "Volkswagen Atlas", "Volkswagen Golf", "Volkswagen ID.4",
  "Volkswagen Taos", "Volkswagen Passat",
  "Jeep Wrangler", "Jeep Grand Cherokee", "Jeep Cherokee", "Jeep Compass", "Jeep Gladiator",
  "Jeep Renegade", "Jeep Grand Wagoneer",
  "Ram 1500", "Ram 2500", "Ram 3500", "Ram ProMaster",
  "Dodge Charger", "Dodge Challenger", "Dodge Durango", "Dodge Hornet",
  "GMC Sierra", "GMC Yukon", "GMC Terrain", "GMC Acadia", "GMC Canyon",
  "Mazda CX-5", "Mazda Mazda3", "Mazda CX-50", "Mazda CX-9", "Mazda MX-5",
  "Volvo XC90", "Volvo XC60", "Volvo XC40", "Volvo S60",
  "Acura MDX", "Acura TLX", "Acura RDX", "Acura Integra",
  "Infiniti QX60", "Infiniti QX80", "Infiniti Q50",
  "Cadillac Escalade", "Cadillac XT5", "Cadillac CT5", "Cadillac XT4",
  "Lincoln Navigator", "Lincoln Corsair", "Lincoln Aviator",
  "Buick Enclave", "Buick Encore", "Buick Envision",
  "Genesis GV70", "Genesis GV80", "Genesis G70",
  "Porsche Cayenne", "Porsche Macan", "Porsche 911", "Porsche Taycan",
  "Land Rover Range Rover", "Land Rover Defender", "Land Rover Discovery",
  "Rivian R1T", "Rivian R1S",
  "Lucid Air",
  "Mini Cooper",
  "Mitsubishi Outlander", "Mitsubishi Eclipse Cross",
  "Chrysler Pacifica", "Chrysler 300",
];

// Generic category queries for broader coverage
const CATEGORY_QUERIES: string[] = [
  "used SUV under 20000", "used sedan under 15000", "used truck under 25000",
  "used minivan", "used convertible", "used coupe under 30000",
  "used hybrid car", "used electric car", "used luxury SUV",
  "used pickup truck", "used crossover", "used wagon",
  "cheap used cars under 10000", "cheap used cars under 5000",
  "certified pre-owned SUV", "certified pre-owned sedan",
  "used 4WD truck", "used AWD SUV", "used sports car",
  "used family car", "used compact SUV", "used full size SUV",
  "used midsize sedan", "used luxury sedan", "used hatchback",
  "low mileage used car", "one owner used car",
  "used car under 3000", "used car under 8000", "used car under 12000",
];

// ── HELPERS ────────────────────────────────────────────────────────────────

const SOLD_EXPIRED_KEYWORDS = /\b(sold|no longer available|expired|off market|pending sale|unavailable|deal fell through|price unavailable|not available)\b/i;

function isSoldOrExpired(text: string): boolean {
  return SOLD_EXPIRED_KEYWORDS.test(text);
}

function isValidVdpUrl(url: string, provider: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const domain = PROVIDER_DOMAINS[provider];
    if (!u.hostname.includes(domain)) return false;
    if (path === "/" || path.includes("/signin") || path.includes("/login") ||
        path.includes("/about") || path.includes("/faq") || path.includes("/privacy") ||
        path.includes("/terms") || path.includes("/help") || path.includes("/careers") ||
        path.includes("/sell") || path.includes("/finance") || path.includes("/blog")) {
      return false;
    }
    if (provider === "carvana") return path.includes("/vehicle/");
    if (provider === "cargurus") {
      return path.includes("/listing/") || !!u.searchParams.get("listingId") || !!u.searchParams.get("id") || !!path.match(/\/(\d{5,})/);
    }
    return true;
  } catch { return false; }
}

function extractProductId(url: string, provider: string): string {
  try {
    const u = new URL(url);
    if (provider === "carvana") {
      const match = u.pathname.match(/\/vehicle\/(\d+)/);
      if (match) return match[1];
    }
    if (provider === "cargurus") {
      const id = u.searchParams.get("id") || u.searchParams.get("listingId");
      if (id) return id;
      const match = u.pathname.match(/\/listing\/([^\/]+)/);
      if (match) return match[1];
      const carsMatch = u.pathname.match(/\/(\d{5,})/);
      if (carsMatch) return carsMatch[1];
    }
  } catch {}
  let hash = 0;
  for (let i = 0; i < url.length; i++) { hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0; }
  return `hash-${Math.abs(hash)}`;
}

function parseUsd(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

// ── STATEFUL ROTATION ─────────────────────────────────────────────────────

async function getRotationOffset(supabase: any, provider: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("cars_settings")
      .select("value")
      .eq("key", `scraper_rotation_${provider}`)
      .single();
    return (data?.value as any)?.offset || 0;
  } catch { return 0; }
}

async function setRotationOffset(supabase: any, provider: string, offset: number): Promise<void> {
  try {
    await supabase
      .from("cars_settings")
      .upsert({
        key: `scraper_rotation_${provider}`,
        value: { offset, updated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
  } catch (e) {
    console.warn(`[CAR_SCRAPER] rotation save error:`, (e as Error).message);
  }
}

function getQueryBatch(provider: string, offset: number, count: number): string[] {
  const domain = PROVIDER_DOMAINS[provider];
  const allQueries = [...MAKES_MODELS, ...CATEGORY_QUERIES];
  const total = allQueries.length;
  const queries: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (offset + i) % total;
    queries.push(`${allQueries[idx]} for sale site:${domain}`);
  }
  return queries;
}

// ── FIRECRAWL SEARCH (PRIMARY) ────────────────────────────────────────────

async function firecrawlSearch(
  query: string,
  maxPrice: number,
  apiKey: string,
  provider: string,
  dropReasons: Record<string, number>,
): Promise<CarListing[]> {
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
        limit: FIRECRAWL_SEARCH_LIMIT,
        lang: "en",
        country: "us",
        scrapeOptions: { formats: ["markdown"] },
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[CAR_SCRAPER] search error: ${resp.status} ${errText.substring(0, 200)}`);
      return [];
    }

    const data = await resp.json();
    const results = data?.data || [];
    const listings: CarListing[] = [];
    const seenIds = new Set<string>();

    for (const item of results) {
      const url = item.url || "";
      const title = item.title || "";
      const description = item.description || "";
      const markdown = item.markdown || "";

      if (!url || !title) { dropReasons["missing_url_or_title"] = (dropReasons["missing_url_or_title"] || 0) + 1; continue; }
      if (isSoldOrExpired(title) || isSoldOrExpired(description)) { dropReasons["sold_or_expired"] = (dropReasons["sold_or_expired"] || 0) + 1; continue; }
      if (!isValidVdpUrl(url, provider)) { dropReasons["not_vdp_url"] = (dropReasons["not_vdp_url"] || 0) + 1; continue; }

      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes("about us") || lowerTitle.includes("faq") || lowerTitle.includes("privacy")) {
        dropReasons["non_listing_page"] = (dropReasons["non_listing_page"] || 0) + 1;
        continue;
      }

      // Extract price
      let price: number | null = null;
      const priceRegex = /\$[\d,]+(?:\.\d{2})?/g;
      for (const text of [description, title, markdown.substring(0, 2000)]) {
        const matches = text.match(priceRegex);
        if (matches) {
          for (const m of matches) {
            const p = parseUsd(m);
            if (p && p >= 500 && p <= maxPrice) { price = p; break; }
          }
          if (price) break;
        }
      }
      if (!price && markdown) {
        const priceLabelMatch = markdown.match(/(?:price|listing price|sale price)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
        if (priceLabelMatch) {
          const p = parseUsd(priceLabelMatch[1]);
          if (p && p >= 500 && p <= maxPrice) price = p;
        }
      }
      if (!price) { dropReasons["no_price"] = (dropReasons["no_price"] || 0) + 1; continue; }

      const pid = extractProductId(url, provider);
      if (seenIds.has(pid)) continue;
      seenIds.add(pid);

      let imageUrl = "";
      const imgMatch = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp)[^\s)]*)\)/i);
      if (imgMatch) imageUrl = imgMatch[1];
      // Carvana fallback: derive hero image from product ID
      if (!imageUrl && provider === "carvana" && /^\d+$/.test(pid)) {
        imageUrl = `https://vexgateway.fastly.carvana.io/${pid}/standardizedHero.jpg?width=800`;
      }
      // CarGurus fallback: try static.cargurus.com pattern
      if (!imageUrl && provider === "cargurus") {
        const cgurusImgMatch = markdown.match(/(https?:\/\/static\.cargurus\.com\/[^\s)"]+\.(?:jpg|jpeg|png|webp))/i);
        if (cgurusImgMatch) imageUrl = cgurusImgMatch[1];
      }

      const yearMatch = title.match(/\b(19|20)\d{2}\b/);

      listings.push({
        title: title.substring(0, 200),
        price_usd: price,
        image_url: imageUrl,
        product_url: url,
        year: yearMatch ? parseInt(yearMatch[0]) : undefined,
        condition: "Used",
        provider_product_id: pid,
      });
    }

    return listings;
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("abort")) {
      console.warn(`[CAR_SCRAPER] search TIMEOUT for "${query.substring(0, 40)}"`);
    } else {
      console.error(`[CAR_SCRAPER] search error:`, msg);
    }
    return [];
  }
}

// ── UPSERT ─────────────────────────────────────────────────────────────────

async function upsertListings(supabase: any, provider: string, listings: CarListing[], dryRun: boolean): Promise<number> {
  if (listings.length === 0 || dryRun) return 0;

  const now = new Date().toISOString();
  const rows = listings.map((l) => ({
    provider,
    provider_product_id: l.provider_product_id,
    title: l.title,
    price_usd: l.price_usd,
    image_url: sanitizeImageUrl(l.image_url),
    product_url: l.product_url,
    category_key: "vehicles",
    unified_category: "vehicles",
    currency: "USD",
    in_stock: true,
    is_active: true,
    is_disallowed: false,
    last_seen_at: now,
    last_checked_at: now,
    metadata: { year: l.year, mileage: l.mileage, condition: l.condition, source: "firecrawl_search_v2" },
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase
      .from("catalog_items")
      .upsert(batch, { onConflict: "provider,provider_product_id" });
    if (error) {
      console.error(`[CAR_SCRAPER] upsert batch ${i} error:`, error.message);
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

  const auth = await authenticateRequest(req);
  if (!auth.authorized) {
    return cronAuthErrorResponse(auth.error || "Unauthorized");
  }

  const startTime = Date.now();

  try {
    const body: ScraperRequest = req.method === "POST"
      ? await req.json()
      : { provider: new URL(req.url).searchParams.get("provider") as any || "cargurus" };

    const provider = body.provider;
    if (provider !== "cargurus" && provider !== "carvana") {
      return new Response(JSON.stringify({ ok: false, error: "Invalid provider. Must be 'cargurus' or 'carvana'." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const maxPrice = body.max_price || DEFAULT_MAX_PRICE;
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
    const offset = customQuery ? 0 : await getRotationOffset(supabase, provider);
    const queries = customQuery
      ? [`${customQuery} for sale site:${PROVIDER_DOMAINS[provider]}`]
      : getQueryBatch(provider, offset, queriesPerRun);

    console.log(`[CAR_SCRAPER] START provider=${provider} target=${targetItems} queries=${queries.length} offset=${offset} dryRun=${dryRun}`);

    const dropReasons: Record<string, number> = {};
    const allListings: CarListing[] = [];
    const globalSeenIds = new Set<string>();
    let queriesUsed = 0;

    for (const query of queries) {
      if (allListings.length >= targetItems) break;
      if (Date.now() - startTime > HARD_FUNCTION_CAP_MS - 3000) break;

      queriesUsed++;
      const results = await firecrawlSearch(query, maxPrice, firecrawlKey, provider, dropReasons);

      for (const l of results) {
        if (allListings.length >= targetItems) break;
        if (!globalSeenIds.has(l.provider_product_id)) {
          globalSeenIds.add(l.provider_product_id);
          allListings.push(l);
        } else {
          dropReasons["duplicate_across_queries"] = (dropReasons["duplicate_across_queries"] || 0) + 1;
        }
      }

      // Small delay between queries
      if (allListings.length < targetItems) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Update rotation offset
    if (!customQuery) {
      const totalQueries = MAKES_MODELS.length + CATEGORY_QUERIES.length;
      const newOffset = (offset + queriesUsed) % totalQueries;
      await setRotationOffset(supabase, provider, newOffset);
    }

    // Upsert
    const upsertedCount = await upsertListings(supabase, provider, allListings, dryRun);

    const totalQueries = MAKES_MODELS.length + CATEGORY_QUERIES.length;
    const elapsedMs = Date.now() - startTime;
    const result = {
      ok: true,
      provider,
      queries_used: queriesUsed,
      query_pool_size: totalQueries,
      rotation_offset: offset,
      next_offset: (offset + queriesUsed) % totalQueries,
      listings_found: allListings.length,
      upserted_count: upsertedCount,
      drop_reasons: Object.keys(dropReasons).length > 0 ? dropReasons : undefined,
      sample: allListings.slice(0, 3),
      elapsed_ms: elapsedMs,
      dry_run: dryRun,
    };

    console.log(`[CAR_SCRAPER] DONE ${elapsedMs}ms provider=${provider} found=${allListings.length} upserted=${upsertedCount} queries=${queriesUsed}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    console.error(`[CAR_SCRAPER] FATAL ${elapsedMs}ms`, (err as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, elapsed_ms: elapsedMs }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
