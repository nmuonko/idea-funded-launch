import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { isBlockedImageUrl } from "../_shared/imageValidation.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============== AMAZON-SPECIFIC MOBILE SCRAPING ==============
// Amazon treats mobile requests differently - less aggressive bot detection

const AMAZON_MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

/**
 * Convert Amazon desktop URL to mobile URL for better scraping success
 */
function getAmazonMobileUrl(url: string): string {
  return url.replace('www.amazon.com', 'm.amazon.com')
            .replace('amazon.com', 'm.amazon.com');
}

/**
 * Extract Amazon product image from various embedded JSON patterns
 */
function extractAmazonImageFromJson(html: string): string | null {
  // Try colorImages JSON - contains all product image variants
  const colorImagesMatch = html.match(/'colorImages'\s*:\s*\{[^}]*'initial'\s*:\s*\[([^\]]+)\]/i) ||
                           html.match(/"colorImages"\s*:\s*\{[^}]*"initial"\s*:\s*\[([^\]]+)\]/i);
  if (colorImagesMatch) {
    // Extract hiRes or large image URL from the JSON array
    const hiResMatch = colorImagesMatch[1].match(/"hiRes"\s*:\s*"([^"]+)"/i) ||
                       colorImagesMatch[1].match(/"large"\s*:\s*"([^"]+)"/i);
    if (hiResMatch && hiResMatch[1] && !isBlockedImageUrl(hiResMatch[1])) {
      console.log('[AMAZON_IMAGE] Found colorImages hiRes/large');
      return hiResMatch[1];
    }
  }
  
  // Try imageGalleryData
  const galleryMatch = html.match(/"imageGalleryData"\s*:\s*\[([^\]]+)\]/i);
  if (galleryMatch) {
    const mainUrlMatch = galleryMatch[1].match(/"mainUrl"\s*:\s*"([^"]+)"/i);
    if (mainUrlMatch && mainUrlMatch[1] && !isBlockedImageUrl(mainUrlMatch[1])) {
      console.log('[AMAZON_IMAGE] Found imageGalleryData mainUrl');
      return mainUrlMatch[1];
    }
  }
  
  // Try standalone hiRes pattern
  const hiResPattern = html.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+\.(?:jpg|png|webp)[^"]*)"/i);
  if (hiResPattern && hiResPattern[1] && !isBlockedImageUrl(hiResPattern[1])) {
    console.log('[AMAZON_IMAGE] Found standalone hiRes');
    return hiResPattern[1];
  }
  
  // Try mainImage pattern
  const mainImagePattern = html.match(/"mainImage"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i);
  if (mainImagePattern && mainImagePattern[1] && !isBlockedImageUrl(mainImagePattern[1])) {
    console.log('[AMAZON_IMAGE] Found mainImage url');
    return mainImagePattern[1];
  }
  
  return null;
}

/**
 * Extract Amazon product title from various sources
 */
function extractAmazonTitle(html: string): string | null {
  // Try productTitle span (most reliable)
  const productTitleMatch = html.match(/<span[^>]*id=["']productTitle["'][^>]*>([^<]+)</i);
  if (productTitleMatch && productTitleMatch[1]) {
    const title = productTitleMatch[1].trim();
    if (title && title.toLowerCase() !== 'product') {
      console.log('[AMAZON_TITLE] Found productTitle span');
      return title;
    }
  }
  
  // Try title-text class
  const titleTextMatch = html.match(/<span[^>]*class=["'][^"']*title-text[^"']*["'][^>]*>([^<]+)</i);
  if (titleTextMatch && titleTextMatch[1]) {
    const title = titleTextMatch[1].trim();
    if (title && title.toLowerCase() !== 'product') {
      console.log('[AMAZON_TITLE] Found title-text class');
      return title;
    }
  }
  
  // Try a-size-large title class
  const largeTitleMatch = html.match(/<span[^>]*class=["'][^"']*a-size-large[^"']*product-title[^"']*["'][^>]*>([^<]+)</i);
  if (largeTitleMatch && largeTitleMatch[1]) {
    const title = largeTitleMatch[1].trim();
    if (title && title.toLowerCase() !== 'product') {
      console.log('[AMAZON_TITLE] Found a-size-large product-title');
      return title;
    }
  }
  
  // Try mobile title pattern
  const mobileTitleMatch = html.match(/<h1[^>]*class=["'][^"']*title["'][^>]*>([^<]+)</i);
  if (mobileTitleMatch && mobileTitleMatch[1]) {
    const title = mobileTitleMatch[1].trim();
    if (title && title.toLowerCase() !== 'product') {
      console.log('[AMAZON_TITLE] Found mobile h1 title');
      return title;
    }
  }
  
  return null;
}

// ============== STORE-SPECIFIC EXTRACTORS ==============

/**
 * Extract eBay product image from various sources
 */
function extractEbayImage(html: string): string | null {
  // eBay uses imgTagWrapper for main product images
  const imgWrapperMatch = html.match(/<div[^>]*id=["']imgTagWrapperId["'][^>]*>.*?<img[^>]*src=["']([^"']+)["']/is);
  if (imgWrapperMatch && imgWrapperMatch[1]) {
    console.log('[EBAY_IMAGE] Found imgTagWrapper image');
    return imgWrapperMatch[1];
  }
  
  // Try icImg (classic eBay image id)
  const icImgMatch = html.match(/<img[^>]*id=["']icImg["'][^>]*src=["']([^"']+)["']/i);
  if (icImgMatch && icImgMatch[1]) {
    console.log('[EBAY_IMAGE] Found icImg');
    return icImgMatch[1];
  }
  
  // Try ux-image-carousel
  const carouselMatch = html.match(/<img[^>]*class=["'][^"']*ux-image-carousel[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (carouselMatch && carouselMatch[1]) {
    console.log('[EBAY_IMAGE] Found ux-image-carousel');
    return carouselMatch[1];
  }
  
  return null;
}

/**
 * Extract Walmart product image
 */
function extractWalmartImage(html: string): string | null {
  // Walmart embeds image data in window.__NEXT_DATA__ or hero-image
  const heroMatch = html.match(/<img[^>]*data-testid=["']hero-image["'][^>]*src=["']([^"']+)["']/i);
  if (heroMatch && heroMatch[1]) {
    console.log('[WALMART_IMAGE] Found hero-image');
    return heroMatch[1];
  }
  
  // Try product-image class
  const productImgMatch = html.match(/<img[^>]*class=["'][^"']*product-image[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (productImgMatch && productImgMatch[1]) {
    console.log('[WALMART_IMAGE] Found product-image class');
    return productImgMatch[1];
  }
  
  // Try hover-zoom-hero-image
  const zoomMatch = html.match(/<img[^>]*class=["'][^"']*hover-zoom-hero-image[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (zoomMatch && zoomMatch[1]) {
    console.log('[WALMART_IMAGE] Found hover-zoom-hero-image');
    return zoomMatch[1];
  }
  
  return null;
}

/**
 * Extract Target product image
 */
function extractTargetImage(html: string): string | null {
  // Target uses data-test="product-image"
  const productImgMatch = html.match(/<img[^>]*data-test=["']product-image["'][^>]*src=["']([^"']+)["']/i);
  if (productImgMatch && productImgMatch[1]) {
    console.log('[TARGET_IMAGE] Found product-image');
    return productImgMatch[1];
  }
  
  // Try ProductImagesCarousel
  const carouselMatch = html.match(/<img[^>]*class=["'][^"']*ProductImagesCarousel[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (carouselMatch && carouselMatch[1]) {
    console.log('[TARGET_IMAGE] Found ProductImagesCarousel');
    return carouselMatch[1];
  }
  
  return null;
}

/**
 * Extract SHEIN product image
 */
function extractSheinImage(html: string): string | null {
  // SHEIN uses crop-image-container
  const cropMatch = html.match(/<img[^>]*class=["'][^"']*crop-image-container[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (cropMatch && cropMatch[1]) {
    console.log('[SHEIN_IMAGE] Found crop-image-container');
    return cropMatch[1];
  }
  
  // Try lazyload with data-src
  const lazyMatch = html.match(/<img[^>]*class=["'][^"']*lazyload[^"']*["'][^>]*data-src=["']([^"']+)["']/i);
  if (lazyMatch && lazyMatch[1]) {
    console.log('[SHEIN_IMAGE] Found lazyload data-src');
    return lazyMatch[1];
  }
  
  // Try goods-img
  const goodsMatch = html.match(/<img[^>]*class=["'][^"']*goods-img[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (goodsMatch && goodsMatch[1]) {
    console.log('[SHEIN_IMAGE] Found goods-img');
    return goodsMatch[1];
  }
  
  return null;
}

/**
 * Scrape Amazon product via Firecrawl as a premium fallback
 */
async function scrapeAmazonViaFirecrawl(url: string): Promise<{ imageUrl: string | null; title: string | null }> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlApiKey) {
    console.log('[FIRECRAWL] No API key configured, skipping');
    return { imageUrl: null, title: null };
  }
  
  try {
    console.log('[FIRECRAWL] Attempting Amazon scrape for:', url.substring(0, 60));
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown', 'html'],
          onlyMainContent: true,
          waitFor: 2000, // Wait for dynamic content
        }),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        console.log('[FIRECRAWL] Request failed:', response.status);
        return { imageUrl: null, title: null };
      }
      
      const data = await response.json();
      
      if (!data.success) {
        console.log('[FIRECRAWL] Scrape unsuccessful:', data.error);
        return { imageUrl: null, title: null };
      }
      
      const html = data.data?.html || '';
      const metadata = data.data?.metadata || {};
      
      // Try to extract image from the scraped HTML
      let imageUrl = extractAmazonImageFromJson(html);
      if (!imageUrl) {
        // Try og:image from metadata
        imageUrl = metadata.ogImage || null;
        if (imageUrl && isBlockedImageUrl(imageUrl)) {
          imageUrl = null;
        }
      }
      
      // Try to extract title
      let title = extractAmazonTitle(html) || metadata.title || null;
      if (title && (title.toLowerCase() === 'product' || title.toLowerCase().includes('amazon.com'))) {
        title = null;
      }
      
      console.log('[FIRECRAWL] Result:', { hasImage: !!imageUrl, hasTitle: !!title });
      return { imageUrl, title };
      
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('[FIRECRAWL] Request timed out');
    } else {
      console.warn('[FIRECRAWL] Error:', err.message);
    }
    return { imageUrl: null, title: null };
  }
}

// Allowed domains for SSRF prevention
const ALLOWED_DOMAINS = [
  'amazon.com', 'www.amazon.com', 'm.amazon.com',  // Added mobile Amazon
  'ebay.com', 'www.ebay.com',
  'walmart.com', 'www.walmart.com',
  'bestbuy.com', 'www.bestbuy.com',
  // Car marketplaces (deprecated - kept for historical compatibility)
  'carvana.com', 'www.carvana.com',
  'cargurus.com', 'www.cargurus.com',
  // NEW: Active car marketplaces
  'tesla.com', 'www.tesla.com',
  'edmunds.com', 'www.edmunds.com',
  // Other retailers
  'target.com', 'www.target.com',
  'homedepot.com', 'www.homedepot.com',
  'shein.com', 'www.shein.com', 'us.shein.com', 'm.shein.com',
  'macys.com', 'www.macys.com', 'm.macys.com',
  // Mercari and Wayfair
  'mercari.com', 'www.mercari.com',
  'wayfair.com', 'www.wayfair.com',
];

// Block private/internal IP ranges
function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
    
    const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Pattern);
    if (match) {
      const [, a, b] = match.map(Number);
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
    }
    
    return false;
  } catch {
    return true;
  }
}

// ============== BOT DETECTION ==============
const BOT_DETECTION_PATTERNS = [
  /robot\s+or\s+human/i,
  /captcha/i,
  /verify\s+you\s+are\s+human/i,
  /access\s+denied/i,
  /please\s+verify/i,
  /security\s+check/i,
  /cloudflare.*challenge/i,
  /blocked/i,
  /not\s+a\s+robot/i,
  /are\s+you\s+a\s+human/i,
  /press\s+&\s+hold/i,
  /verification\s+required/i,
];

function detectBotBlock(html: string): boolean {
  const isShortPage = html.length < 10000;
  
  for (const pattern of BOT_DETECTION_PATTERNS) {
    if (pattern.test(html)) {
      console.log('[get-product-info] Bot detection triggered:', pattern.source);
      return true;
    }
  }
  
  // Check for title containing bot detection hints
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].toLowerCase();
    if (title.includes('robot') || title.includes('human') || 
        title.includes('captcha') || title.includes('verify') ||
        title.includes('blocked') || title.includes('access denied')) {
      console.log('[get-product-info] Bot detection triggered in title:', title.substring(0, 50));
      return true;
    }
  }
  
  // If page is very short, it's likely a challenge page
  if (isShortPage && !html.includes('"price"') && !html.includes('product')) {
    console.log('[get-product-info] Suspiciously short page, likely bot challenge');
    return true;
  }
  
  return false;
}

// Input validation schema
const productInfoSchema = z.object({
  productUrl: z.string()
    .min(1, "Product URL is required")
    .max(2048, "URL too long")
    .url("Invalid URL format")
    .refine((url) => !isPrivateUrl(url), "Internal URLs are not allowed")
    .refine((url) => {
      try {
        const parsed = new URL(url);
        return ALLOWED_DOMAINS.some(d => parsed.hostname.endsWith(d));
      } catch {
        return false;
      }
    }, "URL must be from a supported retailer"),
});

interface ProductInfo {
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  source: 'api' | 'jsonld' | 'json' | 'selectors' | 'cached' | 'unknown' | 'bot_blocked';
}

// Performance constants
const MAX_BODY_SIZE = 500 * 1024; // 500KB max response body (reduced from 2MB)

// Per-store timeout configuration (ms) - TIGHTENED for faster fail
// Frontend timeout is ~5-8s, backend must fail within 3-4s
const STORE_TIMEOUTS: Record<string, number> = {
  'shein.com': 3000,      // SHEIN is problematic - fail VERY fast
  'us.shein.com': 3000,
  'm.shein.com': 3000,
  'aliexpress.com': 3000, // AliExpress often hangs
  'macys.com': 4000,      // Macy's can be slow
  'target.com': 4000,
  'homedepot.com': 4000,
  'default': 4000,        // Default 4s timeout (was 8s)
};

function getStoreTimeout(domain: string): number {
  return STORE_TIMEOUTS[domain] || STORE_TIMEOUTS['default'];
}

// Domain-specific price selectors
const PRICE_SELECTORS: Record<string, string[]> = {
  'amazon.com': [
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price-whole',
  ],
  'walmart.com': [
    '[itemprop="price"]',
    '.price-characteristic',
    '[data-testid="price-wrap"]',
    'span[data-automation="buybox-price"]',
  ],
  'bestbuy.com': [
    '.priceView-customer-price',
    '.priceView-hero-price',
  ],
  'ebay.com': [
    '.x-price-primary',
    '[itemprop="price"]',
  ],
  'target.com': [
    '[data-test="product-price"]',
    '.styles__CurrentPriceFontSize',
  ],
  // FIXED: SHEIN 2024 - prices are ALWAYS USD
  'shein.com': [
    '.product-intro__head-mainprice span',
    '.sui-product-price__sale-price',
    '.sui-product-price__sale',
    '.product-intro__head-price span',
    '.from.original',
    '[data-price-type="salePrice"]',
    '[data-price-type="retailPrice"]',
    '.goods-price__sale-price',
    '.S-product-item__price-current',
    '.original-price',
    '.price-wrapper span',
  ],
  'us.shein.com': [
    '.product-intro__head-mainprice span',
    '.sui-product-price__sale-price',
    '.product-intro__head-price span',
    '.from.original',
  ],
  'm.shein.com': [
    '.product-intro__head-mainprice span',
    '.sui-product-price__sale-price',
    '.from.original',
  ],
  'macys.com': [
    '.price .regular-price',
    '.lowest-sale-price',
    '[data-auto="product-price"]',
  ],
  // FIXED: Edmunds 2024 - use JSON-LD primarily, these are fallback
  'edmunds.com': [
    '[data-testid="vdp-price"]',
    '[data-testid="price"]',
    '.price-value',
    '.vehicle-price',
    '.listing-price',
    '.srp-list-item-price',
    '.size-20',
    '.heading-3',
    '.text-primary-darker',
  ],
};

// Stores that commonly require WebView fallback
const DYNAMIC_CONTENT_DOMAINS = ['shein.com', 'us.shein.com', 'm.shein.com', 'aliexpress.com'];

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

/**
 * Normalize and validate a raw price candidate.
 * Handles scientific notation, currency symbols, localized formats, and validates ranges.
 * Returns a clean number with max 2 decimals, or null if invalid.
 */
function normalizePriceCandidate(raw: any): number | null {
  if (raw === null || raw === undefined) return null;

  let s = String(raw).trim();
  if (!s) return null;

  // Handle scientific notation strings like "4.48888493938737466e+2"
  if (/e[+-]?\d+/i.test(s)) {
    const n = Number(s);
    if (!isFinite(n)) {
      console.warn('[PRICE_DETECT] Rejected scientific notation (non-finite):', { raw: s });
      return null;
    }
    // Continue to validate the parsed number below
    s = String(n);
  }

  // Remove currency symbols and non-numeric chars except digits, dots, commas, minus
  // Handle: "$348.00", "US$ 1.299,99", "€45,99", "£100.00"
  s = s.replace(/[^\d.,-]/g, '');

  // Handle European format with comma as decimal separator
  // If both comma and dot exist: assume comma is thousands separator, dot is decimal
  // e.g., "1,299.99" -> "1299.99"
  if (s.includes('.') && s.includes(',')) {
    // Find last occurrence - the later one is likely the decimal separator
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    
    if (lastComma > lastDot) {
      // European format: "1.299,99" -> "1299.99"
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: "1,299.99" -> "1299.99"
      s = s.replace(/,/g, '');
    }
  } else if (!s.includes('.') && s.includes(',')) {
    // "1299,99" -> "1299.99" OR "1,299" (thousands) -> "1299"
    // If comma position suggests it's thousands separator (3 digits after): remove it
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length === 3) {
      // Likely thousands: "1,299" -> "1299"
      s = s.replace(',', '');
    } else {
      // Likely decimal: "1299,99" -> "1299.99"
      s = s.replace(',', '.');
    }
  }

  const n = parseFloat(s);
  if (!isFinite(n)) {
    console.warn('[PRICE_DETECT] Rejected (non-finite after parse):', { raw, parsed: s });
    return null;
  }

  // Sanity filters: reject obviously wrong numbers
  if (n <= 0) {
    console.warn('[PRICE_DETECT] Rejected (zero or negative):', { raw, parsed: n });
    return null;
  }
  if (n < 0.01) {
    console.warn('[PRICE_DETECT] Rejected (too small, < $0.01):', { raw, parsed: n });
    return null;
  }
  if (n > 100000) {
    console.warn('[PRICE_DETECT] Rejected (too large, > $100,000):', { raw, parsed: n });
    return null;
  }

  // Round to 2 decimals
  const rounded = Math.round(n * 100) / 100;

  if (rounded <= 0) return null;

  return rounded;
}

/**
 * Legacy parsePrice for backward compatibility - now uses normalizePriceCandidate
 */
function parsePrice(priceStr: string): number | null {
  return normalizePriceCandidate(priceStr);
}

/**
 * Select the best price from multiple candidates.
 * Prefers reasonable prices over edge cases.
 */
function selectBestPrice(candidates: (number | null)[]): number | null {
  const validPrices = candidates
    .map(c => normalizePriceCandidate(c))
    .filter((p): p is number => p !== null && p > 0);

  if (validPrices.length === 0) return null;
  if (validPrices.length === 1) return validPrices[0];

  // If multiple candidates, prefer:
  // 1. Prices >= $1 (exclude shipping/tax fragments)
  // 2. The lowest reasonable price (likely the product price, not shipping)
  const reasonablePrices = validPrices.filter(p => p >= 1);
  
  if (reasonablePrices.length > 0) {
    // Return lowest reasonable price
    return Math.min(...reasonablePrices);
  }

  // Fallback to first valid price
  return validPrices[0];
}

// HOT CACHE TTL (minutes) - very short for fast repeat access
const HOT_CACHE_TTL_MINUTES: Record<string, number> = {
  'shein.com': 5,
  'us.shein.com': 5,
  'm.shein.com': 5,
  'aliexpress.com': 5,
  'ebay.com': 5,
  'amazon.com': 15,
  'walmart.com': 15,
  'bestbuy.com': 15,
  'target.com': 15,
  'macys.com': 15,
  'homedepot.com': 20,
  'carvana.com': 30,
  'cargurus.com': 30,
  'tesla.com': 30,
  'edmunds.com': 30,
  'default': 10,
};

function getHotCacheTtl(domain: string): number {
  return HOT_CACHE_TTL_MINUTES[domain] || HOT_CACHE_TTL_MINUTES['default'];
}

// Check HOT CACHE first (5-15 min TTL)
async function checkHotCache(supabase: any, url: string): Promise<ProductInfo | null> {
  try {
    const { data, error } = await supabase
      .from('product_hot_cache')
      .select('response_json, hit_count')
      .eq('url', url)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;

    console.log('[get-product-info] HOT cache hit for:', url);
    
    // Update hit count (non-blocking)
    supabase
      .from('product_hot_cache')
      .update({ hit_count: (data.hit_count || 1) + 1 })
      .eq('url', url)
      .then(() => {})
      .catch(() => {});

    const response = data.response_json;
    return {
      title: response.title,
      imageUrl: response.imageUrl,
      price: response.price ? Number(response.price) : null,
      currency: response.currency || 'USD',
      source: 'cached',
    };
  } catch {
    return null;
  }
}

// Save to HOT CACHE (5-15 min TTL)
async function saveToHotCache(supabase: any, url: string, info: ProductInfo, domain: string) {
  try {
    const ttlMinutes = getHotCacheTtl(domain);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

    await supabase
      .from('product_hot_cache')
      .upsert({
        url,
        store: domain,
        response_json: {
          title: info.title,
          imageUrl: info.imageUrl,
          price: info.price,
          currency: info.currency,
          source: info.source,
        },
        expires_at: expiresAt.toISOString(),
        hit_count: 1,
      }, { onConflict: 'url' });

    console.log('[get-product-info] Saved to HOT cache:', url);
  } catch (err: any) {
    console.warn('[get-product-info] Hot cache save failed:', err.message);
  }
}

// Check STANDARD CACHE (hours TTL)
async function checkCache(supabase: any, url: string): Promise<ProductInfo | null> {
  const { data, error } = await supabase
    .from('product_cache')
    .select('*')
    .eq('product_url', url)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  console.log('[get-product-info] STANDARD cache hit for:', url);
  
  // Normalize cached price to ensure it's clean
  const cachedPrice = data.price ? normalizePriceCandidate(data.price) : null;
  
  return {
    title: data.title,
    imageUrl: data.image_url,
    price: cachedPrice,
    currency: data.currency || 'USD',
    source: 'cached',
  };
}

async function saveToCache(supabase: any, url: string, info: ProductInfo, domain: string) {
  // Use domain-specific TTL for standard cache
  const ttlHours: Record<string, number> = {
    'shein.com': 4,
    'us.shein.com': 4,
    'm.shein.com': 4,
    'aliexpress.com': 4,
    'ebay.com': 6,
    'amazon.com': 12,
    'walmart.com': 12,
    'bestbuy.com': 12,
    'default': 8,
  };
  
  const hours = ttlHours[domain] || ttlHours['default'];
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + hours);

  await supabase
    .from('product_cache')
    .upsert({
      product_url: url,
      title: info.title,
      image_url: info.imageUrl,
      price: info.price,
      currency: info.currency,
      source: info.source,
      store: domain,
      expires_at: expiresAt.toISOString(),
    }, { onConflict: 'product_url' });

  console.log('[get-product-info] Saved to STANDARD cache:', url);
}

function extractFromJsonLd(html: string): Partial<ProductInfo> {
  const result: Partial<ProductInfo> = {};
  const jsonLdRegex = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      const products = Array.isArray(json) ? json : [json];

      for (const item of products) {
        if (item['@type'] === 'Product' || item['@type']?.includes('Product')) {
          if (item.name && !result.title) result.title = item.name;
          if (item.image && !result.imageUrl) {
            result.imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
          }
          
          // Check offers
          const offers = item.offers || item.Offers;
          if (offers) {
            const offer = Array.isArray(offers) ? offers[0] : offers;
            if (offer.price && !result.price) {
              result.price = parsePrice(String(offer.price));
              result.currency = offer.priceCurrency || 'USD';
            }
          }
        }
      }
    } catch (e) {
      // Skip invalid JSON-LD
    }
  }

  return result;
}

function extractFromEmbeddedJson(html: string): Partial<ProductInfo> {
  const result: Partial<ProductInfo> = {};

  // Try Next.js __NEXT_DATA__
  const nextDataRegex = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
  const nextMatch = html.match(nextDataRegex);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      // Navigate through common Next.js structures
      const props = data?.props?.pageProps?.product;
      if (props) {
        if (props.name) result.title = props.name;
        if (props.image) result.imageUrl = props.image;
        if (props.price) result.price = parsePrice(String(props.price));
      }
    } catch (e) {
      // Skip
    }
  }

  // Try window.__APP_STATE__ or similar
  const appStateRegex = /window\.__APP_STATE__\s*=\s*({.*?});/s;
  const appMatch = html.match(appStateRegex);
  if (appMatch) {
    try {
      const data = JSON.parse(appMatch[1]);
      // This varies by site, but attempt common paths
      if (data.product) {
        if (data.product.title) result.title = data.product.title;
        if (data.product.imageUrl) result.imageUrl = data.product.imageUrl;
        if (data.product.price) result.price = parsePrice(String(data.product.price));
      }
    } catch (e) {
      // Skip
    }
  }

  return result;
}

// Extract image URL with priority: domain-specific selectors > og:image > twitter:image
// CRITICAL: For Amazon and other sites, prioritize product-specific selectors BEFORE og:image
// because og:image often returns generic site logos instead of product images
function extractImageUrl(html: string, domain: string): string | null {
  // Domain-specific image selectors - CHECK FIRST for sites with unreliable og:image
  const domainImageSelectors: Record<string, RegExp[]> = {
    'amazon.com': [
      // Amazon product images - these are the actual product photos
      /<img[^>]*id=["']landingImage["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*class=["'][^"']*a-dynamic-image[^"']*["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*data-old-hires=["']([^"']+)["']/i,
      /<img[^>]*data-a-dynamic-image=["']\{[^}]*"([^"]+)"/i,  // JSON format dynamic image
      // High-res product image from data attributes
      /<img[^>]*data-zoom-hires=["']([^"']+)["']/i,
    ],
    'walmart.com': [
      /<img[^>]*class=["'][^"']*product-image[^"']*["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*data-testid=["']hero-image["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*class=["'][^"']*hover-zoom-hero-image[^"']*["'][^>]*src=["']([^"']+)["']/i,
    ],
    'ebay.com': [
      /<img[^>]*id=["']icImg["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*class=["'][^"']*ux-image-magnify[^"']*["'][^>]*src=["']([^"']+)["']/i,
    ],
    'bestbuy.com': [
      /<img[^>]*class=["'][^"']*primary-image[^"']*["'][^>]*src=["']([^"']+)["']/i,
    ],
    'target.com': [
      /<img[^>]*class=["'][^"']*ProductImagesCarousel[^"']*["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*data-test=["']product-image["'][^>]*src=["']([^"']+)["']/i,
    ],
    'shein.com': [
      /<img[^>]*class=["'][^"']*crop-image-container[^"']*["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*class=["'][^"']*lazyload[^"']*["'][^>]*data-src=["']([^"']+)["']/i,
    ],
    'macys.com': [
      /<img[^>]*class=["'][^"']*primary-image[^"']*["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*id=["']mainImage["'][^>]*src=["']([^"']+)["']/i,
    ],
  };

  // 1. PRIORITY FOR SPECIFIC STORES: Try store-specific extractors FIRST
  // These stores often have unreliable og:image that returns logos instead of products
  
  // AMAZON: Try embedded JSON extraction first
  if (domain === 'amazon.com' || domain.includes('amazon')) {
    const jsonImage = extractAmazonImageFromJson(html);
    if (jsonImage) {
      console.log('[get-product-info] Found Amazon product image (JSON extraction)');
      return jsonImage;
    }
    
    // Fall back to DOM selectors
    const amazonSelectors = domainImageSelectors['amazon.com'] || [];
    for (const regex of amazonSelectors) {
      const match = html.match(regex);
      if (match && match[1] && !isBlockedImageUrl(match[1])) {
        console.log('[get-product-info] Found Amazon product image (DOM selector)');
        return match[1];
      }
    }
  }
  
  // EBAY: Try eBay-specific extractors
  if (domain === 'ebay.com' || domain.includes('ebay')) {
    const ebayImage = extractEbayImage(html);
    if (ebayImage && !isBlockedImageUrl(ebayImage)) {
      console.log('[get-product-info] Found eBay product image');
      return ebayImage;
    }
  }
  
  // WALMART: Try Walmart-specific extractors
  if (domain === 'walmart.com' || domain.includes('walmart')) {
    const walmartImage = extractWalmartImage(html);
    if (walmartImage && !isBlockedImageUrl(walmartImage)) {
      console.log('[get-product-info] Found Walmart product image');
      return walmartImage;
    }
  }
  
  // TARGET: Try Target-specific extractors
  if (domain === 'target.com' || domain.includes('target')) {
    const targetImage = extractTargetImage(html);
    if (targetImage && !isBlockedImageUrl(targetImage)) {
      console.log('[get-product-info] Found Target product image');
      return targetImage;
    }
  }
  
  // SHEIN: Try SHEIN-specific extractors
  if (domain.includes('shein')) {
    const sheinImage = extractSheinImage(html);
    if (sheinImage && !isBlockedImageUrl(sheinImage)) {
      console.log('[get-product-info] Found SHEIN product image');
      return sheinImage;
    }
  }

  // 2. Open Graph image - with blocklist check
  const ogImagePatterns = [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
    /<meta\s+name=["']og:image["']\s+content=["']([^"']+)["']/i,
  ];
  
  for (const pattern of ogImagePatterns) {
    const match = html.match(pattern);
    if (match && match[1] && !isBlockedImageUrl(match[1])) {
      console.log('[get-product-info] Found valid og:image');
      return match[1];
    } else if (match && match[1] && isBlockedImageUrl(match[1])) {
      console.log('[get-product-info] Rejected blocked og:image:', match[1].substring(0, 60));
    }
  }

  // 3. Twitter card image - with blocklist check
  const twitterImagePatterns = [
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i,
  ];
  
  for (const pattern of twitterImagePatterns) {
    const match = html.match(pattern);
    if (match && match[1] && !isBlockedImageUrl(match[1])) {
      console.log('[get-product-info] Found valid twitter:image');
      return match[1];
    }
  }

  // 4. Domain-specific selectors (for non-Amazon sites)
  const selectors = domainImageSelectors[domain] || [];
  for (const regex of selectors) {
    const match = html.match(regex);
    if (match && match[1] && !isBlockedImageUrl(match[1])) {
      console.log('[get-product-info] Found domain-specific image');
      return match[1];
    }
  }

  // 5. Generic product image patterns - with blocklist check
  const genericPatterns = [
    /<img[^>]*(?:id|class)=["'][^"']*(?:main|product|hero|primary)[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<img[^>]*src=["']([^"']+)["'][^>]*(?:id|class)=["'][^"']*(?:main|product|hero|primary)[^"']*["']/i,
  ];
  
  for (const pattern of genericPatterns) {
    const match = html.match(pattern);
    if (match && match[1] && !isBlockedImageUrl(match[1])) {
      console.log('[get-product-info] Found generic product image');
      return match[1];
    }
  }

  return null;
}

function extractFromSelectors(html: string, domain: string): Partial<ProductInfo> {
  const result: Partial<ProductInfo> = {};
  const selectors = PRICE_SELECTORS[domain] || [];
  const isAmazon = domain.includes('amazon');

  // Simple regex-based selector matching (not a full DOM parser)
  for (const selector of selectors) {
    // Convert CSS selector to regex pattern
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<[^>]*class="[^"]*${escapedSelector.replace('.', '')}[^"]*"[^>]*>([^<]+)<`, 'i');
    const match = html.match(regex);
    if (match && match[1]) {
      const price = parsePrice(match[1]);
      if (price) {
        result.price = price;
        break;
      }
    }
  }

  // Try to extract title - use Amazon-specific extraction for Amazon domains
  if (isAmazon) {
    const amazonTitle = extractAmazonTitle(html);
    if (amazonTitle) {
      result.title = amazonTitle;
    }
  }
  
  // Fall back to standard title extraction
  if (!result.title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      // Skip generic Amazon titles
      if (!isAmazon || (title.toLowerCase() !== 'amazon.com' && !title.toLowerCase().startsWith('amazon.com:'))) {
        result.title = title;
      }
    }
  }

  // Use enhanced image extraction
  const imageUrl = extractImageUrl(html, domain);
  if (imageUrl) {
    result.imageUrl = imageUrl;
  }

  return result;
}

/**
 * Extract OG-image and title via a proxy reader (fallback for blocked domains like Tesla)
 * This is a last-resort method when direct scraping fails with 403/bot detection
 */
async function extractOgImageViaProxy(url: string): Promise<{ imageUrl: string | null; title: string | null }> {
  try {
    // Use r.jina.ai as a simple reader/proxy that returns readable text content
    // It extracts and preserves metadata like og:image
    const proxyUrl = `https://r.jina.ai/${url}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    try {
      console.log('[get-product-info] Trying proxy OG extraction for:', url.substring(0, 80));
      const response = await fetch(proxyUrl, {
        headers: {
          'Accept': 'text/plain',
        },
        signal: controller.signal,
      });
      
      if (!response.ok) {
        console.log('[get-product-info] Proxy fetch failed:', response.status);
        return { imageUrl: null, title: null };
      }
      
      const text = await response.text();
      
      // r.jina.ai returns structured text with Title: and Image: prefixes
      const titleMatch = text.match(/Title:\s*(.+)/i);
      
      // Look for image URL patterns in the response
      // r.jina.ai typically includes image URLs in the text
      const imagePatterns = [
        /!\[.*?\]\((https?:\/\/[^\s)]+)\)/i, // Markdown image
        /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|webp|gif))/i, // Direct image URL
        /og:image[:\s]+["']?([^"'\s\n]+)/i, // og:image format
      ];
      
      let imageUrl: string | null = null;
      for (const pattern of imagePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          imageUrl = match[1];
          break;
        }
      }
      
      console.log('[get-product-info] Proxy extraction result:', { 
        hasImage: !!imageUrl, 
        hasTitle: !!titleMatch?.[1],
        textLength: text.length,
      });
      
      return {
        imageUrl,
        title: titleMatch?.[1]?.trim() || null,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('[get-product-info] Proxy OG extraction timed out');
    } else {
      console.warn('[get-product-info] Proxy OG extraction failed:', err.message);
    }
    return { imageUrl: null, title: null };
  }
}

async function scrapeProduct(url: string): Promise<ProductInfo> {
  const startTime = Date.now();
  console.log('[get-product-info] Scraping:', url);
  const domain = extractDomain(url);
  const timeout = getStoreTimeout(domain);
  const isAmazon = domain.includes('amazon');
  console.log('[get-product-info] Domain:', domain, '| Timeout:', timeout, 'ms', '| isAmazon:', isAmazon);

  // Enhanced browser-like headers for retry attempts
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  try {
    // Create AbortController for timeout enforcement
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('[get-product-info] TIMEOUT reached for:', url);
      controller.abort();
    }, timeout);

    let response: Response;
    let html: string = '';
    let fetchSucceeded = false;
    let wasBotBlocked = false;

    // AMAZON-SPECIFIC: Try mobile URL first with mobile headers
    if (isAmazon) {
      const mobileUrl = getAmazonMobileUrl(url);
      console.log('[AMAZON_SCRAPE] Trying mobile URL:', mobileUrl.substring(0, 80));
      
      try {
        const mobileController = new AbortController();
        const mobileTimeoutId = setTimeout(() => mobileController.abort(), 4000);
        
        try {
          const mobileResponse = await fetch(mobileUrl, {
            headers: AMAZON_MOBILE_HEADERS,
            signal: mobileController.signal,
          });
          
          if (mobileResponse.ok) {
            html = await mobileResponse.text();
            if (!detectBotBlock(html)) {
              fetchSucceeded = true;
              console.log('[AMAZON_SCRAPE] Mobile URL succeeded');
            } else {
              console.log('[AMAZON_SCRAPE] Mobile URL blocked');
              wasBotBlocked = true;
            }
          } else {
            console.log('[AMAZON_SCRAPE] Mobile URL failed:', mobileResponse.status);
          }
        } finally {
          clearTimeout(mobileTimeoutId);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.log('[AMAZON_SCRAPE] Mobile fetch error:', err.message);
        }
      }
    }

    // Standard fetch if not Amazon or Amazon mobile failed
    if (!fetchSucceeded) {
      try {
        response = await fetch(url, {
          headers: isAmazon ? AMAZON_MOBILE_HEADERS : {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          signal: controller.signal,
        });

        if (response.ok) {
          const contentLength = response.headers.get('content-length');
          if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
            console.warn('[get-product-info] Response too large:', contentLength, 'bytes');
            clearTimeout(timeoutId);
            return { title: null, imageUrl: null, price: null, currency: 'USD', source: 'unknown' };
          }

          html = await response.text();
          
          // Check for bot detection / captcha pages
          if (!detectBotBlock(html)) {
            fetchSucceeded = true;
          } else {
            console.log('[get-product-info] Bot detection on first attempt, will retry with enhanced headers');
            wasBotBlocked = true;
          }
        } else {
          console.log('[get-product-info] HTTP error on first attempt:', response.status);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // RETRY with enhanced browser-like headers if first attempt failed
    if (!fetchSucceeded) {
      console.log('[get-product-info] Retrying with enhanced browser headers...');
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), 3000);

      try {
        const retryResponse = await fetch(url, {
          headers: browserHeaders,
          signal: retryController.signal,
        });

        if (retryResponse.ok) {
          html = await retryResponse.text();
          
          if (!detectBotBlock(html)) {
            fetchSucceeded = true;
            console.log('[get-product-info] Enhanced headers succeeded');
          } else {
            wasBotBlocked = true;
            console.log('[get-product-info] Still blocked after retry');
          }
        } else {
          console.log('[get-product-info] Retry also failed:', retryResponse.status);
        }
      } catch (retryErr: any) {
        if (retryErr.name !== 'AbortError') {
          console.log('[get-product-info] Retry fetch error:', retryErr.message);
        }
      } finally {
        clearTimeout(retryTimeoutId);
      }
    }

    // AMAZON-SPECIFIC: Try Firecrawl as premium fallback
    if (isAmazon && (!fetchSucceeded || wasBotBlocked)) {
      console.log('[AMAZON_SCRAPE] Trying Firecrawl fallback...');
      const firecrawlResult = await scrapeAmazonViaFirecrawl(url);
      
      if (firecrawlResult.imageUrl || firecrawlResult.title) {
        console.log('[AMAZON_SCRAPE] Firecrawl succeeded:', { hasImage: !!firecrawlResult.imageUrl, hasTitle: !!firecrawlResult.title });
        return {
          title: firecrawlResult.title,
          imageUrl: firecrawlResult.imageUrl,
          price: null, // Price still requires WebView for Amazon
          currency: 'USD',
          source: 'bot_blocked', // Mark for WebView price extraction
        };
      }
    }

    // LAST RESORT: Try proxy OG-image extraction for blocked domains
    if (!fetchSucceeded || wasBotBlocked) {
      console.log('[get-product-info] Attempting proxy OG-image extraction as last resort');
      const proxyResult = await extractOgImageViaProxy(url);
      
      if (proxyResult.imageUrl || proxyResult.title) {
        console.log('[get-product-info] Proxy extraction succeeded:', { hasImage: !!proxyResult.imageUrl, hasTitle: !!proxyResult.title });
        return {
          title: proxyResult.title,
          imageUrl: proxyResult.imageUrl,
          price: null, // Price requires WebView - we only extract image/title via proxy
          currency: 'USD',
          source: 'bot_blocked', // Still mark as blocked for price
        };
      }
      
      // If all fallbacks failed, return bot_blocked
      if (!fetchSucceeded) {
        console.log('[get-product-info] All fallbacks failed | Duration:', Date.now() - startTime, 'ms');
        return { title: null, imageUrl: null, price: null, currency: 'USD', source: 'bot_blocked' };
      }
    }

    // If we got HTML but it's a bot block page, we've already tried proxy above
    if (wasBotBlocked && !fetchSucceeded) {
      return { title: null, imageUrl: null, price: null, currency: 'USD', source: 'bot_blocked' };
    }
    
    // Guard against oversized responses that didn't report content-length
    if (html.length > MAX_BODY_SIZE) {
      console.warn('[get-product-info] HTML body too large:', html.length, 'bytes. Truncating.');
    }
    
    // Collect ALL price candidates from different sources
    const priceCandidates: (number | null)[] = [];
    let result: Partial<ProductInfo> = {};

    // ALWAYS try to extract image first using og:image (highest priority)
    const ogImage = extractImageUrl(html, domain);
    if (ogImage) {
      result.imageUrl = ogImage;
      console.log('[get-product-info] Found image URL:', ogImage.substring(0, 100));
    }

    // 1. JSON-LD (most reliable for structured data)
    const jsonLdData = extractFromJsonLd(html);
    if (jsonLdData.title && !result.title) result.title = jsonLdData.title;
    if (jsonLdData.imageUrl && !result.imageUrl) result.imageUrl = jsonLdData.imageUrl;
    if (jsonLdData.price) {
      priceCandidates.push(jsonLdData.price);
      console.log('[get-product-info] JSON-LD price candidate:', jsonLdData.price);
    }
    if (jsonLdData.currency) result.currency = jsonLdData.currency;

    // 2. Embedded JSON
    const embeddedData = extractFromEmbeddedJson(html);
    if (embeddedData.title && !result.title) result.title = embeddedData.title;
    if (embeddedData.imageUrl && !result.imageUrl) result.imageUrl = embeddedData.imageUrl;
    if (embeddedData.price) {
      priceCandidates.push(embeddedData.price);
      console.log('[get-product-info] Embedded JSON price candidate:', embeddedData.price);
    }
    if (embeddedData.currency && !result.currency) result.currency = embeddedData.currency;

    // 3. CSS Selectors
    const selectorData = extractFromSelectors(html, domain);
    if (selectorData.title && !result.title) result.title = selectorData.title;
    if (selectorData.imageUrl && !result.imageUrl) result.imageUrl = selectorData.imageUrl;
    if (selectorData.price) {
      priceCandidates.push(selectorData.price);
      console.log('[get-product-info] Selector price candidate:', selectorData.price);
    }

    // Select the best price from all candidates
    const bestPrice = selectBestPrice(priceCandidates);
    const duration = Date.now() - startTime;
    
    if (bestPrice !== null) {
      console.log('[get-product-info] Selected best price:', bestPrice, '| Duration:', duration, 'ms');
      
      // Determine source based on which extraction found the winning price
      let source: ProductInfo['source'] = 'unknown';
      if (jsonLdData.price && normalizePriceCandidate(jsonLdData.price) === bestPrice) {
        source = 'jsonld';
      } else if (embeddedData.price && normalizePriceCandidate(embeddedData.price) === bestPrice) {
        source = 'json';
      } else if (selectorData.price && normalizePriceCandidate(selectorData.price) === bestPrice) {
        source = 'selectors';
      }

      // CRITICAL: Force USD currency for US retailers (SHEIN, Amazon, Walmart, etc.)
      // This prevents incorrect currency detection (e.g., CDF instead of USD)
      const forceUsdDomains = ['shein.com', 'us.shein.com', 'm.shein.com', 'amazon.com', 'walmart.com', 'bestbuy.com', 'target.com', 'homedepot.com', 'macys.com'];
      const finalCurrency = forceUsdDomains.some(d => domain.includes(d)) ? 'USD' : (result.currency || 'USD');

      return {
        title: result.title || null,
        imageUrl: result.imageUrl || null,
        price: bestPrice,
        currency: finalCurrency,
        source,
      };
    }

    console.log('[get-product-info] No valid price found | Duration:', duration, 'ms');
    return {
      title: result.title || null,
      imageUrl: result.imageUrl || null,
      price: null,
      currency: 'USD',
      source: 'unknown',
    };

  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    // Handle timeout (AbortError) specifically - fail fast
    if (error.name === 'AbortError') {
      console.log('[get-product-info] Request aborted (timeout) | Duration:', duration, 'ms');
      return {
        title: null,
        imageUrl: null,
        price: null,
        currency: 'USD',
        source: 'unknown',
      };
    }
    
    console.error('[get-product-info] Scraping error:', error.message, '| Duration:', duration, 'ms');
    return {
      title: null,
      imageUrl: null,
      price: null,
      currency: 'USD',
      source: 'unknown',
    };
  }
}

/**
 * Format price as display string with currency symbol
 */
function formatDisplayPrice(price: number, currency: string): string {
  const symbols: Record<string, string> = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'CAD': 'CA$',
    'AUD': 'AU$',
  };
  const symbol = symbols[currency] || '$';
  return `${symbol}${price.toFixed(2)}`;
}

serve(async (req) => {
  const requestStart = Date.now();
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json();

    // Accept both 'url' and 'productUrl' in request body
    const inputUrl = body.productUrl || body.url;
    
    if (!inputUrl) {
      const duration = Date.now() - requestStart;
      console.log(JSON.stringify({ endpoint: 'get-product-info', duration, status: 400, error: 'missing_url' }));
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'MISSING_URL',
          message: 'Product URL is required' 
        }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate input with zod schema (SSRF prevention)
    const parseResult = productInfoSchema.safeParse({ productUrl: inputUrl });
    if (!parseResult.success) {
      const errorMessage = (parseResult as any).error?.errors?.map((e: any) => e.message).join(', ') || 'Validation failed';
      const duration = Date.now() - requestStart;
      console.log(JSON.stringify({ endpoint: 'get-product-info', duration, status: 400, error: 'validation_failed' }));
      return new Response(
        JSON.stringify({ 
          ok: false,
          code: 'VALIDATION_ERROR', 
          message: errorMessage 
        }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { productUrl } = parseResult.data;
    const domain = extractDomain(productUrl);
    console.log('[get-product-info] Request for:', productUrl);

    // TWO-TIER CACHE CHECK
    // 1. Check HOT CACHE first (5-15 min TTL) - fastest
    const hotCached = await checkHotCache(supabaseClient, productUrl);
    if (hotCached) {
      const duration = Date.now() - requestStart;
      console.log(JSON.stringify({ endpoint: 'get-product-info', duration, status: 200, cached: true, cacheType: 'hot', domain }));
      return new Response(
        JSON.stringify({
          ok: true,
          basePrice: hotCached.price,
          currency: hotCached.currency,
          displayPrice: hotCached.price ? formatDisplayPrice(hotCached.price, hotCached.currency) : null,
          productTitle: hotCached.title,
          imageUrl: hotCached.imageUrl,
          sourceUrl: productUrl,
          cached: true,
          cacheType: 'hot',
        }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Check STANDARD CACHE (4-48 hour TTL)
    const cached = await checkCache(supabaseClient, productUrl);
    if (cached) {
      // Promote to hot cache for faster subsequent access
      saveToHotCache(supabaseClient, productUrl, cached, domain).catch(() => {});
      
      const duration = Date.now() - requestStart;
      console.log(JSON.stringify({ endpoint: 'get-product-info', duration, status: 200, cached: true, cacheType: 'standard', domain }));
      return new Response(
        JSON.stringify({
          ok: true,
          basePrice: cached.price,
          currency: cached.currency,
          displayPrice: cached.price ? formatDisplayPrice(cached.price, cached.currency) : null,
          productTitle: cached.title,
          imageUrl: cached.imageUrl,
          sourceUrl: productUrl,
          cached: true,
          cacheType: 'standard',
        }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Scrape product info with timeout protection
    const info = await scrapeProduct(productUrl);

    // Save to BOTH caches if we got any useful data
    if (info.price !== null || info.imageUrl !== null || info.title !== null) {
      // Save to hot cache (5-15 min) for fast repeat access
      saveToHotCache(supabaseClient, productUrl, info, domain).catch(err => {
        console.warn('[get-product-info] Hot cache save failed:', err.message);
      });
      
      // Save to standard cache (hours) for longer retention
      saveToCache(supabaseClient, productUrl, info, domain).catch(err => {
        console.warn('[get-product-info] Standard cache save failed:', err.message);
      });
    }

    const duration = Date.now() - requestStart;

    // Check if we got a price - return appropriate error with fallback hints
    if (info.price === null) {
      console.log(JSON.stringify({ endpoint: 'get-product-info', duration, status: 404, error: 'price_not_found', domain }));
      
      // Check if bot blocked or dynamic content store
      const isBotBlocked = info.source === 'bot_blocked';
      const isDynamicStore = DYNAMIC_CONTENT_DOMAINS.some(d => domain.includes(d));
      
      let errorCode = 'PRICE_NOT_FOUND';
      let message_en = 'Price not available';
      let message_fr = 'Prix indisponible';
      
      if (isBotBlocked) {
        errorCode = 'SCRAPE_BLOCKED';
        message_en = `${domain} is blocking automated access. Please open the page manually.`;
        message_fr = `${domain} bloque l'accès automatisé. Veuillez ouvrir la page manuellement.`;
      } else if (isDynamicStore) {
        errorCode = 'DYNAMIC_CONTENT';
        message_en = 'This page requires manual viewing.';
        message_fr = 'Cette page nécessite une consultation manuelle.';
      }
      
      return new Response(
        JSON.stringify({
          ok: false,
          code: errorCode,
          message: message_en,
          message_en,
          message_fr,
          productTitle: info.title,
          imageUrl: info.imageUrl,
          sourceUrl: productUrl,
          retryable: false,
          webviewFallback: true,
          suggestedFallback: 'WEBVIEW',
        }), 
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(JSON.stringify({ endpoint: 'get-product-info', duration, status: 200, domain, price: info.price }));
    
    // Return successful response
    return new Response(
      JSON.stringify({
        ok: true,
        basePrice: info.price,
        currency: info.currency,
        displayPrice: formatDisplayPrice(info.price, info.currency),
        productTitle: info.title,
        imageUrl: info.imageUrl,
        sourceUrl: productUrl,
      }), 
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - requestStart;
    console.log(JSON.stringify({ endpoint: 'get-product-info', duration, status: 500, error: error.message }));
    
    // Check if it's a network/connection error
    const isConnectionError = error.message?.includes('fetch') || 
                              error.message?.includes('network') ||
                              error.message?.includes('ECONNREFUSED');
    
    return new Response(
      JSON.stringify({ 
        ok: false,
        code: isConnectionError ? 'CONNECTION_ERROR' : 'INTERNAL_ERROR',
        message: isConnectionError ? 'Connection error' : 'Something went wrong',
        message_en: isConnectionError ? 'Connection error. Check your internet.' : 'Something went wrong.',
        message_fr: isConnectionError ? 'Erreur de connexion. Vérifiez votre connexion.' : 'Une erreur s\'est produite.',
        retryable: isConnectionError,
        webviewFallback: false,
      }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
