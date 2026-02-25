/**
 * Catalog Car Scraper — Three-Stage Pipeline
 * 
 * Stage 0 (primary): Firecrawl Search API (`/v1/search`) — fast, bypasses anti-bot
 * Stage A (fallback): Firecrawl markdown+links with relaxed URL matching
 * Stage B (last resort): Firecrawl extract (structured JSON), 12s timeout
 * 
 * Free direct-fetch fallback removed for car providers (consistently blocked).
 * 
 * Auth: x-cron-secret header OR admin JWT
 */

import { createClient } from "@supabase/supabase-js";
import { cronAuthErrorResponse } from "../_shared/cronAuth.ts";

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
  mode_used: string;
  pages_fetched: number;
  listings_found: number;
  upserted_count: number;
  blocked_count: number;
  parse_methods_used: Record<string, number>;
  sample: CarListing[];
  elapsed_ms?: number;
  drop_reasons?: Record<string, number>;
  firecrawl_status?: string;
  fallback_used?: boolean;
  blocked_statuses?: number[];
  diagnostics?: string;
}

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const MAX_PAGES_CAP = 5;
const DEFAULT_MAX_PRICE = 50000;
const DEFAULT_MAX_PAGES = 2;
const SEARCH_TIMEOUT_MS = 15000;    // 15s for search API
const STAGE_A_TIMEOUT_MS = 15000;   // 15s for fast markdown scrape
const STAGE_B_TIMEOUT_MS = 12000;   // 12s for heavy extract (reduced from 18s)
const HARD_FUNCTION_CAP_MS = 50000; // 50s total function budget
const BLOCKED_STATUSES = new Set([403, 418, 429, 503]);

const PROVIDER_DOMAINS: Record<string, string> = {
  cargurus: "cargurus.com",
  carvana: "carvana.com",
};

// ── URL BUILDERS ───────────────────────────────────────────────────────────

function buildSearchUrl(provider: string, maxPrice: number, page: number, searchQuery?: string): string {
  if (provider === "carvana") {
    const base = `https://www.carvana.com/cars?priceMax=${maxPrice}&sortBy=PRICE_LOW&page=${page}`;
    return searchQuery ? `${base}&search=${encodeURIComponent(searchQuery)}` : base;
  }
  if (searchQuery) {
    return `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?sortDir=ASC&sortType=PRICE&maxPrice=${maxPrice}&searchQuery=${encodeURIComponent(searchQuery)}&offset=${(page - 1) * 15}`;
  }
  return `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?sortDir=ASC&sortType=PRICE&maxPrice=${maxPrice}&offset=${(page - 1) * 15}`;
}

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

    // Exclude obvious non-VDP pages
    if (path === "/" || path.includes("/signin") || path.includes("/login") ||
        path.includes("/about") || path.includes("/faq") || path.includes("/privacy") ||
        path.includes("/terms") || path.includes("/help") || path.includes("/careers") ||
        path.includes("/sell") || path.includes("/finance") || path.includes("/blog")) {
      return false;
    }

    // Exclude search/listing index pages
    if (path.includes("inventorylisting") || path.includes("/cars?") ||
        path.includes("/cars/") && !path.match(/\/\d{5,}/) && !path.includes("/listing/")) {
      // Allow /Cars/ paths only if they contain a numeric listing ID
      if (provider === "cargurus" && !u.searchParams.get("listingId") && !u.searchParams.get("id") && !path.match(/\/(\d{5,})/)) {
        return false;
      }
    }

    if (provider === "carvana") {
      return path.includes("/vehicle/");
    }
    if (provider === "cargurus") {
      return path.includes("/listing/") || !!u.searchParams.get("listingId") || !!u.searchParams.get("id") || !!path.match(/\/(\d{5,})/);
    }
    return true;
  } catch { return false; }
}

function jitterDelay(): Promise<void> {
  const ms = 800 + Math.floor(Math.random() * 400);
  return new Promise((r) => setTimeout(r, ms));
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
      // Also match /Cars/ paths with numeric segments
      const carsMatch = u.pathname.match(/\/(\d{5,})/);
      if (carsMatch) return carsMatch[1];
    }
  } catch { /* fallthrough */ }
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `hash-${Math.abs(hash)}`;
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

// ── STAGE 0: FIRECRAWL SEARCH API (PRIMARY) ───────────────────────────────
// Uses /v1/search to find listings via web search — bypasses anti-bot entirely

async function firecrawlSearch(
  provider: string,
  maxPrice: number,
  apiKey: string,
  searchQuery: string | undefined,
  targetItems: number,
  dropReasons: Record<string, number>,
): Promise<{
  listings: CarListing[];
  status: string;
}> {
  const domain = PROVIDER_DOMAINS[provider];
  const query = searchQuery
    ? `${searchQuery} for sale site:${domain}`
    : `used cars for sale site:${domain}`;

  console.log(`[CAR_SCRAPER] search: query="${query}" limit=${targetItems}`);

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
        limit: Math.min(targetItems * 2, 20), // request extra to account for filtering
        lang: "en",
        country: "us",
        scrapeOptions: {
          formats: ["markdown"],
        },
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[CAR_SCRAPER] search error: ${resp.status} ${errText.substring(0, 200)}`);
      return { listings: [], status: `search_error_${resp.status}` };
    }

    const data = await resp.json();
    const results = data?.data || [];
    console.log(`[CAR_SCRAPER] search returned ${results.length} results`);

    const listings: CarListing[] = [];
    const seenIds = new Set<string>();

    for (const item of results) {
      const url = item.url || "";
      const title = item.title || "";
      const description = item.description || "";
      const markdown = item.markdown || "";

      if (!url || !title) {
        dropReasons["search_missing_url_or_title"] = (dropReasons["search_missing_url_or_title"] || 0) + 1;
        continue;
      }

      // Filter sold/expired listings
      if (isSoldOrExpired(title) || isSoldOrExpired(description)) {
        dropReasons["sold_or_expired"] = (dropReasons["sold_or_expired"] || 0) + 1;
        continue;
      }

      // Validate URL is a real vehicle detail page
      if (!isValidVdpUrl(url, provider)) {
        dropReasons["not_vdp_url"] = (dropReasons["not_vdp_url"] || 0) + 1;
        continue;
      }

      // Skip non-listing pages (about, FAQ, etc.)
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes("about us") || lowerTitle.includes("faq") || lowerTitle.includes("privacy") || lowerTitle.includes("terms of")) {
        dropReasons["search_non_listing_page"] = (dropReasons["search_non_listing_page"] || 0) + 1;
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
            if (p && p >= 500 && p <= maxPrice) {
              price = p;
              break;
            }
          }
          if (price) break;
        }
      }

      // Also try to extract price from markdown with "Price:" or similar labels
      if (!price && markdown) {
        const priceLabelMatch = markdown.match(/(?:price|listing price|sale price)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
        if (priceLabelMatch) {
          const p = parseUsd(priceLabelMatch[1]);
          if (p && p >= 500 && p <= maxPrice) price = p;
        }
      }

      if (!price) {
        dropReasons["search_no_price"] = (dropReasons["search_no_price"] || 0) + 1;
        continue;
      }

      const pid = extractProductId(url, provider);
      if (seenIds.has(pid)) continue;
      seenIds.add(pid);

      // Try to extract image from markdown
      let imageUrl = "";
      const imgMatch = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (imgMatch) imageUrl = imgMatch[1];

      // Extract year from title
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

      if (listings.length >= targetItems) break;
    }

    console.log(`[CAR_SCRAPER] search parsed ${listings.length} valid listings from ${results.length} results`);
    return { listings, status: "ok" };
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("aborted") || msg.includes("abort") || msg.includes("signal")) {
      console.warn(`[CAR_SCRAPER] search TIMEOUT after ${SEARCH_TIMEOUT_MS}ms`);
      return { listings: [], status: "timeout" };
    }
    console.error(`[CAR_SCRAPER] search error:`, msg);
    return { listings: [], status: `error: ${msg.substring(0, 100)}` };
  }
}

// ── MARKDOWN LISTING PARSER (with relaxed URL matching) ────────────────────

function parseListingsFromMarkdown(
  markdown: string,
  links: string[],
  provider: string,
  maxPrice: number,
  dropReasons: Record<string, number>,
): CarListing[] {
  const listings: CarListing[] = [];
  const seenIds = new Set<string>();

  // Build listing URLs — RELAXED: accept any link from provider domain
  const domain = PROVIDER_DOMAINS[provider];
  const listingUrls: string[] = [];
  for (const link of links) {
    try {
      const u = new URL(link);
      if (u.hostname.includes(domain)) {
        // Skip obvious non-listing pages
        const path = u.pathname.toLowerCase();
        if (path === "/" || path.includes("/signin") || path.includes("/login") || 
            path.includes("/about") || path.includes("/faq") || path.includes("/privacy") ||
            path.includes("/terms") || path.includes("/help") || path.includes("/careers")) {
          continue;
        }
        listingUrls.push(link);
      }
    } catch { /* skip invalid URLs */ }
  }

  console.log(`[CAR_SCRAPER] markdown parser: ${links.length} total links, ${listingUrls.length} provider links after filter`);

  const priceRegex = /\$[\d,]+(?:\.\d{2})?/g;
  const yearMakeModelRegex = /\b(19|20)\d{2}\s+[A-Z][a-zA-Z]+\s+[A-Za-z0-9\s\-]+/;
  const lines = markdown.split("\n").map(l => l.trim()).filter(Boolean);
  
  let currentTitle = "";
  let currentPrice: number | null = null;
  let currentImageUrl = "";
  let urlIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const titleMatch = line.match(yearMakeModelRegex);
    if (titleMatch) {
      if (currentTitle && currentPrice !== null) {
        // Filter sold/expired
        if (isSoldOrExpired(currentTitle)) {
          dropReasons["sold_or_expired"] = (dropReasons["sold_or_expired"] || 0) + 1;
        } else {
          const url = urlIndex < listingUrls.length ? listingUrls[urlIndex++] : "";
          if (url && isValidVdpUrl(url, provider)) {
            const pid = extractProductId(url, provider);
            if (!seenIds.has(pid)) {
              seenIds.add(pid);
              listings.push({
                title: currentTitle,
                price_usd: currentPrice,
                image_url: currentImageUrl,
                product_url: url,
                provider_product_id: pid,
                condition: "Used",
              });
            }
          } else {
            // No valid VDP URL — drop instead of generating synthetic
            dropReasons["no_detail_url"] = (dropReasons["no_detail_url"] || 0) + 1;
            if (url) urlIndex++; // consume the bad URL
          }
        }
      }
      currentTitle = titleMatch[0].trim();
      currentPrice = null;
      currentImageUrl = "";
    }

    const priceMatches = line.match(priceRegex);
    if (priceMatches && currentTitle) {
      for (const pm of priceMatches) {
        const p = parseUsd(pm);
        if (p && p <= maxPrice && p >= 500) {
          currentPrice = p;
          break;
        } else if (p && p > maxPrice) {
          dropReasons["above_max_price"] = (dropReasons["above_max_price"] || 0) + 1;
        }
      }
    }

    const imgMatch = line.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (imgMatch && currentTitle) {
      currentImageUrl = imgMatch[1];
    }
  }

  // Last pending listing
  if (currentTitle && currentPrice !== null) {
    if (isSoldOrExpired(currentTitle)) {
      dropReasons["sold_or_expired"] = (dropReasons["sold_or_expired"] || 0) + 1;
    } else {
      const url = urlIndex < listingUrls.length ? listingUrls[urlIndex++] : "";
      if (url && isValidVdpUrl(url, provider)) {
        const pid = extractProductId(url, provider);
        if (!seenIds.has(pid)) {
          seenIds.add(pid);
          listings.push({
            title: currentTitle,
            price_usd: currentPrice,
            image_url: currentImageUrl,
            product_url: url,
            provider_product_id: pid,
            condition: "Used",
          });
        }
      } else {
        dropReasons["no_detail_url"] = (dropReasons["no_detail_url"] || 0) + 1;
      }
    }
  }

  return listings;
}

// ── STAGE A: FIRECRAWL MARKDOWN SCRAPE (FALLBACK) ─────────────────────────

async function firecrawlStageA(
  provider: string,
  maxPrice: number,
  maxPages: number,
  apiKey: string,
  searchQuery: string | undefined,
  targetItems: number,
  dropReasons: Record<string, number>,
  functionStartTime: number,
): Promise<{
  listings: CarListing[];
  pagesFetched: number;
  status: string;
}> {
  const allListings: CarListing[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;
  let status = "ok";

  for (let page = 1; page <= maxPages; page++) {
    if (Date.now() - functionStartTime > HARD_FUNCTION_CAP_MS) {
      status = "time_cap_reached";
      break;
    }

    const url = buildSearchUrl(provider, maxPrice, page, searchQuery);
    console.log(`[CAR_SCRAPER] stageA ${provider} page=${page} url=${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), STAGE_A_TIMEOUT_MS);

      const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["markdown", "links"],
          onlyMainContent: true,
          waitFor: 5000,
        }),
      });

      clearTimeout(timeoutId);
      pagesFetched++;

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[CAR_SCRAPER] stageA firecrawl error: ${resp.status} ${errText.substring(0, 200)}`);
        status = `firecrawl_error_${resp.status}`;
        continue;
      }

      const data = await resp.json();
      const markdown = data?.data?.markdown || data?.markdown || "";
      const links = data?.data?.links || data?.links || [];
      
      console.log(`[CAR_SCRAPER] stageA ${provider} page=${page} markdown_len=${markdown.length} links=${links.length}`);

      if (markdown.length < 100) {
        status = "markdown_empty";
        continue;
      }

      const mdListings = parseListingsFromMarkdown(markdown, links, provider, maxPrice, dropReasons);

      for (const listing of mdListings) {
        if (!seenIds.has(listing.provider_product_id)) {
          seenIds.add(listing.provider_product_id);
          allListings.push(listing);
        }
      }

      console.log(`[CAR_SCRAPER] stageA ${provider} page=${page} parsed=${mdListings.length} total=${allListings.length}`);

      if (allListings.length >= targetItems) break;
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("aborted") || msg.includes("abort") || msg.includes("signal")) {
        status = "timeout";
      } else {
        status = `error: ${msg.substring(0, 100)}`;
      }
    }

    if (page < maxPages && allListings.length < targetItems) await jitterDelay();
  }

  return { listings: allListings, pagesFetched, status };
}

// ── STAGE B: HEAVY FIRECRAWL (structured extract) ─────────────────────────

async function firecrawlStageB(
  provider: string,
  maxPrice: number,
  apiKey: string,
  searchQuery: string | undefined,
  targetItems: number,
  existingCount: number,
  dropReasons: Record<string, number>,
  functionStartTime: number,
): Promise<{
  listings: CarListing[];
  pagesFetched: number;
  status: string;
}> {
  if (Date.now() - functionStartTime > HARD_FUNCTION_CAP_MS - STAGE_B_TIMEOUT_MS) {
    return { listings: [], pagesFetched: 0, status: "skipped_time_budget" };
  }

  const url = buildSearchUrl(provider, maxPrice, 1, searchQuery);
  console.log(`[CAR_SCRAPER] stageB ${provider} url=${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STAGE_B_TIMEOUT_MS);

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
          prompt: "Extract every vehicle listing shown on the page. Return listings with: title (year make model trim), price (number USD), year (number if visible), mileage (string if visible), condition (string if visible), imageUrl (string), listingUrl (string full URL). Do not invent values.",
        },
        onlyMainContent: true,
        waitFor: 8000,
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[CAR_SCRAPER] stageB firecrawl error: ${resp.status} ${errText.substring(0, 200)}`);
      return { listings: [], pagesFetched: 1, status: `error_${resp.status}` };
    }

    const data = await resp.json();
    const extractData = data?.data?.extract || data?.extract || data?.data?.json || data?.json || {};
    const fcListings = extractData?.listings || [];
    const listings: CarListing[] = [];
    const domain = PROVIDER_DOMAINS[provider];

    for (const item of fcListings) {
      const rawTitle = item.title || item.name || "";
      const rawUrl = item.listingUrl || item.url || item.link || "";
      const rawPrice = item.price ?? item.priceUsd;

      const title = String(rawTitle).trim();
      const priceNum = parseUsd(rawPrice);
      if (!title) { dropReasons["invalid_title"] = (dropReasons["invalid_title"] || 0) + 1; continue; }
      if (isSoldOrExpired(title)) { dropReasons["sold_or_expired"] = (dropReasons["sold_or_expired"] || 0) + 1; continue; }
      if (!priceNum) { dropReasons["missing_price"] = (dropReasons["missing_price"] || 0) + 1; continue; }
      if (priceNum > maxPrice) { dropReasons["above_max_price"] = (dropReasons["above_max_price"] || 0) + 1; continue; }

      let productUrl = String(rawUrl).trim();
      if (productUrl && !productUrl.startsWith("http")) {
        productUrl = `https://www.${domain}${productUrl.startsWith("/") ? "" : "/"}${productUrl}`;
      }
      if (!productUrl || !isValidVdpUrl(productUrl, provider)) {
        dropReasons["no_detail_url"] = (dropReasons["no_detail_url"] || 0) + 1;
        continue;
      }

      listings.push({
        title,
        price_usd: priceNum,
        image_url: item.imageUrl || item.image || "",
        product_url: productUrl,
        year: item.year,
        mileage: item.mileage,
        condition: item.condition,
        provider_product_id: extractProductId(productUrl, provider),
      });
    }

    console.log(`[CAR_SCRAPER] stageB ${provider} extracted=${fcListings.length} valid=${listings.length}`);
    return { listings, pagesFetched: 1, status: "ok" };
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("aborted") || msg.includes("abort")) {
      console.warn(`[CAR_SCRAPER] stageB ${provider} TIMEOUT after ${STAGE_B_TIMEOUT_MS}ms`);
      return { listings: [], pagesFetched: 1, status: "timeout" };
    }
    console.error(`[CAR_SCRAPER] stageB error:`, msg);
    return { listings: [], pagesFetched: 1, status: `error: ${msg.substring(0, 100)}` };
  }
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
    const maxPages = Math.min(body.max_pages || DEFAULT_MAX_PAGES, MAX_PAGES_CAP);
    const mode = body.mode || "firecrawl-first";
    const dryRun = body.dry_run || false;
    const searchQuery = body.search_query?.trim() || undefined;
    const targetItems = body.target_items || 10;

    console.log(`[CAR_SCRAPER] START provider=${provider} maxPrice=${maxPrice} maxPages=${maxPages} mode=${mode} dryRun=${dryRun} query=${searchQuery || '(none)'} target=${targetItems}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";

    const dropReasons: Record<string, number> = {};
    const blockedStatuses: number[] = [];
    let allListings: CarListing[] = [];
    let modeUsed = "unknown";
    let totalPagesFetched = 0;
    let totalBlocked = 0;
    let firecrawlStatus = "not_used";
    let fallbackUsed = false;
    let diagnostics = "";

    if (!firecrawlKey) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: "FIRECRAWL_API_KEY not configured",
        diagnostics: "Firecrawl API key is not set. Car scraping requires Firecrawl.",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STAGE 0: Firecrawl Search (PRIMARY) ────────────────────────────
    const searchResult = await firecrawlSearch(provider, maxPrice, firecrawlKey, searchQuery, targetItems, dropReasons);
    allListings = searchResult.listings.slice(0, targetItems);
    firecrawlStatus = `search:${searchResult.status}`;
    modeUsed = "search";
    totalPagesFetched = 1;

    console.log(`[CAR_SCRAPER] search result: ${allListings.length} listings (capped to ${targetItems}), status=${searchResult.status}`);

    // ── STAGE A (FALLBACK): Markdown scrape if search insufficient ─────
    if (allListings.length < targetItems && (Date.now() - startTime) < HARD_FUNCTION_CAP_MS - STAGE_A_TIMEOUT_MS) {
      console.log(`[CAR_SCRAPER] search insufficient (${allListings.length}/${targetItems}), trying stageA`);
      fallbackUsed = true;
      const stageA = await firecrawlStageA(provider, maxPrice, maxPages, firecrawlKey, searchQuery, targetItems, dropReasons, startTime);
      const seenIds = new Set(allListings.map(l => l.provider_product_id));
      for (const l of stageA.listings) {
        if (allListings.length >= targetItems) break;
        if (!seenIds.has(l.provider_product_id)) {
          seenIds.add(l.provider_product_id);
          allListings.push(l);
        }
      }
      totalPagesFetched += stageA.pagesFetched;
      firecrawlStatus += ` stageA:${stageA.status}`;
      modeUsed = "search+stageA";
    }

    // ── STAGE B (LAST RESORT): Heavy extract if still insufficient ─────
    if (allListings.length < targetItems && (Date.now() - startTime) < HARD_FUNCTION_CAP_MS - STAGE_B_TIMEOUT_MS) {
      console.log(`[CAR_SCRAPER] still insufficient (${allListings.length}/${targetItems}), trying stageB`);
      fallbackUsed = true;
      const stageB = await firecrawlStageB(provider, maxPrice, firecrawlKey, searchQuery, targetItems, allListings.length, dropReasons, startTime);
      const seenIds = new Set(allListings.map(l => l.provider_product_id));
      for (const l of stageB.listings) {
        if (allListings.length >= targetItems) break;
        if (!seenIds.has(l.provider_product_id)) {
          seenIds.add(l.provider_product_id);
          allListings.push(l);
        }
      }
      totalPagesFetched += stageB.pagesFetched;
      firecrawlStatus += ` stageB:${stageB.status}`;
      modeUsed = "search+stageA+stageB";
    }

    // ── Enforce final count cap ────────────────────────────────────────
    allListings = allListings.slice(0, targetItems);

    // ── Build diagnostics message ──────────────────────────────────────
    if (allListings.length === 0) {
      if (firecrawlStatus.includes("timeout")) {
        diagnostics = "All stages timed out. Try again or use a different query.";
      } else if (firecrawlStatus.includes("search_error")) {
        diagnostics = "Firecrawl Search API returned an error. Check API key and credits.";
      } else {
        diagnostics = `No listings found across all stages. Drop reasons: ${JSON.stringify(dropReasons)}. Try a more specific query.`;
      }
    }

    // ── UPSERT ─────────────────────────────────────────────────────────
    const upsertedCount = await upsertListings(supabase, provider, allListings, modeUsed, dryRun);

    const elapsedMs = Date.now() - startTime;
    const result: ScrapeResult = {
      provider,
      mode_used: modeUsed,
      pages_fetched: totalPagesFetched,
      listings_found: allListings.length,
      upserted_count: upsertedCount,
      blocked_count: totalBlocked,
      parse_methods_used: { search: searchResult.listings.length, firecrawl: allListings.length - searchResult.listings.length },
      sample: allListings.slice(0, 3),
      elapsed_ms: elapsedMs,
      drop_reasons: Object.keys(dropReasons).length > 0 ? dropReasons : undefined,
      firecrawl_status: firecrawlStatus,
      fallback_used: fallbackUsed,
      blocked_statuses: blockedStatuses.length > 0 ? blockedStatuses : undefined,
      diagnostics: diagnostics || undefined,
    };

    console.log(`[CAR_SCRAPER] DONE ${elapsedMs}ms`, JSON.stringify({ ...result, sample: undefined }));

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    console.error("[CAR_SCRAPER] Fatal error:", (err as Error).message);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: (err as Error).message, 
      elapsed_ms: elapsedMs,
      diagnostics: "Fatal error during scraping. Check function logs for details.",
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
