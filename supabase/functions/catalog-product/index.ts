/**
 * Catalog Product Details Endpoint - DB-First with Live Fallback (SDK-Free)
 * 
 * GET /catalog-product?id=rainforest:B0GCRKG9N1
 * GET /catalog-product?asin=B0GCRKG9N1
 * POST /catalog-product { provider, id }
 * 
 * DB-First Strategy:
 * - First check catalog_items table (preloaded data)
 * - If not found, fetch from Rainforest/eBay and cache
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 * 
 * SDK-FREE: Uses lightweight PostgREST client to avoid bundler timeouts.
 */

import { createAdminPostgrestClient, PostgrestClient } from "../_shared/postgrest.ts";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";
// fetchProductDetails removed: Amazon is offline-only, no live Rainforest calls from users
import { getEbayItem } from "../_shared/ebayAdapter.ts";
import { getDeviceId } from "../_shared/catalogCache.ts";
import { isDisallowedItem, getBlockedSearchMessage } from "../_shared/contentBlocker.ts";
import { loadPricingSettings, computeAllInclusivePrice } from "../_shared/allInclusivePricing.ts";
import { 
  upgradeEbayImageToHighRes, 
  upgradeAmazonImageToHighRes,
  isEbayThumbnail,
  isAmazonThumbnail 
} from "../_shared/imageOptimization.ts";

// Dev mode check
const IS_DEV = Deno.env.get("DENO_DEPLOYMENT_ID")?.includes("staging") ||
               Deno.env.get("ENV") === "development" ||
               Deno.env.get("NODE_ENV") === "development";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type, X-Variants-Cache, X-Provider, X-Upstream-Ms, X-Total-Ms, X-Source",
  "Cache-Control": "public, max-age=300",
};

function buildDiagHeaders(opts: {
  variantsCache: "HIT" | "MISS" | "SKIP";
  provider: string;
  upstreamMs: number;
  totalMs: number;
  source: string;
}): Record<string, string> {
  return {
    ...corsHeaders,
    "Content-Type": "application/json",
    "X-Variants-Cache": opts.variantsCache,
    "X-Provider": opts.provider,
    "X-Upstream-Ms": String(opts.upstreamMs),
    "X-Total-Ms": String(opts.totalMs),
    "X-Source": opts.source,
  };
}

// isPromotionalImage is now imported from the shared imageUpgrade module
// to prevent drift between local and shared copies.
import { isPromotionalImage, filterProductImages } from "../_shared/imageUpgrade.ts";
import { sanitizeGallery, sanitizeImageUrl, upgradeToHighRes } from "../_shared/imageValidator.ts";

/**
 * Upgrade ALL gallery images to high-resolution for product detail view.
 * Uses the shared imageValidator pipeline (single source of truth):
 * 1. Filter out promo/banner/ad images
 * 2. Upgrade ALL remaining images to high-res
 * 3. Deduplicate by normalized URL
 */
function upgradeGalleryImages(images: string[], _provider: string): string[] {
  return sanitizeGallery(images);
}

/**
 * Scrape gallery images from an eBay listing page HTML.
 * Extracts images from JSON-LD structured data or meta tags.
 * Used as fallback when eBay Browse API is rate-limited (429).
 */
async function scrapeEbayGallery(productUrl: string | null, itemId: string): Promise<string[]> {
  if (!productUrl && !itemId) return [];
  
  const parts = itemId.split("|");
  const numericId = parts.length >= 2 ? parts[1] : itemId.replace(/\D/g, "");
  const url = productUrl || `https://www.ebay.com/itm/${numericId}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    
    if (!res.ok) {
      console.warn(`[GALLERY_SCRAPE] HTTP ${res.status} for ${url}`);
      return [];
    }
    
    const html = await res.text();
    const seen = new Set<string>();
    const images: string[] = [];
    
    const addImage = (imgUrl: string) => {
      if (!imgUrl || !imgUrl.includes("ebayimg.com")) return;
      // Normalize to high-res s-l1600
      const normalized = imgUrl.replace(/\/s-l\d+\./, "/s-l1600.");
      if (!seen.has(normalized)) {
        seen.add(normalized);
        images.push(normalized);
      }
    };
    
    // Strategy 1: Extract from eBay's JS image array (most reliable for gallery)
    // eBay embeds image data in patterns like "imageUrl":"https://i.ebayimg.com/..."
    const jsImgMatches = html.matchAll(/"(?:imageUrl|originalImg|maxImageUrl|image)"\s*:\s*"(https?:\/\/i\.ebayimg\.com\/images\/g\/[^"]+)"/gi);
    for (const match of jsImgMatches) addImage(match[1]);
    
    // Strategy 2: Extract ALL ebayimg URLs from the page (catches JS-embedded ones)
    const allEbayImgs = html.matchAll(/https:\/\/i\.ebayimg\.com\/images\/g\/[A-Za-z0-9_~-]+\/s-l\d+\.(?:jpg|png|webp)/gi);
    for (const match of allEbayImgs) addImage(match[0]);
    
    // Strategy 3: JSON-LD structured data
    const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        const json = JSON.parse(match[1]);
        const extractImg = (obj: any) => {
          if (Array.isArray(obj?.image)) obj.image.forEach((i: any) => addImage(typeof i === "string" ? i : i?.contentUrl || i?.url || ""));
          else if (typeof obj?.image === "string") addImage(obj.image);
        };
        if (Array.isArray(json)) json.forEach(extractImg); else extractImg(json);
      } catch { /* skip */ }
    }
    
    console.log(`[GALLERY_SCRAPE] found ${images.length} unique images for item ${numericId}`);
    return images;
  } catch (e) {
    console.warn(`[GALLERY_SCRAPE] error: ${e}`);
    return [];
  }
}

/**
 * Scrape gallery images from an Amazon product page HTML.
 * Extracts ALL images from colorImages JSON pattern (hiRes + large variants).
 * Falls back to imageGalleryData pattern.
 */
async function scrapeAmazonGallery(productUrl: string | null, asin: string): Promise<string[]> {
  if (!asin) return [];
  
  // Use mobile URL for better scraping success
  const url = productUrl || `https://www.amazon.com/dp/${asin}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
      },
      redirect: "follow",
    });
    
    if (!res.ok) {
      console.warn(`[AMAZON_GALLERY_SCRAPE] HTTP ${res.status} for ${asin}`);
      return [];
    }
    
    const html = await res.text();
    const seen = new Set<string>();
    const images: string[] = [];
    
    const addImage = (imgUrl: string) => {
      if (!imgUrl || typeof imgUrl !== "string") return;
      if (!imgUrl.startsWith("http")) return;
      // Skip tiny placeholders and sprite images
      if (imgUrl.includes("sprite") || imgUrl.includes("transparent-pixel") || imgUrl.includes("grey-pixel")) return;
      // Upgrade to high-res
      const upgraded = upgradeAmazonImageToHighRes(imgUrl);
      if (!seen.has(upgraded)) {
        seen.add(upgraded);
        images.push(upgraded);
      }
    };
    
    // Strategy 1: Extract from colorImages JSON (most reliable, contains all gallery images)
    // Pattern: 'colorImages': { 'initial': [ {"hiRes":"https://...","large":"https://..."}, ... ] }
    const colorImagesMatch = html.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[\s\S]*?\])\s*\}/);
    if (colorImagesMatch) {
      try {
        // Fix single quotes to double quotes for JSON parsing
        const jsonStr = colorImagesMatch[1]
          .replace(/'/g, '"')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        const colorImages = JSON.parse(jsonStr);
        if (Array.isArray(colorImages)) {
          for (const img of colorImages) {
            // Prefer hiRes, fall back to large
            const bestUrl = img?.hiRes || img?.large;
            if (bestUrl) addImage(bestUrl);
          }
          console.log(`[AMAZON_GALLERY_SCRAPE] colorImages: ${images.length} images for ${asin}`);
        }
      } catch (e) {
        console.warn(`[AMAZON_GALLERY_SCRAPE] colorImages parse error for ${asin}: ${e}`);
      }
    }
    
    // Strategy 2: imageGalleryData fallback
    if (images.length === 0) {
      const galleryMatch = html.match(/imageGalleryData\s*:\s*(\[[\s\S]*?\])\s*[,;]/);
      if (galleryMatch) {
        try {
          const jsonStr = galleryMatch[1].replace(/'/g, '"').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
          const galleryData = JSON.parse(jsonStr);
          if (Array.isArray(galleryData)) {
            for (const img of galleryData) {
              const bestUrl = img?.mainUrl || img?.thumbUrl;
              if (bestUrl) addImage(bestUrl);
            }
            console.log(`[AMAZON_GALLERY_SCRAPE] imageGalleryData: ${images.length} images for ${asin}`);
          }
        } catch (e) {
          console.warn(`[AMAZON_GALLERY_SCRAPE] imageGalleryData parse error: ${e}`);
        }
      }
    }
    
    // Strategy 3: Extract all high-res Amazon image URLs from page
    if (images.length === 0) {
      const amazonImgMatches = html.matchAll(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._%-]+\.(?:jpg|png|webp)/gi);
      for (const match of amazonImgMatches) {
        addImage(match[0]);
      }
      if (images.length > 0) {
        console.log(`[AMAZON_GALLERY_SCRAPE] regex fallback: ${images.length} images for ${asin}`);
      }
    }
    
    // Limit to 10 images
    const result = images.slice(0, 10);
    console.log(`[AMAZON_GALLERY_SCRAPE] total ${result.length} unique images for ${asin}`);
    return result;
  } catch (e) {
    console.warn(`[AMAZON_GALLERY_SCRAPE] error for ${asin}: ${e}`);
    return [];
  }
}

/**
 * Firecrawl fallback for Amazon gallery scraping when direct fetch is bot-blocked.
 */
async function scrapeAmazonGalleryFirecrawl(asin: string): Promise<string[]> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    console.warn(`[AMAZON_GALLERY_FIRECRAWL] no FIRECRAWL_API_KEY configured`);
    return [];
  }
  
  try {
    const url = `https://www.amazon.com/dp/${asin}`;
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["html"],
        waitFor: 2000,
      }),
    });
    
    if (!res.ok) {
      console.warn(`[AMAZON_GALLERY_FIRECRAWL] HTTP ${res.status} for ${asin}`);
      return [];
    }
    
    const data = await res.json();
    const html = data?.data?.html || data?.html || "";
    if (!html) return [];
    
    // Extract Amazon image URLs from rendered HTML
    const seen = new Set<string>();
    const images: string[] = [];
    const matches = html.matchAll(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._%-]+\.(?:jpg|png|webp)/gi);
    for (const match of matches) {
      const upgraded = upgradeAmazonImageToHighRes(match[0]);
      if (!seen.has(upgraded) && !upgraded.includes("sprite") && !upgraded.includes("pixel")) {
        seen.add(upgraded);
        images.push(upgraded);
      }
    }
    
    console.log(`[AMAZON_GALLERY_FIRECRAWL] found ${images.length} images for ${asin}`);
    return images.slice(0, 10);
  } catch (e) {
    console.warn(`[AMAZON_GALLERY_FIRECRAWL] error for ${asin}: ${e}`);
    return [];
  }
}

function validateAsin(asin: string): string | null {
  if (!asin || asin.length === 0) return "ASIN is required";
  if (asin.length !== 10) return `ASIN must be 10 characters (got ${asin.length})`;
  if (!/^[A-Z0-9]+$/i.test(asin)) return "ASIN must be alphanumeric (A-Z, 0-9)";
  return null;
}

function sanitizeScrapedImage(url: string, provider: string): string {
  let out = url.trim();
  if (provider === "shein" && out.includes("_thumbnail_126x")) {
    out = out.replace("_thumbnail_126x", "");
  }
  return out;
}

// Use shared image validator — replaces the old isLikelyRealImage
import { isValidProductImageUrl } from "../_shared/imageValidator.ts";

function isLikelyRealImage(url: string): boolean {
  if (!isValidProductImageUrl(url)) return false;
  // Also allow URLs that look like image paths even without known extension
  const lower = url.toLowerCase();
  return /(\.(jpe?g|png|webp|avif))(\?|$)/i.test(lower) || lower.includes("image") || lower.includes("photo");
}

async function scrapeProviderGalleryFromPage(provider: string, productUrl: string | null): Promise<string[]> {
  if (!productUrl) return [];
  try {
    const res = await fetch(productUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) return [];

    const html = await res.text();
    const seen = new Set<string>();
    const out: string[] = [];

    const push = (u: string) => {
      const cleaned = sanitizeScrapedImage(u, provider);
      if (!isLikelyRealImage(cleaned)) return;
      if (seen.has(cleaned)) return;
      seen.add(cleaned);
      out.push(cleaned);
    };

    // OpenGraph / Twitter images
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>/gi)) {
      push(m[1]);
    }

    // JSON-LD image blocks
    for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const parsed = JSON.parse(m[1]);
        const stack = Array.isArray(parsed) ? parsed : [parsed];
        for (const node of stack) {
          const imgs = node?.image;
          if (Array.isArray(imgs)) imgs.forEach((i: any) => typeof i === "string" ? push(i) : push(i?.url || i?.contentUrl || ""));
          else if (typeof imgs === "string") push(imgs);
        }
      } catch {
        // ignore invalid json
      }
    }

    // Generic image URL extraction
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^\s"'<>]*)?/gi)) {
      push(m[0]);
    }

    return out.slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Firecrawl fallback for generic provider gallery scraping when direct fetch is bot-blocked.
 * Works for eBay, SHEIN, CarGurus, Carvana, etc.
 */
async function scrapeProviderGalleryFirecrawl(productUrl: string | null, provider: string): Promise<string[]> {
  if (!productUrl) return [];
  
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    console.warn(`[GALLERY_FIRECRAWL] no FIRECRAWL_API_KEY configured`);
    return [];
  }
  
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: productUrl,
        formats: ["html"],
        waitFor: 2000,
      }),
    });
    
    if (!res.ok) {
      console.warn(`[GALLERY_FIRECRAWL] HTTP ${res.status} for ${provider} ${productUrl}`);
      return [];
    }
    
    const data = await res.json();
    const html = data?.data?.html || data?.html || "";
    if (!html) return [];
    
    const seen = new Set<string>();
    const images: string[] = [];
    
    const push = (u: string) => {
      const cleaned = sanitizeScrapedImage(u, provider);
      if (!isLikelyRealImage(cleaned)) return;
      if (seen.has(cleaned)) return;
      seen.add(cleaned);
      images.push(cleaned);
    };
    
    // OpenGraph / Twitter images
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>/gi)) {
      push(m[1]);
    }
    
    // JSON-LD image blocks
    for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const parsed = JSON.parse(m[1]);
        const stack = Array.isArray(parsed) ? parsed : [parsed];
        for (const node of stack) {
          const imgs = node?.image;
          if (Array.isArray(imgs)) imgs.forEach((i: any) => typeof i === "string" ? push(i) : push(i?.url || i?.contentUrl || ""));
          else if (typeof imgs === "string") push(imgs);
        }
      } catch { /* ignore */ }
    }
    
    // eBay-specific: extract ebayimg URLs
    if (provider === "ebay") {
      for (const m of html.matchAll(/https:\/\/i\.ebayimg\.com\/images\/g\/[A-Za-z0-9_~-]+\/s-l\d+\.(?:jpg|png|webp)/gi)) {
        const normalized = m[0].replace(/\/s-l\d+\./, "/s-l1600.");
        if (!seen.has(normalized)) {
          seen.add(normalized);
          images.push(normalized);
        }
      }
    }
    
    // Generic image URL extraction
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^\s"'<>]*)?/gi)) {
      push(m[0]);
    }
    
    console.log(`[GALLERY_FIRECRAWL] ${provider}: found ${images.length} images`);
    return images.slice(0, 20);
  } catch (e) {
    console.warn(`[GALLERY_FIRECRAWL] error for ${provider}: ${e}`);
    return [];
  }
}

function isLikelyEbayId(id: string): boolean {
  return id.startsWith("v1|") || id.includes("|") || /^\d{12,}$/.test(id);
}

function isLikelyAsin(id: string): boolean {
  return /^[A-Z0-9]{10}$/i.test(id);
}

/**
 * Parse canonical product ID format
 * 
 * CANONICAL FORMATS (no provider param needed):
 * - amazon_B0DQVHHTFN -> provider=amazon, productId=B0DQVHHTFN
 * - ebay_v1|123456789|987654321 -> provider=ebay, productId=v1|123456789|987654321
 * - ebay_123456789012 -> provider=ebay, productId=123456789012
 * 
 * LEGACY FORMATS (still supported):
 * - rainforest:B0DQVHHTFN -> provider=amazon, productId=B0DQVHHTFN
 * - ebay:v1|... -> provider=ebay, productId=v1|...
 * - Raw ASIN with provider=amazon -> provider=amazon
 * 
 * IMPORTANT: This function NEVER requires a provider param if canonical ID is used.
 */
function parseProductId(url: URL): { provider: string | null; productId: string | null; rawId: string; idError: string | null; externalProvider: string } {
  let provider: string | null = null;
  let productId: string | null = null;
  let externalProvider: string = "amazon"; // For response - always amazon or ebay

  const id = (url.searchParams.get("id") || "").trim();
  const providerParam = (url.searchParams.get("provider") || "").trim().toLowerCase();
  
  // Decode URL-encoded characters (e.g., %7C -> |)
  const decodedId = decodeURIComponent(id);
  const decodedLower = decodedId.toLowerCase();
  
  // ===== CANONICAL FORMAT: amazon_<ASIN> or ebay_<fullId> =====
  // This is the PREFERRED format - no provider param needed
  if (decodedLower.startsWith("amazon_")) {
    provider = "amazon";
    productId = decodedId.slice(7).toUpperCase(); // ASIN always uppercase
    externalProvider = "amazon";
    console.log(`[CATALOG_PRODUCT] canonical_amazon productId=${productId}`);
  }
  else if (decodedLower.startsWith("ebay_")) {
    provider = "ebay";
    productId = decodedId.slice(5); // Keep ebay IDs as-is (v1|...|...)
    externalProvider = "ebay";
    console.log(`[CATALOG_PRODUCT] canonical_ebay productId=${productId?.substring(0, 30)}`);
  }
  // ===== LEGACY: rainforest_ prefix (normalize to amazon) =====
  else if (decodedLower.startsWith("rainforest_")) {
    provider = "amazon";
    productId = decodedId.slice(11).toUpperCase();
    externalProvider = "amazon";
    console.log(`[CATALOG_PRODUCT] legacy_rainforest productId=${productId}`);
  }
  // ===== LEGACY: colon separator (rainforest:ASIN, ebay:v1|...) =====
  else if (decodedId && decodedId.includes(":") && !decodedId.startsWith("v1")) {
    const colonIndex = decodedId.indexOf(":");
    const providerPart = decodedId.slice(0, colonIndex).toLowerCase();
    provider = providerPart === "rainforest" ? "amazon" : providerPart;
    productId = decodedId.slice(colonIndex + 1) || null;
    externalProvider = provider === "ebay" ? "ebay" : "amazon";
  }
  // ===== EXPLICIT provider param (legacy web app support) =====
  else if (providerParam && decodedId) {
    provider = providerParam === "rainforest" ? "amazon" : providerParam;
    productId = decodedId;
    externalProvider = provider === "ebay" ? "ebay" : "amazon";
  }
  // ===== INFER from ID format (fallback) =====
  else if (decodedId) {
    const asin = url.searchParams.get("asin")?.trim();
    const itemId = url.searchParams.get("itemId")?.trim();
    
    if (asin) {
      provider = "amazon";
      productId = asin.toUpperCase();
    } else if (itemId) {
      provider = "ebay";
      productId = itemId;
    } else if (isLikelyEbayId(decodedId)) {
      provider = "ebay";
      productId = decodedId;
    } else if (isLikelyAsin(decodedId)) {
      provider = "amazon";
      productId = decodedId.toUpperCase();
    } else {
      // Unknown format - try as raw ASIN (most common case)
      provider = "amazon";
      productId = decodedId.toUpperCase();
    }
    externalProvider = provider === "ebay" ? "ebay" : "amazon";
  }

  // Normalize provider names
  if (provider === "rainforest") {
    provider = "amazon";
  }
  
  // Set external provider
  externalProvider = provider || "amazon";

  // Normalize ASIN to uppercase for amazon
  if (provider === "amazon" && productId) {
    productId = productId.toUpperCase();
  }

  // For internal lookups, we still use rainforest:ASIN format in DB
  const internalProvider = provider === "amazon" ? "rainforest" : provider;
  const rawId = internalProvider && productId ? `${internalProvider}:${productId}` : productId || id || "";
  
  let idError: string | null = null;
  if (!productId) {
    idError = "Product ID is required";
  } else if (provider === "amazon") {
    idError = validateAsin(productId);
  }

  return { provider, productId, rawId, idError, externalProvider };
}

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  mainImageUrl: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  reviewCount?: number | null;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  categoryKey?: string | null;
  vehiclesSubkey?: string | null;
  condition?: string;
  attributes?: Record<string, string>;
  variants?: Array<{
    asin?: string;
    title?: string;
    dimensions?: Array<{ name: string; value: string }>;
    image?: string;
    link?: string;
    price?: { value: number; currency: string };
    isCurrent?: boolean;
  }>;
}

function mapDbItemToResponse(item: any): CatalogItem {
  const provider = item.provider || "rainforest";
  
  let allImages: string[] = [];
  if (item.images && Array.isArray(item.images)) {
    allImages = item.images.filter((img: any): img is string => typeof img === "string" && img.length > 0);
  }
  
  // Fallback: extract images from raw JSON (Amazon/Rainforest products with stored raw data)
  const raw = item.raw as Record<string, any> | null;
  if (allImages.length === 0 && raw) {
    if (raw.processedImages && Array.isArray(raw.processedImages)) {
      allImages = raw.processedImages.filter((url: any) => typeof url === "string" && url.length > 0);
      console.log(`[CATALOG_PRODUCT] extracted ${allImages.length} images from raw.processedImages for ${item.id}`);
    } else if (raw.images && Array.isArray(raw.images)) {
      allImages = raw.images
        .map((i: any) => i?.large || i?.hi_res || i?.link || (typeof i === "string" ? i : null))
        .filter((url: any): url is string => !!url && typeof url === "string");
      console.log(`[CATALOG_PRODUCT] extracted ${allImages.length} images from raw.images for ${item.id}`);
    }
  }
  
  if (item.image_url && !allImages.includes(item.image_url)) {
    allImages.unshift(item.image_url);
  }
  
  allImages = upgradeGalleryImages(allImages, provider);
  const mainImage = allImages[0] || null;

  // Extract variants from raw data if available
  let variants: CatalogItem["variants"] = undefined;
  const variantSources: string[] = [];
  
  if (raw?.variants && Array.isArray(raw.variants)) {
    variantSources.push('variants');
    variants = raw.variants
      .filter((v: any) => v.asin || v.id || v.itemId)
      .slice(0, 30)
      .map((v: any) => {
        // Build dimensions from explicit dimensions array
        let dims = Array.isArray(v.dimensions)
          ? v.dimensions.map((d: any) => ({ name: d.name || '', value: d.value || '' }))
          : [];
        
        // Fallback 1: merge from per-variant variation_values (Rainforest)
        if (v.variation_values && typeof v.variation_values === 'object') {
          for (const [dimName, dimVal] of Object.entries(v.variation_values)) {
            const exists = dims.some((d: any) => d.name.toLowerCase() === dimName.toLowerCase());
            if (!exists && dimVal) {
              dims.push({ name: dimName, value: String(dimVal) });
            }
          }
        }
        
        // Fallback 2: top-level fields (size, color, style)
        for (const field of ['size', 'color', 'style', 'model']) {
          if (v[field] && !dims.some((d: any) => d.name.toLowerCase() === field)) {
            dims.push({ name: field.charAt(0).toUpperCase() + field.slice(1), value: String(v[field]) });
          }
        }
        
        return {
          asin: v.asin || v.id || v.itemId,
          title: v.title || undefined,
          dimensions: dims.length > 0 ? dims : undefined,
          image: typeof v.main_image === 'string' ? v.main_image : v.main_image?.link || v.image || undefined,
          link: v.link || undefined,
          price: v.price?.value ? { value: v.price.value, currency: v.price.currency || 'USD' } : undefined,
          isCurrent: v.is_current === true,
        };
      });
  }
  
  // Fallback: build variants from raw.variants_v2 (alternative Rainforest format)
  if (raw && (!variants || variants.length === 0) && raw.variants_v2 && Array.isArray(raw.variants_v2)) {
    variantSources.push('variants_v2');
    variants = raw.variants_v2
      .filter((v: any) => v.asin || v.id)
      .slice(0, 30)
      .map((v: any) => {
        const dims: Array<{ name: string; value: string }> = [];
        if (v.dimensions && typeof v.dimensions === 'object') {
          for (const [name, value] of Object.entries(v.dimensions)) {
            if (value) dims.push({ name, value: String(value) });
          }
        }
        return {
          asin: v.asin || v.id,
          title: v.title || undefined,
          dimensions: dims.length > 0 ? dims : undefined,
          image: v.image || v.main_image || undefined,
          link: v.link || undefined,
          price: v.price?.value ? { value: v.price.value, currency: v.price.currency || 'USD' } : undefined,
          isCurrent: v.is_current === true,
        };
      });
  }
  
  // Fallback: build synthetic variants from raw.variation_values (top-level dimension groups)
  // This handles products where Rainforest returns { variation_values: { Size: ["S","M","L"], Color: ["Red","Blue"] } }
  if (raw && (!variants || variants.length === 0) && raw.variation_values && typeof raw.variation_values === 'object') {
    variantSources.push('variation_values');
    // variation_values is { DimensionName: [values] } — create a synthetic variant per combination isn't practical,
    // but we can at least ensure dimensions are available on the current variant
    // The frontend uses variantGroups which iterates variants[].dimensions — so we need at least one variant entry
    const dims: Array<{ name: string; value: string }> = [];
    for (const [dimName, values] of Object.entries(raw.variation_values)) {
      if (Array.isArray(values) && values.length > 0) {
        dims.push({ name: dimName, value: String(values[0]) });
      } else if (typeof values === 'string') {
        dims.push({ name: dimName, value: values });
      }
    }
    if (dims.length > 0) {
      variants = [{ asin: item.provider_product_id, dimensions: dims, isCurrent: true }];
    }
  }
  
  // Fallback: eBay aspects format { name: "Size", values: ["10"] }
  if (raw && (!variants || variants.length === 0) && raw.aspects && Array.isArray(raw.aspects)) {
    variantSources.push('aspects');
    const dims: Array<{ name: string; value: string }> = [];
    for (const aspect of raw.aspects) {
      if (aspect.name && aspect.values && Array.isArray(aspect.values) && aspect.values.length > 0) {
        dims.push({ name: aspect.name, value: String(aspect.values[0]) });
      }
    }
    if (dims.length > 0) {
      variants = [{ asin: item.provider_product_id, dimensions: dims, isCurrent: true }];
    }
  }
  
  // Enrich existing variants: if variants exist but Size is missing globally, check top-level raw fields
  if (variants && variants.length > 0 && raw) {
    const anyHasSize = variants.some(v => v.dimensions?.some(d => d.name.toLowerCase() === 'size'));
    if (!anyHasSize) {
      // Check raw.variation_values.Size for available sizes
      const sizeValues = raw.variation_values?.Size || raw.variation_values?.size;
      if (Array.isArray(sizeValues) && sizeValues.length > 0) {
        variantSources.push('size_enrichment');
        // Add first size value to current variant as fallback indicator
        for (const v of variants) {
          if (v.isCurrent && v.dimensions) {
            v.dimensions.push({ name: 'Size', value: String(sizeValues[0]) });
            break;
          }
        }
      }
    }
  }
  
  // Log variant sources for debugging
  const hasSizeAfter = variants?.some(v => v.dimensions?.some(d => d.name.toLowerCase() === 'size')) || false;
  if (variantSources.length > 0) {
    console.log(`[CATALOG_PRODUCT] ${item.id} variant_sources=[${variantSources.join(',')}] count=${variants?.length || 0} hasSize=${hasSizeAfter}`);
  }
  
  return {
    id: item.id,
    provider,
    providerProductId: item.provider_product_id,
    title: item.title || "",
    priceUsd: item.price_usd,
    mainImageUrl: mainImage,
    imageUrl: mainImage,
    imageUrls: allImages,
    images: allImages,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    reviewCount: item.review_count,
    description: raw?.description || null,
    brand: item.brand,
    category: item.category,
    categoryKey: item.category_key || null,
    vehiclesSubkey: item.vehicles_subkey || null,
    variants,
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  const url = new URL(req.url);
  const envName = getEnvironmentFromRequest(req);
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";

  // Load all-inclusive pricing settings once per request
  let pricingSettings: Awaited<ReturnType<typeof loadPricingSettings>> | null = null;
  try {
    pricingSettings = await loadPricingSettings();
  } catch (e) {
    console.warn(`[CATALOG_PRODUCT] pricing settings load failed: ${e}`);
  }

  /** Apply all-inclusive pricing to a CatalogItem before returning to client */
  function applyAllInclusivePriceToItem(item: CatalogItem): CatalogItem {
    if (!pricingSettings || !item.priceUsd || item.priceUsd <= 0) return item;
    // Skip vehicles — they have their own tiered pricing
    const prov = (item.provider || "").toLowerCase();
    if (prov === "cargurus" || prov === "carvana") return item;
    const basePriceUsd = item.priceUsd;
    const allInclusive = computeAllInclusivePrice(basePriceUsd, pricingSettings);
    return {
      ...item,
      priceUsd: allInclusive,
      basePriceUsd: basePriceUsd,
      feesIncluded: true,
      pricingMode: "all_inclusive",
    } as CatalogItem & { basePriceUsd: number; feesIncluded: boolean; pricingMode: string };
  }

  let provider: string | null = null;
  let productId: string | null = null;
  let rawId: string = "";
  let idError: string | null = null;
  
  // Try POST body first
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body.provider) provider = String(body.provider).toLowerCase();
      if (body.id) {
        productId = decodeURIComponent(String(body.id));
        rawId = provider && productId ? `${provider}:${productId}` : productId;
      }
      externalProvider = provider || externalProvider;
      console.log(`[CATALOG_PRODUCT] start correlationId=${correlationId} method=POST provider=${provider} idRaw=${productId?.substring(0, 40)}`);
    } catch {
      // Fall through to GET params
    }
  }
  
  // Fall back to GET params
  let externalProvider: string = "amazon";
  if (!productId) {
    const parsed = parseProductId(url);
    provider = parsed.provider;
    productId = parsed.productId;
    rawId = parsed.rawId;
    idError = parsed.idError;
    externalProvider = parsed.externalProvider;
    console.log(`[CATALOG_PRODUCT] start correlationId=${correlationId} method=GET provider=${provider} externalProvider=${externalProvider} idRaw=${productId?.substring(0, 40)}`);
  }

  const errorResponse = (code: string, message: string) => {
    // ALWAYS return 200 for error responses - never 4xx/5xx
    console.log(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} code=${code} error=${message} ms=${Date.now() - startTime}`);
    return new Response(JSON.stringify({
      ok: false,
      status: "error",
      env: envName,
      id: rawId || null,
      provider: externalProvider,
      correlationId,
      item: null,
      product: null,
      source: "error",
      meta: {
        provider: externalProvider,
        idRaw: rawId || productId || null,
        idNormalized: productId || null,
        correlationId,
        ts: Date.now(),
      },
      error: { code, message },
    }), {
      status: 200, // ALWAYS 200 - never throw on errors
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  // Return errors as 200 JSON - don't block frontend
  if (idError) return errorResponse("INVALID_ID", idError);
  if (!productId) return errorResponse("MISSING_ID", "Product ID is required");
  
  // Accept amazon/rainforest/ebay plus DB-only providers
  const SUPPORTED_PROVIDERS = ["amazon", "rainforest", "ebay", "shein", "cargurus", "carvana"];
  if (provider && !SUPPORTED_PROVIDERS.includes(provider)) {
    return errorResponse("PROVIDER_NOT_SUPPORTED", `Provider '${provider}' not supported.`);
  }

  // Internal provider: amazon -> rainforest for DB lookups
  const internalProvider = (provider === "amazon" || provider === "rainforest" || !provider) ? "rainforest" : provider;
  const fullProductId = internalProvider === "rainforest" 
    ? `amazon_${productId}` 
    : `${internalProvider}_${productId}`;

  try {
    // Create SDK-free DB client
    const db = createAdminPostgrestClient();

    // ========== VARIANTS CACHE HELPER ==========
    const variantsSource = internalProvider === "rainforest"
      ? "amazon"
      : internalProvider === "ebay"
        ? "ebay"
        : null;
    
    async function getCachedVariants(): Promise<CatalogItem["variants"] | null> {
      if (!variantsSource) return null;
      try {
        const { data } = await db
          .from("product_variants_cache")
          .select("variants_json")
          .eq("source", variantsSource)
          .eq("product_id", productId!)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (data?.variants_json && Array.isArray(data.variants_json) && data.variants_json.length > 0) {
          return data.variants_json as CatalogItem["variants"];
        }
        return null;
      } catch { return null; }
    }

    async function cacheVariants(variants: CatalogItem["variants"]): Promise<void> {
      if (!variantsSource) return;
      if (!variants || variants.length === 0) return;
      const ttlDays = variantsSource === "amazon" ? 7 : 2;
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
      try {
        await db.from("product_variants_cache").upsert({
          source: variantsSource,
          product_id: productId!,
          variants_json: variants,
          updated_at: new Date().toISOString(),
          expires_at: expiresAt,
        }, { onConflict: "source,product_id" });
        console.log(`[VARIANTS_CACHE] cached ${variants.length} variants for ${variantsSource}:${productId} ttl=${ttlDays}d`);
      } catch (e) {
        console.warn(`[VARIANTS_CACHE] write failed: ${e}`);
      }
    }

    // ========== DB-FIRST: Check catalog_items + variants + media in PARALLEL ==========
    console.log(`[DETAIL_DB] correlationId=${correlationId} id=${fullProductId} checking...`);
    
    // Also fetch from catalog_item_media for full gallery images
    const mediaProvider = internalProvider === "rainforest" ? "amazon" : internalProvider;
    const [dbItemResult, dbItemByProviderResult, cachedVariantsResult, mediaResult] = await Promise.all([
      db.from("catalog_items").select("*").eq("id", fullProductId).maybeSingle(),
      db.from("catalog_items").select("*").eq("provider", internalProvider === "rainforest" ? "amazon" : internalProvider).eq("provider_product_id", productId!).maybeSingle(),
      getCachedVariants(),
      db.from("catalog_item_media").select("image_urls,image_count").eq("provider", mediaProvider).eq("provider_item_id", productId!).gt("expires_at", new Date().toISOString()).maybeSingle(),
    ]);

    const dbItem = dbItemResult.data || dbItemByProviderResult.data;

    if (dbItem) {
      // Guardrail 2: Direct +3 popularity increment (product detail = low volume)
      db.from("catalog_items")
        .update({ popularity_score: (dbItem.popularity_score || 0) + 3 })
        .eq("id", fullProductId)
        .then(() => {})
        .catch(() => {});
      const item = mapDbItemToResponse(dbItem);
      
      // Merge media gallery images: always prefer media gallery when it has more/equal images
      const mediaData = mediaResult?.data;
      if (mediaData?.image_urls && Array.isArray(mediaData.image_urls)) {
        const mediaImages = (mediaData.image_urls as string[]).filter((url: string) => typeof url === "string" && url.length > 0);
        // Always merge if media has images — it's the enriched gallery source of truth
        if (mediaImages.length > 0) {
          const upgradedMedia = upgradeGalleryImages(mediaImages, provider || "amazon");
          console.log(`[CATALOG_PRODUCT] merging ${upgradedMedia.length} media images (was ${item.images.length}) for ${fullProductId}`);
          // Start with media gallery, then append any unique non-thumbnail DB images
          const seen = new Set(upgradedMedia);
          const merged = [...upgradedMedia];
          for (const img of item.images) {
            if (!img || seen.has(img)) continue;
            // Skip known low-res thumbnails
            const isLowRes = /s-l(64|96|140|225|300)\b/i.test(img) || /thumb|thumbnail|small/i.test(img) || /_(SS|SX|SY)\d{2,3}\./i.test(img);
            if (!isLowRes) {
              merged.push(img);
              seen.add(img);
            }
          }
          item.images = merged;
          item.imageUrls = merged;
          item.mainImageUrl = merged[0] || null;
          item.imageUrl = merged[0] || null;
        }
      }
      
      // ========== eBay Gallery Enrichment: fetch full gallery if only 0-4 images ==========
      if (dbItem.provider === "ebay" && (item.images?.length || 0) <= 4) {
        let enrichedImages: string[] = [];
        
        try {
          console.log(`[GALLERY_ENRICH] eBay item ${productId} has ${item.images?.length ?? 0} images, trying API...`);
          const liveResult = await getEbayItem(db, productId!);
          const liveItem = liveResult?.item;
          const wasRateLimited = liveResult?.debug?.httpStatus === 429;
          
          if (liveItem && Array.isArray(liveItem.images) && liveItem.images.length > (item.images?.length || 0)) {
            enrichedImages = upgradeGalleryImages(liveItem.images, "ebay");
            console.log(`[GALLERY_ENRICH] API success for ${productId}: ${enrichedImages.length} images`);
          } else if (wasRateLimited || !liveItem) {
            // Fallback: scrape gallery from eBay listing page (NO Firecrawl — credit conservation)
            console.log(`[GALLERY_ENRICH] API ${wasRateLimited ? '429 rate-limited' : 'no result'}, trying page scrape for ${productId}...`);
            const scrapedImages = await scrapeEbayGallery(item.productUrl || dbItem.product_url, productId!);
            if (scrapedImages.length > (item.images?.length || 0)) {
              enrichedImages = upgradeGalleryImages(scrapedImages, "ebay");
              console.log(`[GALLERY_ENRICH] scrape success for ${productId}: ${enrichedImages.length} images`);
            }
            // Firecrawl fallback DISABLED to conserve credits
          }
        } catch (e) {
          console.warn(`[GALLERY_ENRICH] API failed for ${productId}, trying scrape fallback: ${e}`);
          try {
            const scrapedImages = await scrapeEbayGallery(item.productUrl || dbItem.product_url, productId!);
            if (scrapedImages.length > (item.images?.length || 0)) {
              enrichedImages = upgradeGalleryImages(scrapedImages, "ebay");
              console.log(`[GALLERY_ENRICH] scrape fallback success for ${productId}: ${enrichedImages.length} images`);
            }
            // Firecrawl fallback DISABLED to conserve credits
          } catch (scrapeErr) {
            console.warn(`[GALLERY_ENRICH] scrape also failed for ${productId}: ${scrapeErr}`);
          }
        }
        
        // Apply enriched images if we got more than what we had
        if (enrichedImages.length > (item.images?.length || 0)) {
          console.log(`[GALLERY_ENRICH] enriched ${productId}: ${item.images?.length ?? 0} → ${enrichedImages.length} images`);
          item.images = enrichedImages;
          item.imageUrls = enrichedImages;
          item.mainImageUrl = enrichedImages[0] || item.mainImageUrl;
          item.imageUrl = enrichedImages[0] || item.imageUrl;

          // Persist enriched gallery back to catalog_items (fire-and-forget)
          const dbRowId = dbItem.id || fullProductId;
          db.from("catalog_items")
            .update({ 
              images: enrichedImages, 
              image_url: enrichedImages[0] || dbItem.image_url,
              updated_at: new Date().toISOString() 
            })
            .eq("id", dbRowId)
            .then(() => console.log(`[GALLERY_ENRICH] persisted ${enrichedImages.length} images for ${dbRowId}`))
            .catch((e: any) => console.warn(`[GALLERY_ENRICH] persist failed: ${e}`));

          // Also persist to catalog_item_media for future use
          db.from("catalog_item_media")
            .upsert({
              provider: "ebay",
              provider_item_id: productId!,
              image_urls: enrichedImages,
              image_count: enrichedImages.length,
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }, { onConflict: "provider,provider_item_id" })
            .then(() => {})
            .catch((e: any) => console.warn(`[GALLERY_ENRICH] media persist failed: ${e}`));
        }
      }

      // ========== Amazon Gallery Enrichment: fetch full gallery if only 0-4 images ==========
      if ((dbItem.provider === "rainforest" || dbItem.provider === "amazon") && (item.images?.length || 0) <= 4) {
        let enrichedImages: string[] = [];
        const amazonAsin = dbItem.provider_product_id || productId!;
        
        try {
          console.log(`[GALLERY_ENRICH] Amazon item ${amazonAsin} has ${item.images?.length ?? 0} images, trying scrape...`);
          const scrapedImages = await scrapeAmazonGallery(item.productUrl || dbItem.product_url, amazonAsin);
          
          if (scrapedImages.length > (item.images?.length || 0)) {
            enrichedImages = scrapedImages;
            console.log(`[GALLERY_ENRICH] Amazon scrape success for ${amazonAsin}: ${enrichedImages.length} images`);
          }
          
          // Firecrawl fallback when direct scrape fails or returns too few
          if (enrichedImages.length <= (item.images?.length || 0)) {
            try {
              const budgetCheck = await db.rpc("check_provider_budget", { p_provider: "gallery_enrich_amazon", p_window_type: "day", p_limit: 50 });
              const budgetData = budgetCheck?.data;
              if (budgetData?.allowed) {
                console.log(`[GALLERY_ENRICH] Amazon Firecrawl fallback for ${amazonAsin} (budget: ${budgetData.remaining} remaining)`);
                const firecrawlImages = await scrapeAmazonGalleryFirecrawl(amazonAsin);
                if (firecrawlImages.length > Math.max(enrichedImages.length, item.images?.length || 0)) {
                  enrichedImages = firecrawlImages;
                  console.log(`[GALLERY_ENRICH] Amazon Firecrawl success for ${amazonAsin}: ${enrichedImages.length} images`);
                }
                await db.rpc("increment_provider_budget", { p_provider: "gallery_enrich_amazon", p_window_type: "day" });
              } else {
                console.log(`[GALLERY_ENRICH] Amazon Firecrawl budget exhausted (${budgetData?.count}/${budgetData?.limit})`);
              }
            } catch (fcErr) {
              console.warn(`[GALLERY_ENRICH] Amazon Firecrawl budget check failed: ${fcErr}`);
            }
          }
        } catch (e) {
          console.warn(`[GALLERY_ENRICH] Amazon scrape failed for ${amazonAsin}: ${e}`);
        }
        
        // Apply enriched images
        if (enrichedImages.length > (item.images?.length || 0)) {
          console.log(`[GALLERY_ENRICH] Amazon enriched ${amazonAsin}: ${item.images?.length ?? 0} → ${enrichedImages.length} images`);
          item.images = enrichedImages;
          item.imageUrls = enrichedImages;
          item.mainImageUrl = enrichedImages[0] || item.mainImageUrl;
          item.imageUrl = enrichedImages[0] || item.imageUrl;

          // Persist enriched gallery back to catalog_items (fire-and-forget)
          const dbRowId = dbItem.id || fullProductId;
          db.from("catalog_items")
            .update({ 
              images: enrichedImages, 
              image_url: enrichedImages[0] || dbItem.image_url,
              updated_at: new Date().toISOString() 
            })
            .eq("id", dbRowId)
            .then(() => console.log(`[GALLERY_ENRICH] Amazon persisted ${enrichedImages.length} images for ${dbRowId}`))
            .catch((e: any) => console.warn(`[GALLERY_ENRICH] Amazon persist failed: ${e}`));

          // Also persist to catalog_item_media
          db.from("catalog_item_media")
            .upsert({
              provider: "amazon",
              provider_item_id: amazonAsin,
              image_urls: enrichedImages,
              image_count: enrichedImages.length,
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }, { onConflict: "provider,provider_item_id" })
            .then(() => {})
            .catch((e: any) => console.warn(`[GALLERY_ENRICH] Amazon media persist failed: ${e}`));
        }
      }

      // ========== DB-only providers Gallery Enrichment (SHEIN/CarGurus/Carvana) ==========
      if ((dbItem.provider === "shein" || dbItem.provider === "cargurus" || dbItem.provider === "carvana") && (item.images?.length || 0) <= 2) {
        let scraped = await scrapeProviderGalleryFromPage(dbItem.provider, item.productUrl || dbItem.product_url);
        
        // Firecrawl fallback for items with <=1 image, budget-controlled (100/day)
        if (scraped.length <= 1) {
          try {
            const budgetCheck = await db.rpc("check_provider_budget", { p_provider: "gallery_enrich", p_window_type: "day", p_limit: 100 });
            const budgetData = budgetCheck?.data;
            if (budgetData?.allowed) {
              console.log(`[GALLERY_ENRICH] Firecrawl fallback for ${dbItem.provider} ${productId} (budget: ${budgetData.remaining} remaining)`);
              const firecrawlScraped = await scrapeProviderGalleryFirecrawl(item.productUrl || dbItem.product_url, dbItem.provider);
              if (firecrawlScraped.length > scraped.length) {
                scraped = firecrawlScraped;
              }
              // Increment budget regardless of success
              await db.rpc("increment_provider_budget", { p_provider: "gallery_enrich", p_window_type: "day" });
            } else {
              console.log(`[GALLERY_ENRICH] Firecrawl budget exhausted for gallery_enrich (${budgetData?.count}/${budgetData?.limit})`);
            }
          } catch (e) {
            console.warn(`[GALLERY_ENRICH] Budget check failed: ${e}`);
          }
        }
        
        // Upgrade scraped images to high-res and filter promos
        const upgradedScraped = upgradeGalleryImages(scraped, dbItem.provider);
        if (upgradedScraped.length > (item.images?.length || 0)) {
          console.log(`[GALLERY_ENRICH] ${dbItem.provider} enriched ${productId}: ${item.images?.length ?? 0} → ${upgradedScraped.length} images`);
          item.images = upgradedScraped;
          item.imageUrls = upgradedScraped;
          item.mainImageUrl = upgradedScraped[0] || item.mainImageUrl;
          item.imageUrl = upgradedScraped[0] || item.imageUrl;

          const dbRowId = dbItem.id || fullProductId;
          db.from("catalog_items")
            .update({ images: upgradedScraped, image_url: upgradedScraped[0] || dbItem.image_url, updated_at: new Date().toISOString() })
            .eq("id", dbRowId)
            .then(() => {})
            .catch(() => {});

          db.from("catalog_item_media")
            .upsert({
              provider: dbItem.provider,
              provider_item_id: dbItem.provider_product_id || productId!,
              image_urls: upgradedScraped,
              image_count: upgradedScraped.length,
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }, { onConflict: "provider,provider_item_id" })
            .then(() => {})
            .catch(() => {});
        }
      }

      const blockCheck = isDisallowedItem({
        title: item.title,
        productUrl: item.productUrl,
        category: item.category,
      });
      
      if (blockCheck.isDisallowed) {
        console.log(`[DETAIL_DB] correlationId=${correlationId} BLOCKED`);
        return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
      }
      
      // Use pre-fetched variants cache result if available
      if (cachedVariantsResult) {
        item.variants = cachedVariantsResult;
      }
      
      // Always return DB item — live fetch may fail (expired API keys, rate limits, etc.)
      // and losing existing data is worse than showing fewer images
      const variantsCacheStatus = cachedVariantsResult ? "HIT" : "MISS";
      console.log(JSON.stringify({ event: "DETAIL_RESPONSE", correlationId, provider: externalProvider, id: productId, dbHit: true, variantsCacheHit: !!cachedVariantsResult, liveFetch: false, variantsCount: cachedVariantsResult?.length ?? 0, imageCount: item.images?.length ?? 0, totalMs: Date.now() - startTime }));
      
      const pricedItem = applyAllInclusivePriceToItem(item);
      return new Response(JSON.stringify({
        ok: true,
        status: "success",
        env: envName,
        id: fullProductId,
        item: pricedItem,
        product: pricedItem,
        source: "db",
        cached: true,
        error: null,
      }), {
        status: 200,
        headers: buildDiagHeaders({ variantsCache: variantsCacheStatus, provider: externalProvider, upstreamMs: 0, totalMs: Date.now() - startTime, source: `db+variants_${variantsCacheStatus.toLowerCase()}` }),
      });
    }
    
    // DB-only providers (SHEIN/CarGurus/Carvana): no live fallback
    if (internalProvider !== "rainforest" && internalProvider !== "ebay") {
      return errorResponse("NOT_FOUND", `Product not found for provider '${internalProvider}'.`);
    }

    console.log(`[DETAIL_DB] correlationId=${correlationId} miss, fetching_live...`);

    // ========== FALLBACK: Legacy catalog_products (Rainforest only) ==========
    if (internalProvider === "rainforest") {
      const { data: legacyItem } = await db
        .from("catalog_products")
        .select("*")
        .eq("provider_product_id", productId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (legacyItem) {
        const rawData = legacyItem.raw as Record<string, any> | null;
        let rawImages: string[] = [];
        
        if (rawData?.processedImages && Array.isArray(rawData.processedImages)) {
          rawImages = rawData.processedImages;
        } else if (rawData?.images && Array.isArray(rawData.images)) {
          rawImages = rawData.images
            .map((i: any) => i?.large || i?.link || (typeof i === "string" ? i : null))
            .filter((url: any): url is string => !!url && url.startsWith("http"));
        }
        
        if (legacyItem.image_url && !rawImages.includes(legacyItem.image_url)) {
          rawImages.unshift(legacyItem.image_url);
        }
        
        const images = upgradeGalleryImages(rawImages, "rainforest");
        const mainImage = images[0] || null;

        const item: CatalogItem = {
          id: fullProductId,
          provider: "rainforest",
          providerProductId: legacyItem.provider_product_id,
          title: legacyItem.title || "",
          priceUsd: legacyItem.price_usd > 0 ? legacyItem.price_usd : null,
          mainImageUrl: mainImage,
          imageUrl: mainImage,
          imageUrls: images,
          images,
          productUrl: legacyItem.product_url || null,
          inStock: legacyItem.in_stock ?? null,
          rating: legacyItem.rating || null,
          description: legacyItem.description || null,
          brand: legacyItem.brand || null,
        };

        // Check variants cache before returning legacy data
        const legacyCachedVariants = await getCachedVariants();
        if (legacyCachedVariants) {
          item.variants = legacyCachedVariants;
          console.log(JSON.stringify({ event: "DETAIL_RESPONSE", correlationId, provider: "amazon", id: productId, dbHit: false, dbLegacyHit: true, variantsCacheHit: true, liveFetch: false, variantsCount: legacyCachedVariants.length, totalMs: Date.now() - startTime }));
          const pricedLegacyItem = applyAllInclusivePriceToItem(item);
          return new Response(JSON.stringify({
            ok: true, status: "success", env: envName, id: fullProductId,
            item: pricedLegacyItem, product: pricedLegacyItem, source: "db-legacy", cached: true, error: null,
          }), {
            status: 200,
            headers: buildDiagHeaders({ variantsCache: "HIT", provider: "amazon", upstreamMs: 0, totalMs: Date.now() - startTime, source: "db-legacy+variants_cache" }),
          });
        }

        // NO return here -- fall through to live Rainforest fetch to get variants
        console.log(`[DETAIL_DB] correlationId=${correlationId} legacy hit but no variants cached, falling through to live fetch`);
      }
    }

    // ========== LIVE FETCH: eBay ==========
    if (internalProvider === "ebay") {
      try {
        // Pass db client (has .from() compatible interface)
        const ebayResult = await getEbayItem(db, productId!);
        
        if (!ebayResult.item) {
          console.log(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} ebay NOT_FOUND`);
          return errorResponse("NOT_FOUND", "Product not found on eBay");
        }
        
        const ebayItem = ebayResult.item;
        
        const blockCheck = isDisallowedItem({
          title: ebayItem.title,
          productUrl: ebayItem.productUrl,
        });
        
        if (blockCheck.isDisallowed) {
          return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
        }
        
        const rawImages = ebayItem.images || [];
        if (ebayItem.imageUrl && !rawImages.includes(ebayItem.imageUrl)) {
          rawImages.unshift(ebayItem.imageUrl);
        }
        const allImages = upgradeGalleryImages(rawImages, "ebay");
        const mainImage = allImages[0] || sanitizeImageUrl(ebayItem.imageUrl) || null;

        // Cache to catalog_items using provider+provider_product_id constraint
        const toCache = {
          provider: "ebay",
          provider_product_id: ebayItem.providerProductId,
          title: ebayItem.title,
          price_usd: ebayItem.priceUsd,
          image_url: mainImage,
          images: allImages,
          product_url: ebayItem.productUrl,
          in_stock: ebayItem.inStock,
          rating: null,
          category_key: "uncategorized",
          tags: [],
          updated_at: new Date().toISOString(),
        };
        
        await db.from("catalog_items").upsert(toCache, { onConflict: "provider,provider_product_id" });
        
        const item: CatalogItem = {
          id: fullProductId,
          provider: "ebay",
          providerProductId: ebayItem.providerProductId,
          title: ebayItem.title || "",
          priceUsd: ebayItem.priceUsd,
          mainImageUrl: mainImage,
          imageUrl: mainImage,
          imageUrls: allImages,
          images: allImages,
          productUrl: ebayItem.productUrl || null,
          inStock: ebayItem.inStock ?? null,
          rating: null,
          description: ebayItem.description || null,
          condition: ebayItem.attributes?.["Condition"],
          attributes: ebayItem.attributes,
          variants: ebayItem.variants,
        };
        
        // Cache variants if present
        if (item.variants && item.variants.length > 0) {
          await cacheVariants(item.variants);
        }

        console.log(JSON.stringify({ event: "DETAIL_RESPONSE", correlationId, provider: "ebay", id: productId, dbHit: false, variantsCacheHit: false, liveFetch: true, variantsCount: item.variants?.length ?? 0, totalMs: Date.now() - startTime }));
        
        const pricedEbayItem = applyAllInclusivePriceToItem(item);
        return new Response(JSON.stringify({
          ok: true,
          status: "success",
          env: envName,
          id: fullProductId,
          item: pricedEbayItem,
          product: pricedEbayItem,
          source: "live",
          cached: false,
          error: null,
        }), {
          status: 200,
          headers: buildDiagHeaders({ variantsCache: "MISS", provider: "ebay", upstreamMs: Date.now() - startTime, totalMs: Date.now() - startTime, source: "live-ebay" }),
        });
        
      } catch (err) {
        console.error(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} ebay error=${err}`);
        return errorResponse("PROVIDER_ERROR", "eBay service error");
      }
    }
    
    // ========== OFFLINE-ONLY: No live Rainforest calls from users ==========
    console.log(`[CATALOG_PRODUCT] Amazon product ${productId} not in DB — no live fetch (offline-only)`);
    
    // Enqueue for background ingestion (fire-and-forget)
    db.from("amazon_ingest_queue")
      .upsert({
        query: `asin:${productId}`,
        category_key: null,
        reason: "product_cache_miss",
        priority: 1,
        status: "queued",
        updated_at: new Date().toISOString(),
      }, { onConflict: "query", ignoreDuplicates: true })
      .then(() => {});

    return errorResponse("NOT_FOUND", "Product not available yet. It may appear after our next catalog refresh.");


  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_PRODUCT][ERROR] correlationId=${correlationId} error=${errorMessage} ms=${Date.now() - startTime}`);
    return errorResponse("INTERNAL_ERROR", "Product service error");
  }
});
