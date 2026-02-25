/**
 * Catalog Car Scraper — Two-Stage Firecrawl with Smart Fallback
 * 
 * Stage A (fast): Firecrawl markdown+links with short wait → parse deterministically
 * Stage B (heavy): Firecrawl extract (structured JSON) only if Stage A insufficient
 * Fallback: Free HTML parsing only if Firecrawl unavailable
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
const STAGE_A_TIMEOUT_MS = 15000;   // 15s for fast markdown scrape
const STAGE_B_TIMEOUT_MS = 18000;   // 18s for heavy extract
const HARD_FUNCTION_CAP_MS = 50000; // 50s total function budget
const BLOCKED_STATUSES = new Set([403, 418, 429, 503]);

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

// ── MARKDOWN LISTING PARSER ────────────────────────────────────────────────
// Parse car listings from Firecrawl markdown output deterministically

function parseListingsFromMarkdown(
  markdown: string,
  links: string[],
  provider: string,
  maxPrice: number,
  dropReasons: Record<string, number>,
): CarListing[] {
  const listings: CarListing[] = [];
  const seenIds = new Set<string>();

  // Strategy 1: Parse markdown lines looking for price + title patterns
  // CarGurus/Carvana markdown typically has lines like:
  //   "2021 Tesla Model 3 Standard Range Plus" followed by "$25,999" or "Price: $25,999"
  const lines = markdown.split("\n").map(l => l.trim()).filter(Boolean);
  
  // Build a map of listing URLs from links array
  const listingUrls: string[] = [];
  const domain = provider === "carvana" ? "carvana.com" : "cargurus.com";
  for (const link of links) {
    if (link.includes(domain) && (
      link.includes("/vehicle/") || 
      link.includes("/listing/") || 
      link.includes("inventoryListing") ||
      link.includes("listingId=") ||
      link.includes("/vdp/")
    )) {
      listingUrls.push(link);
    }
  }

  // Strategy 2: Look for price patterns and nearby text
  const priceRegex = /\$[\d,]+(?:\.\d{2})?/g;
  const yearMakeModelRegex = /\b(19|20)\d{2}\s+[A-Z][a-zA-Z]+\s+[A-Za-z0-9\s\-]+/;
  
  let currentTitle = "";
  let currentPrice: number | null = null;
  let currentImageUrl = "";
  let urlIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for year-make-model pattern (title candidate)
    const titleMatch = line.match(yearMakeModelRegex);
    if (titleMatch) {
      // If we had a previous complete listing, save it
      if (currentTitle && currentPrice !== null) {
        const url = urlIndex < listingUrls.length ? listingUrls[urlIndex++] : "";
        if (url) {
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
          dropReasons["missing_url"] = (dropReasons["missing_url"] || 0) + 1;
        }
      }
      currentTitle = titleMatch[0].trim();
      currentPrice = null;
      currentImageUrl = "";
    }

    // Check for price on this line or nearby
    const priceMatches = line.match(priceRegex);
    if (priceMatches && currentTitle) {
      for (const pm of priceMatches) {
        const p = parseUsd(pm);
        if (p && p <= maxPrice && p >= 500) { // min $500 for a car
          currentPrice = p;
          break;
        } else if (p && p > maxPrice) {
          dropReasons["above_max_price"] = (dropReasons["above_max_price"] || 0) + 1;
        }
      }
    }

    // Check for image URLs
    const imgMatch = line.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (imgMatch && currentTitle) {
      currentImageUrl = imgMatch[1];
    }
  }

  // Don't forget the last pending listing
  if (currentTitle && currentPrice !== null) {
    const url = urlIndex < listingUrls.length ? listingUrls[urlIndex++] : "";
    if (url) {
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
    }
  }

  // Strategy 3: If markdown parsing got few results, try matching prices to URLs directly
  if (listings.length < 3 && listingUrls.length > 0) {
    const allPrices: number[] = [];
    let m: RegExpExecArray | null;
    const priceRe = /\$[\d,]+(?:\.\d{2})?/g;
    while ((m = priceRe.exec(markdown)) !== null) {
      const p = parseUsd(m[0]);
      if (p && p >= 500 && p <= maxPrice) allPrices.push(p);
    }

    // Try to pair remaining URLs with prices
    for (let j = 0; j < listingUrls.length && j < allPrices.length; j++) {
      const url = listingUrls[j];
      const pid = extractProductId(url, provider);
      if (seenIds.has(pid)) continue;
      seenIds.add(pid);
      
      // Try to extract title from URL
      let title = "";
      try {
        const urlPath = new URL(url).pathname;
        const parts = urlPath.split("/").filter(Boolean);
        title = parts.filter(p => !p.match(/^\d+$/)).join(" ").replace(/-/g, " ");
      } catch { /* ignore */ }
      
      if (!title) title = `${provider} listing ${pid}`;

      listings.push({
        title,
        price_usd: allPrices[j],
        image_url: "",
        product_url: url,
        provider_product_id: pid,
        condition: "Used",
      });
    }
  }

  return listings;
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
    const props = nextData?.props?.pageProps;
    if (!props) return { listings, method: "nextdata" };
    
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

// ── FREE SCRAPE PIPELINE ───────────────────────────────────────────────────

async function freeScrape(
  provider: string,
  maxPrice: number,
  maxPages: number,
  searchQuery?: string,
  blockedStatuses?: number[],
): Promise<{
  listings: CarListing[];
  blockedCount: number;
  parseMethods: Record<string, number>;
  pagesFetched: number;
}> {
  const allListings: CarListing[] = [];
  const seenIds = new Set<string>();
  let blockedCount = 0;
  const parseMethods: Record<string, number> = { jsonld: 0, nextdata: 0, state: 0 };
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = buildSearchUrl(provider, maxPrice, page, searchQuery);
    console.log(`[CAR_SCRAPER] free ${provider} page=${page} url=${url}`);

    try {
      const resp = await fetch(url, { 
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(10000), // 10s cap per free fetch
      });
      pagesFetched++;

      if (BLOCKED_STATUSES.has(resp.status)) {
        console.warn(`[CAR_SCRAPER] free ${provider} page=${page} BLOCKED status=${resp.status}`);
        blockedCount++;
        blockedStatuses?.push(resp.status);
        await resp.text();
        // Don't try more pages if blocked — provider is blocking us
        break;
      }
      if (!resp.ok) {
        console.warn(`[CAR_SCRAPER] free ${provider} page=${page} status=${resp.status}`);
        await resp.text();
        continue;
      }

      const html = await resp.text();
      console.log(`[CAR_SCRAPER] free ${provider} page=${page} html_length=${html.length}`);

      const parsers = [
        () => parseJsonLd(html, provider, maxPrice),
        () => parseNextData(html, provider, maxPrice),
        () => parseEmbeddedState(html, provider, maxPrice),
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

      console.log(`[CAR_SCRAPER] free ${provider} page=${page} listings_found=${allListings.length}`);
    } catch (err) {
      console.error(`[CAR_SCRAPER] free ${provider} page=${page} error:`, (err as Error).message);
      blockedCount++;
    }

    if (page < maxPages) await jitterDelay();
  }

  return { listings: allListings, blockedCount, parseMethods, pagesFetched };
}

// ── STAGE A: FAST FIRECRAWL (markdown + links) ────────────────────────────

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
    // Check hard function time cap
    if (Date.now() - functionStartTime > HARD_FUNCTION_CAP_MS) {
      status = "time_cap_reached";
      console.warn(`[CAR_SCRAPER] Stage A: hard time cap reached at ${Date.now() - functionStartTime}ms`);
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
          waitFor: 5000, // 5s render wait (vs 15s before)
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
        console.warn(`[CAR_SCRAPER] stageA: markdown too short (${markdown.length}), likely blocked or empty`);
        status = "markdown_empty";
        continue;
      }

      // Also try to parse HTML content that Firecrawl may include
      const html = data?.data?.html || data?.html || "";

      // Parse from markdown
      const mdListings = parseListingsFromMarkdown(markdown, links, provider, maxPrice, dropReasons);
      
      // Also try JSON-LD from HTML if available
      let htmlListings: CarListing[] = [];
      if (html.length > 500) {
        htmlListings = parseJsonLd(html, provider, maxPrice).listings;
      }

      // Merge both
      for (const listing of [...mdListings, ...htmlListings]) {
        if (!seenIds.has(listing.provider_product_id)) {
          seenIds.add(listing.provider_product_id);
          allListings.push(listing);
        }
      }

      console.log(`[CAR_SCRAPER] stageA ${provider} page=${page} parsed=${mdListings.length}md+${htmlListings.length}html total=${allListings.length}`);

      // Early stop if target reached
      if (allListings.length >= targetItems) {
        console.log(`[CAR_SCRAPER] stageA: target ${targetItems} reached with ${allListings.length}, stopping early`);
        break;
      }
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("aborted") || msg.includes("abort") || msg.includes("signal")) {
        console.warn(`[CAR_SCRAPER] stageA ${provider} page=${page} TIMEOUT after ${STAGE_A_TIMEOUT_MS}ms`);
        status = "timeout";
      } else {
        console.error(`[CAR_SCRAPER] stageA ${provider} page=${page} error:`, msg);
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
  // Only run one page for heavy extraction
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
        waitFor: 8000, // Reduced from 15s
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

    for (const item of fcListings) {
      const rawTitle = item.title || item.name || "";
      const rawUrl = item.listingUrl || item.url || item.link || "";
      const rawPrice = item.price ?? item.priceUsd;

      const title = String(rawTitle).trim();
      const priceNum = parseUsd(rawPrice);
      if (!title) { dropReasons["invalid_title"] = (dropReasons["invalid_title"] || 0) + 1; continue; }
      if (!priceNum) { dropReasons["missing_price"] = (dropReasons["missing_price"] || 0) + 1; continue; }
      if (priceNum > maxPrice) { dropReasons["above_max_price"] = (dropReasons["above_max_price"] || 0) + 1; continue; }

      let productUrl = String(rawUrl).trim();
      if (productUrl && !productUrl.startsWith("http")) {
        const domain = provider === "carvana" ? "https://www.carvana.com" : "https://www.cargurus.com";
        productUrl = `${domain}${productUrl.startsWith("/") ? "" : "/"}${productUrl}`;
      }
      if (!productUrl) { dropReasons["missing_url"] = (dropReasons["missing_url"] || 0) + 1; continue; }

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

    // ── FORCE-FREE ─────────────────────────────────────────────────────
    if (mode === "force-free") {
      const freeResult = await freeScrape(provider, maxPrice, maxPages, searchQuery, blockedStatuses);
      allListings = freeResult.listings;
      totalPagesFetched = freeResult.pagesFetched;
      totalBlocked = freeResult.blockedCount;
      modeUsed = "free-only";
      firecrawlStatus = "skipped";
    }

    // ── FORCE-FIRECRAWL ────────────────────────────────────────────────
    else if (mode === "force-firecrawl") {
      if (!firecrawlKey) {
        return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Run Stage A only
      const stageA = await firecrawlStageA(provider, maxPrice, maxPages, firecrawlKey, searchQuery, targetItems, dropReasons, startTime);
      allListings = stageA.listings;
      totalPagesFetched = stageA.pagesFetched;
      firecrawlStatus = `stageA:${stageA.status}`;
      modeUsed = "firecrawl-stageA";

      // If not enough, try Stage B
      if (allListings.length < targetItems) {
        const stageB = await firecrawlStageB(provider, maxPrice, firecrawlKey, searchQuery, targetItems, allListings.length, dropReasons, startTime);
        const seenIds = new Set(allListings.map(l => l.provider_product_id));
        for (const l of stageB.listings) {
          if (!seenIds.has(l.provider_product_id)) {
            seenIds.add(l.provider_product_id);
            allListings.push(l);
          }
        }
        totalPagesFetched += stageB.pagesFetched;
        firecrawlStatus += ` stageB:${stageB.status}`;
        modeUsed = "firecrawl-stageAB";
      }
    }

    // ── FIRECRAWL-FIRST (default): Stage A → Stage B → free fallback ──
    else {
      if (firecrawlKey) {
        // Stage A: fast markdown+links
        const stageA = await firecrawlStageA(provider, maxPrice, maxPages, firecrawlKey, searchQuery, targetItems, dropReasons, startTime);
        allListings = stageA.listings;
        totalPagesFetched = stageA.pagesFetched;
        firecrawlStatus = `stageA:${stageA.status}`;
        modeUsed = "firecrawl-stageA";

        console.log(`[CAR_SCRAPER] stageA result: ${allListings.length} listings, status=${stageA.status}`);

        // Stage B: only if Stage A got too few and we have time budget
        if (allListings.length < targetItems && (Date.now() - startTime) < HARD_FUNCTION_CAP_MS - STAGE_B_TIMEOUT_MS) {
          console.log(`[CAR_SCRAPER] stageA insufficient (${allListings.length}/${targetItems}), trying stageB`);
          const stageB = await firecrawlStageB(provider, maxPrice, firecrawlKey, searchQuery, targetItems, allListings.length, dropReasons, startTime);
          const seenIds = new Set(allListings.map(l => l.provider_product_id));
          for (const l of stageB.listings) {
            if (!seenIds.has(l.provider_product_id)) {
              seenIds.add(l.provider_product_id);
              allListings.push(l);
            }
          }
          totalPagesFetched += stageB.pagesFetched;
          firecrawlStatus += ` stageB:${stageB.status}`;
          modeUsed = "firecrawl-stageAB";
        }
      }

      // Free fallback only if Firecrawl unavailable or returned 0
      if (allListings.length === 0 && (Date.now() - startTime) < HARD_FUNCTION_CAP_MS - 15000) {
        if (!firecrawlKey) {
          console.log(`[CAR_SCRAPER] No FIRECRAWL_API_KEY, using free-only`);
          firecrawlStatus = "no_key";
        } else {
          console.log(`[CAR_SCRAPER] Firecrawl yielded 0, falling back to free parse`);
        }
        fallbackUsed = true;
        const freeResult = await freeScrape(provider, maxPrice, Math.min(maxPages, 2), searchQuery, blockedStatuses);
        allListings = freeResult.listings;
        totalPagesFetched += freeResult.pagesFetched;
        totalBlocked = freeResult.blockedCount;
        modeUsed = firecrawlKey ? "firecrawl-then-free" : "free-only";

        if (allListings.length === 0 && totalBlocked > 0) {
          diagnostics = `Provider blocked all requests (statuses: ${blockedStatuses.join(",")}). No data could be extracted.`;
        }
      }
    }

    // ── Build diagnostics message ──────────────────────────────────────
    if (allListings.length === 0 && !diagnostics) {
      if (firecrawlStatus.includes("timeout")) {
        diagnostics = "Firecrawl timed out and free fallback was blocked. Try again or use a different query.";
      } else if (totalBlocked > 0) {
        diagnostics = `Provider blocked ${totalBlocked} request(s). Anti-bot protection is active.`;
      } else {
        diagnostics = "No listings found. The provider may have changed its page structure or the query returned no results.";
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
      parse_methods_used: { firecrawl: allListings.length },
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
