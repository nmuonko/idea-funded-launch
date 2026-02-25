/**
 * Catalog Car Scraper — Firecrawl-Primary with Free Fallback
 * 
 * Scrapes CarGurus and Carvana for cheap vehicles and upserts into catalog_items.
 * Primary path uses Firecrawl (reliable JS rendering + structured JSON extraction).
 * Free HTML parsing is used as fallback when Firecrawl key is missing or fails.
 * 
 * Auth: x-cron-secret header OR admin JWT
 */

import { createClient } from "@supabase/supabase-js";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ── TYPES ──────────────────────────────────────────────────────────────────

interface ScraperRequest {
  provider: "cargurus" | "carvana";
  max_price?: number;
  max_pages?: number;
  mode?: "firecrawl-first" | "force-free" | "force-firecrawl";
  dry_run?: boolean;
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

interface ScrapeResult {
  provider: string;
  mode_used: "firecrawl" | "free" | "free-only";
  pages_fetched: number;
  listings_found: number;
  upserted_count: number;
  blocked_count: number;
  parse_methods_used: Record<string, number>;
  sample: CarListing[];
}

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const MAX_PAGES_CAP = 5;
const DEFAULT_MAX_PRICE = 15000;
const DEFAULT_MAX_PAGES = 2;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

// ── URL BUILDERS ───────────────────────────────────────────────────────────

function buildSearchUrl(provider: string, maxPrice: number, page: number): string {
  if (provider === "carvana") {
    return `https://www.carvana.com/cars?priceMax=${maxPrice}&sortBy=PRICE_LOW&page=${page}`;
  }
  // CarGurus
  return `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?sortDir=ASC&sortType=PRICE&maxPrice=${maxPrice}&offset=${(page - 1) * 15}`;
}

// ── JITTER DELAY ───────────────────────────────────────────────────────────

function jitterDelay(): Promise<void> {
  const ms = 800 + Math.floor(Math.random() * 400); // 800–1200ms
  return new Promise((r) => setTimeout(r, ms));
}

// ── EXTRACT PRODUCT ID FROM URL ────────────────────────────────────────────

function extractProductId(url: string, provider: string): string {
  try {
    const u = new URL(url);
    if (provider === "carvana") {
      // e.g. /vehicle/12345
      const match = u.pathname.match(/\/vehicle\/(\d+)/);
      if (match) return match[1];
    }
    if (provider === "cargurus") {
      // e.g. inventoryListing?id=12345 or /listing/12345
      const id = u.searchParams.get("id") || u.searchParams.get("listingId");
      if (id) return id;
      const match = u.pathname.match(/\/listing\/([^\/]+)/);
      if (match) return match[1];
    }
  } catch { /* fallthrough */ }
  // Fallback: hash the URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `hash-${Math.abs(hash)}`;
}

// ── FREE PARSING: JSON-LD ──────────────────────────────────────────────────

function parseJsonLd(html: string, provider: string, maxPrice: number): { listings: CarListing[]; method: string } {
  const listings: CarListing[] = [];
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = data["@type"] === "ItemList" ? (data.itemListElement || []) : 
                    Array.isArray(data) ? data : [data];
      
      for (const item of items) {
        const product = item.item || item;
        if (!product || (product["@type"] !== "Product" && product["@type"] !== "Car" && product["@type"] !== "Vehicle")) continue;
        
        const price = product.offers?.price || product.offers?.lowPrice || product.price;
        const priceNum = typeof price === "number" ? price : parseFloat(String(price));
        if (!priceNum || priceNum <= 0 || priceNum > maxPrice) continue;
        
        const productUrl = product.url || product.offers?.url || "";
        const title = product.name || product.description || "";
        if (!title || !productUrl) continue;
        
        listings.push({
          title,
          price_usd: Math.round(priceNum * 100) / 100,
          image_url: product.image?.url || product.image || (Array.isArray(product.image) ? product.image[0] : "") || "",
          product_url: productUrl.startsWith("http") ? productUrl : `https://www.${provider}.com${productUrl}`,
          year: product.vehicleModelDate || product.modelDate,
          mileage: product.mileageFromOdometer?.value || product.mileage,
          condition: product.itemCondition || product.offers?.itemCondition,
          provider_product_id: extractProductId(productUrl, provider),
        });
      }
    } catch { /* skip malformed JSON-LD */ }
  }
  return { listings, method: "jsonld" };
}

// ── FREE PARSING: __NEXT_DATA__ (Carvana) ──────────────────────────────────

function parseNextData(html: string, provider: string, maxPrice: number): { listings: CarListing[]; method: string } {
  const listings: CarListing[] = [];
  const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return { listings, method: "nextdata" };
  
  try {
    const nextData = JSON.parse(match[1]);
    // Navigate through typical Next.js data structures
    const props = nextData?.props?.pageProps;
    if (!props) return { listings, method: "nextdata" };
    
    // Carvana stores vehicle results in various keys
    const vehicles = props.vehicles || props.listings || props.inventory || props.results || [];
    const vehicleList = Array.isArray(vehicles) ? vehicles : [];
    
    for (const v of vehicleList) {
      const price = v.price || v.listPrice || v.salePrice;
      const priceNum = typeof price === "number" ? price : parseFloat(String(price));
      if (!priceNum || priceNum <= 0 || priceNum > maxPrice) continue;
      
      const vId = v.id || v.vehicleId || v.stockNumber || v.vin || "";
      const title = v.title || v.name || `${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim();
      const productUrl = v.url || v.detailUrl || (vId ? `https://www.carvana.com/vehicle/${vId}` : "");
      if (!title || !productUrl) continue;
      
      listings.push({
        title,
        price_usd: Math.round(priceNum * 100) / 100,
        image_url: v.imageUrl || v.heroImageUrl || v.mainImage || (v.images?.[0]?.url) || "",
        product_url: productUrl,
        year: v.year,
        mileage: v.mileage ? String(v.mileage) : undefined,
        condition: v.condition || "Used",
        provider_product_id: extractProductId(productUrl, provider) || String(vId),
      });
    }
  } catch { /* skip */ }
  return { listings, method: "nextdata" };
}

// ── FREE PARSING: Embedded State JSON ──────────────────────────────────────

function parseEmbeddedState(html: string, provider: string, maxPrice: number): { listings: CarListing[]; method: string } {
  const listings: CarListing[] = [];
  // Try window.__INITIAL_STATE__, __APOLLO_STATE__, etc.
  const statePatterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*(?:<\/script>|window\.)/,
    /window\.__APOLLO_STATE__\s*=\s*({[\s\S]*?});?\s*(?:<\/script>|window\.)/,
    /window\.__DATA__\s*=\s*({[\s\S]*?});?\s*(?:<\/script>|window\.)/,
  ];
  
  for (const pattern of statePatterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      const state = JSON.parse(match[1]);
      // Walk all top-level keys looking for arrays of vehicle-like objects
      for (const key of Object.keys(state)) {
        const val = state[key];
        if (!Array.isArray(val)) continue;
        for (const item of val) {
          if (!item || typeof item !== "object") continue;
          const price = item.price || item.listPrice || item.salePrice;
          const priceNum = typeof price === "number" ? price : parseFloat(String(price));
          if (!priceNum || priceNum <= 0 || priceNum > maxPrice) continue;
          
          const title = item.title || item.name || item.heading || "";
          const productUrl = item.url || item.listingUrl || item.detailUrl || "";
          if (!title) continue;
          
          const fullUrl = productUrl.startsWith("http") ? productUrl : (productUrl ? `https://www.${provider}.com${productUrl}` : "");
          
          listings.push({
            title,
            price_usd: Math.round(priceNum * 100) / 100,
            image_url: item.imageUrl || item.image || item.thumbnailUrl || "",
            product_url: fullUrl,
            year: item.year,
            mileage: item.mileage ? String(item.mileage) : undefined,
            condition: item.condition || "Used",
            provider_product_id: fullUrl ? extractProductId(fullUrl, provider) : `state-${key}-${priceNum}`,
          });
        }
      }
    } catch { /* skip */ }
  }
  return { listings, method: "state" };
}

// ── FREE PARSING: Minimal Regex Fallback ───────────────────────────────────

function parseRegexFallback(html: string, provider: string, maxPrice: number): { listings: CarListing[]; method: string } {
  const listings: CarListing[] = [];
  // Very simple: look for price + title patterns in listing cards
  // This is a last resort and will be noisy
  const pricePattern = /\$[\d,]+/g;
  const prices = html.match(pricePattern) || [];
  // Not useful alone — just count how many price-like strings exist
  // We won't create listings from pure regex as it's too unreliable
  return { listings, method: "regex" };
}

// ── FREE SCRAPE PIPELINE ───────────────────────────────────────────────────

async function freeScrape(
  provider: string,
  maxPrice: number,
  maxPages: number,
): Promise<{
  listings: CarListing[];
  blockedCount: number;
  parseMethods: Record<string, number>;
  pagesFetched: number;
}> {
  const allListings: CarListing[] = [];
  const seenIds = new Set<string>();
  let blockedCount = 0;
  const parseMethods: Record<string, number> = { jsonld: 0, nextdata: 0, state: 0, regex: 0 };
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = buildSearchUrl(provider, maxPrice, page);
    console.log(`[CAR_SCRAPER] ${provider} page=${page} url=${url}`);

    try {
      const resp = await fetch(url, { headers: BROWSER_HEADERS });
      pagesFetched++;

      if (resp.status === 403 || resp.status === 429) {
        console.warn(`[CAR_SCRAPER] ${provider} page=${page} BLOCKED status=${resp.status}`);
        blockedCount++;
        await resp.text(); // consume body
        continue;
      }
      if (!resp.ok) {
        console.warn(`[CAR_SCRAPER] ${provider} page=${page} status=${resp.status}`);
        await resp.text();
        continue;
      }

      const html = await resp.text();
      console.log(`[CAR_SCRAPER] ${provider} page=${page} html_length=${html.length}`);

      // Try parsers in order of reliability
      const parsers = [
        () => parseJsonLd(html, provider, maxPrice),
        () => parseNextData(html, provider, maxPrice),
        () => parseEmbeddedState(html, provider, maxPrice),
        () => parseRegexFallback(html, provider, maxPrice),
      ];

      for (const parser of parsers) {
        const result = parser();
        parseMethods[result.method] += result.listings.length;
        
        for (const listing of result.listings) {
          if (!seenIds.has(listing.provider_product_id)) {
            seenIds.add(listing.provider_product_id);
            allListings.push(listing);
          }
        }
      }

      console.log(`[CAR_SCRAPER] ${provider} page=${page} listings_found=${allListings.length}`);
    } catch (err) {
      console.error(`[CAR_SCRAPER] ${provider} page=${page} error:`, (err as Error).message);
      blockedCount++;
    }

    // Jitter between pages
    if (page < maxPages) await jitterDelay();
  }

  return { listings: allListings, blockedCount, parseMethods, pagesFetched };
}

// ── FIRECRAWL PRIMARY ──────────────────────────────────────────────────────

async function firecrawlScrape(
  provider: string,
  maxPrice: number,
  maxPages: number,
  apiKey: string,
): Promise<{
  listings: CarListing[];
  pagesFetched: number;
}> {
  const allListings: CarListing[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = buildSearchUrl(provider, maxPrice, page);
    console.log(`[CAR_SCRAPER] firecrawl ${provider} page=${page} url=${url}`);

    try {
      const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["extract"],
          extract: {
            schema: {
              type: "object",
              properties: {
                listings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      price: { type: "number" },
                      year: { type: "number" },
                      mileage: { type: "string" },
                      condition: { type: "string" },
                      imageUrl: { type: "string" },
                      listingUrl: { type: "string" },
                    },
                  },
                },
              },
            },
            prompt: "Extract every vehicle listing shown on the page. Return listings with: title (year make model trim), price (number USD), year (number if visible), mileage (string if visible), condition (string if visible), imageUrl (string), listingUrl (string full URL). Do not invent values. If missing, omit that field.",
          },
          onlyMainContent: true,
          waitFor: 15000,
        }),
      });

      pagesFetched++;
      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[CAR_SCRAPER] firecrawl error: ${resp.status} ${errText.substring(0, 200)}`);
        continue;
      }

      const data = await resp.json();
      const extractData = data?.data?.extract || data?.extract || data?.data?.json || data?.json || {};
      const fcListings = extractData?.listings || [];

      for (const item of fcListings) {
        // Strict validation: must have title, listingUrl, and numeric price within range
        if (!item.title || !item.listingUrl || !item.price) continue;
        const priceNum = typeof item.price === "number" ? item.price : parseFloat(String(item.price));
        if (!priceNum || priceNum <= 0 || priceNum > maxPrice) continue;

        // Ensure listingUrl is absolute
        let productUrl = item.listingUrl;
        if (productUrl && !productUrl.startsWith("http")) {
          const domain = provider === "carvana" ? "https://www.carvana.com" : "https://www.cargurus.com";
          productUrl = `${domain}${productUrl.startsWith("/") ? "" : "/"}${productUrl}`;
        }

        const pid = extractProductId(productUrl, provider);

        if (!seenIds.has(pid)) {
          seenIds.add(pid);
          allListings.push({
            title: item.title,
            price_usd: Math.round(priceNum * 100) / 100,
            image_url: item.imageUrl || "",
            product_url: productUrl,
            year: item.year,
            mileage: item.mileage,
            condition: item.condition,
            provider_product_id: pid,
          });
        }
      }

      console.log(`[CAR_SCRAPER] firecrawl ${provider} page=${page} found=${fcListings.length} total=${allListings.length}`);
    } catch (err) {
      console.error(`[CAR_SCRAPER] firecrawl ${provider} page=${page} error:`, (err as Error).message);
    }

    if (page < maxPages) await jitterDelay();
  }

  return { listings: allListings, pagesFetched };
}

// ── UPSERT TO CATALOG_ITEMS ────────────────────────────────────────────────

async function upsertListings(
  supabase: any,
  provider: string,
  listings: CarListing[],
  source: string,
  dryRun: boolean,
): Promise<number> {
  if (listings.length === 0 || dryRun) return 0;

  const rows = listings.map((l) => ({
    provider,
    provider_product_id: l.provider_product_id,
    title: l.title,
    price_usd: l.price_usd,
    image_url: l.image_url,
    product_url: l.product_url,
    category_key: "vehicles",
    unified_category: "vehicles",
    currency: "USD",
    in_stock: true,
    is_active: true,
    is_disallowed: false,
    last_seen_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    metadata: { year: l.year, mileage: l.mileage, condition: l.condition, source },
  }));

  // Upsert in batches of 50
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

// ── AUTH: CRON OR ADMIN JWT ────────────────────────────────────────────────

async function authenticateRequest(req: Request): Promise<{ authorized: boolean; error?: string }> {
  // Check cron secret first
  const cronResult = verifyCronAuth(req);
  if (cronResult.authorized) return { authorized: true };

  // Check admin JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { authorized: false, error: "Missing authentication" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { authorized: false, error: "Server misconfigured" };
  }

  try {
    const token = authHeader.substring(7);
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { authorized: false, error: "Invalid token" };
    const user = await resp.json();

    // Check admin_users table
    const adminResp = await fetch(
      `${supabaseUrl}/rest/v1/admin_users?select=id&email=eq.${encodeURIComponent(user.email)}&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!adminResp.ok) return { authorized: false, error: "Admin check failed" };
    const admins = await adminResp.json();
    if (!Array.isArray(admins) || admins.length === 0) {
      return { authorized: false, error: "Not an admin" };
    }

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
    const maxPages = Math.min(body.max_pages || DEFAULT_MAX_PAGES, MAX_PAGES_CAP);
    const mode = body.mode || "firecrawl-first";
    const dryRun = body.dry_run || false;

    console.log(`[CAR_SCRAPER] START provider=${provider} maxPrice=${maxPrice} maxPages=${maxPages} mode=${mode} dryRun=${dryRun}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";

    const parseMethods: Record<string, number> = { jsonld: 0, nextdata: 0, state: 0, regex: 0, firecrawl: 0 };
    let allListings: CarListing[] = [];
    let modeUsed: "firecrawl" | "free" | "free-only" = "firecrawl";
    let totalPagesFetched = 0;
    let totalBlocked = 0;

    // ── FORCE-FREE ─────────────────────────────────────────────────────
    if (mode === "force-free") {
      const freeResult = await freeScrape(provider, maxPrice, maxPages);
      allListings = freeResult.listings;
      totalPagesFetched = freeResult.pagesFetched;
      totalBlocked = freeResult.blockedCount;
      Object.assign(parseMethods, freeResult.parseMethods);
      modeUsed = "free-only";
    }

    // ── FORCE-FIRECRAWL ────────────────────────────────────────────────
    else if (mode === "force-firecrawl") {
      if (!firecrawlKey) {
        return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const fcResult = await firecrawlScrape(provider, maxPrice, maxPages, firecrawlKey);
      allListings = fcResult.listings;
      totalPagesFetched = fcResult.pagesFetched;
      parseMethods.firecrawl = fcResult.listings.length;
      modeUsed = "firecrawl";
      if (allListings.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: "Firecrawl returned no listings" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── FIRECRAWL-FIRST (default): try Firecrawl, fall back to free ──
    else {
      if (firecrawlKey) {
        try {
          const fcResult = await firecrawlScrape(provider, maxPrice, maxPages, firecrawlKey);
          allListings = fcResult.listings;
          totalPagesFetched = fcResult.pagesFetched;
          parseMethods.firecrawl = fcResult.listings.length;
          modeUsed = "firecrawl";
        } catch (fcErr) {
          console.error(`[CAR_SCRAPER] Firecrawl threw error, will fall back to free:`, (fcErr as Error).message);
          // parseMethods.firecrawl stays 0
        }
      }

      // Fallback to free if Firecrawl had no key, threw, or returned 0 listings
      if (allListings.length === 0) {
        if (!firecrawlKey) {
          console.log(`[CAR_SCRAPER] No FIRECRAWL_API_KEY, using free-only`);
        } else {
          console.log(`[CAR_SCRAPER] Firecrawl yielded 0 listings, falling back to free parse`);
        }
        const freeResult = await freeScrape(provider, maxPrice, maxPages);
        allListings = freeResult.listings;
        totalPagesFetched += freeResult.pagesFetched;
        totalBlocked = freeResult.blockedCount;
        Object.assign(parseMethods, freeResult.parseMethods);
        modeUsed = firecrawlKey ? "free" : "free-only";
      }
    }

    // ── UPSERT ─────────────────────────────────────────────────────────
    const upsertedCount = await upsertListings(supabase, provider, allListings, modeUsed, dryRun);

    const result: ScrapeResult = {
      provider,
      mode_used: modeUsed,
      pages_fetched: totalPagesFetched,
      listings_found: allListings.length,
      upserted_count: upsertedCount,
      blocked_count: totalBlocked,
      parse_methods_used: parseMethods,
      sample: allListings.slice(0, 3),
    };

    console.log(`[CAR_SCRAPER] DONE`, JSON.stringify({ ...result, sample: undefined }));

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[CAR_SCRAPER] Fatal error:", (err as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
