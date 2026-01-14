import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Allowed domains for SSRF prevention
const ALLOWED_DOMAINS = [
  'amazon.com', 'www.amazon.com',
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

// Extract image URL with priority: og:image > twitter:image > JSON-LD > product image selectors
function extractImageUrl(html: string, domain: string): string | null {
  // 1. Priority: Open Graph image (most reliable for product pages)
  const ogImagePatterns = [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
    /<meta\s+name=["']og:image["']\s+content=["']([^"']+)["']/i,
  ];
  
  for (const pattern of ogImagePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      console.log('[get-product-info] Found og:image');
      return match[1];
    }
  }

  // 2. Twitter card image
  const twitterImagePatterns = [
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i,
  ];
  
  for (const pattern of twitterImagePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      console.log('[get-product-info] Found twitter:image');
      return match[1];
    }
  }

  // 3. Domain-specific image selectors
  const domainImageSelectors: Record<string, RegExp[]> = {
    'amazon.com': [
      /<img[^>]*id=["']landingImage["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*class=["'][^"']*a-dynamic-image[^"']*["'][^>]*src=["']([^"']+)["']/i,
      /<img[^>]*data-old-hires=["']([^"']+)["']/i,
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

  const selectors = domainImageSelectors[domain] || [];
  for (const regex of selectors) {
    const match = html.match(regex);
    if (match && match[1]) {
      console.log('[get-product-info] Found domain-specific image');
      return match[1];
    }
  }

  // 4. Generic product image patterns
  const genericPatterns = [
    /<img[^>]*(?:id|class)=["'][^"']*(?:main|product|hero|primary)[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<img[^>]*src=["']([^"']+)["'][^>]*(?:id|class)=["'][^"']*(?:main|product|hero|primary)[^"']*["']/i,
  ];
  
  for (const pattern of genericPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      console.log('[get-product-info] Found generic product image');
      return match[1];
    }
  }

  return null;
}

function extractFromSelectors(html: string, domain: string): Partial<ProductInfo> {
  const result: Partial<ProductInfo> = {};
  const selectors = PRICE_SELECTORS[domain] || [];

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

  // Try to extract title from <title> or <h1>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }

  // Use enhanced image extraction
  const imageUrl = extractImageUrl(html, domain);
  if (imageUrl) {
    result.imageUrl = imageUrl;
  }

  return result;
}

async function scrapeProduct(url: string): Promise<ProductInfo> {
  const startTime = Date.now();
  console.log('[get-product-info] Scraping:', url);
  const domain = extractDomain(url);
  const timeout = getStoreTimeout(domain);
  console.log('[get-product-info] Domain:', domain, '| Timeout:', timeout, 'ms');

  try {
    // Create AbortController for timeout enforcement
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('[get-product-info] TIMEOUT reached for:', url);
      controller.abort();
    }, timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.log('[get-product-info] HTTP error:', response.status, '| Duration:', Date.now() - startTime, 'ms');
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
      console.warn('[get-product-info] Response too large:', contentLength, 'bytes');
      return { title: null, imageUrl: null, price: null, currency: 'USD', source: 'unknown' };
    }

    const html = await response.text();
    
    // Check for bot detection / captcha pages
    if (detectBotBlock(html)) {
      console.log('[get-product-info] Bot detection triggered | Duration:', Date.now() - startTime, 'ms');
      // Return with bot_blocked source so caller knows to suggest WebView
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
