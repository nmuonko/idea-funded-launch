import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  normalizeUrl,
  isAllowedDomain,
  isPrivateUrl,
  detectStore,
  getTtlForStore,
  getHotCacheTtlForStore,
  detectCurrency,
  cleanPriceString,
  formatDisplayPrice,
  getCurrencySymbol,
  type StoreType,
} from "../_shared/priceResolver.ts";
import {
  jsonSuccess,
  jsonError,
  handleCors,
  checkRateLimit,
  getClientIp,
  ErrorCodes,
  storeSuccess,
  storeError,
} from "../_shared/http.ts";

// ============== RESPONSE TYPES ==============

interface PriceResolveResponse {
  url: string;
  store: string | null;
  basePrice: number;
  currencySymbol: string;
  rawCurrencyCode: string;
  title: string | null;
  imageUrl: string | null;
  cacheHit: boolean;
  lastFetchedAt: string | null;
}

// ============== BOT DETECTION PATTERNS ==============
// If these patterns are found, the store is blocking us

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
  // Check for bot detection patterns regardless of page size
  // Also check if page is suspiciously short for a product page
  const isShortPage = html.length < 10000;
  
  for (const pattern of BOT_DETECTION_PATTERNS) {
    if (pattern.test(html)) {
      console.log('[extract-price] Bot detection triggered:', pattern.source);
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
      console.log('[extract-price] Bot detection triggered in title:', title.substring(0, 50));
      return true;
    }
  }
  
  // If page is very short, it's likely a challenge page
  if (isShortPage && !html.includes('"price"') && !html.includes('product')) {
    console.log('[extract-price] Suspiciously short page, likely bot challenge');
    return true;
  }
  
  return false;
}

// ============== STORE-SPECIFIC SELECTORS ==============

const STORE_SELECTORS: Record<StoreType, string[]> = {
  amazon: [
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#priceblock_saleprice',
    '#corePrice_feature_div .a-offscreen',
    '.a-price .a-offscreen',
    '#apex_offerDisplay_desktop .a-price .a-offscreen',
    '.priceToPay .a-offscreen',
    '#price_inside_buybox',
    '.a-price-whole',
    '[data-asin-price]',
    '.reinventPricePriceToPayMargin .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-offscreen',
  ],
  walmart: [
    '[itemprop="price"]',
    '.price-characteristic',
    '.prod-PriceHero .price-group',
    '[data-automation-id="product-price"]',
    '.price-main .visuallyhidden',
    '.price-main-block span',
    '[data-testid="price-wrap"] span',
    '.flex.items-baseline span.f1',
    '.w_Cs span',
  ],
  bestbuy: [
    '.priceView-hero-price span[aria-hidden="true"]',
    '.priceView-customer-price span',
    '[data-testid="customer-price"] span',
    '.pricing-price__regular-price',
  ],
  ebay: [
    '#prcIsum',
    '#mm-saleDscPrc',
    '.x-price-primary span',
    '.x-bin-price__content .ux-textspans',
    '[itemprop="price"]',
    '.vi-price',
  ],
  aliexpress: [
    '.product-price-value',
    '.uniform-banner-box-price',
    '.snow-price_SnowPrice__mainS__18x8np',
    '.es--wrap--erdmPRe .es--char--dIjqpKQ',
  ],
  target: [
    '[data-test="product-price"]',
    '.styles__CurrentPriceFontSize-sc',
    '[data-test="product-price"] span',
  ],
  // FIXED: SHEIN 2024 - prices are ALWAYS USD, NOT CDF
  // SHEIN uses dynamic JS rendering - mark for WebView fallback if scraping fails
  shein: [
    // JSON-LD is the most reliable for SHEIN
    // CSS selectors as fallback
    '.product-intro__head-mainprice span',
    '.sui-product-price__sale-price',
    '.sui-product-price__sale',
    '.product-intro__head-price span',
    '.from.original',
    '[data-price-type="salePrice"]',
    '[data-price-type="retailPrice"]',
    '.goods-price__sale-price',
    '.goods-price__current',
    '.S-product-item__price-current',
    '.j-expose__product-item-price',
    '.original-price',
    '.flash-sale-price',
    '.price-wrapper span',
    // New 2024 patterns
    '.ProductCard__Price span',
    '.product-price__sale span',
  ],
  macys: [
    '.price .lowest-sale-price',
    '.price-sales',
    '.priceWrapper .price',
  ],
  homedepot: [
    '.price-format__main-price',
    '.price span',
    '[data-price]',
  ],
  carvana: [
    '[data-testid="price"]',
    '.price-value',
    '.vehicle-price',
    '[class*="Price"]',
  ],
  cargurus: [
    '[data-testid="price"]',
    '.listing-price',
    '.price',
    '[class*="price"]',
  ],
  tesla_used: [
    '[data-testid="price"]',
    '.result-price',
    '.inventory-price',
    '.vehicle-price',
    '[class*="Price"]',
    '[class*="price"]',
    '.tds-text--medium',
  ],
  // FIXED: Edmunds 2024 - use JSON-LD structured data primarily
  edmunds: [
    // Primary: JSON-LD offers.price
    // Fallback selectors for listing pages
    '[data-testid="vdp-price"]',
    '[data-testid="price"]',
    '.price-value',
    '.vehicle-price',
    '.listing-price',
    '.srp-list-item-price',
    '.size-20', // Edmunds uses size classes for prices
    '[class*="Price"]',
    '[class*="price"]',
    // New Edmunds 2024 patterns
    '.heading-3', // Price often in heading
    '.text-primary-darker',
  ],
  // Mercari (Used & Cheap)
  mercari: [
    '[data-testid="price"]',
    '.item-price',
    '.product-price',
    '.price-value',
    '.sale-price',
    '.current-price',
    '[class*="Price"]',
    '[class*="price"]',
  ],
  // NEW: Wayfair (Home & Furniture)
  wayfair: [
    '[data-enzyme-id="PriceBlock"]',
    '.BasePriceBlock',
    '.SFPrice',
    '.ProductDetailPrice',
    '[data-testid="product-price"]',
    '.price-value',
    '[class*="Price"]',
    '[class*="price"]',
  ],
  generic: [
    '.price',
    '.product-price',
    '.current-price',
    '.sale-price',
    '.final-price',
    '.offer-price',
    '.price-current',
    '.price-now',
    '.actual-price',
    '[data-price]',
    '[data-product-price]',
    '[itemprop="price"]',
    '.pdp-price',
    '.product__price',
    '.ProductPrice',
  ],
};

// Stores that commonly require WebView fallback due to heavy JS rendering
const DYNAMIC_CONTENT_STORES: StoreType[] = ['shein', 'aliexpress'];

// Stores where JSON-LD should be the PRIMARY extraction method
const JSON_LD_PRIORITY_STORES: StoreType[] = ['edmunds', 'shein', 'amazon', 'walmart', 'bestbuy'];

// ============== TIMEOUT CONFIGURATION ==============
// Per-store timeouts - TIGHTENED for faster fail behavior
// Frontend timeout is ~5-8s, so backend must fail within 3-4s to give clear error

const STORE_TIMEOUTS: Record<StoreType, { fast: number; standard: number }> = {
  // Problematic stores - fail VERY fast (3s)
  shein: { fast: 2500, standard: 3500 },
  aliexpress: { fast: 2500, standard: 3500 },
  // Standard stores - fail fast (4s)
  amazon: { fast: 3000, standard: 4000 },
  walmart: { fast: 3000, standard: 4000 },
  bestbuy: { fast: 3000, standard: 4000 },
  ebay: { fast: 3000, standard: 4000 },
  target: { fast: 3000, standard: 4000 },
  macys: { fast: 3000, standard: 4000 },
  homedepot: { fast: 3000, standard: 4000 },
  // Mercari & Wayfair
  mercari: { fast: 3000, standard: 4000 },
  wayfair: { fast: 3000, standard: 4000 },
  // Car sites - slightly longer but still bounded (5s)
  carvana: { fast: 4000, standard: 5000 },
  cargurus: { fast: 4000, standard: 5000 },
  tesla_used: { fast: 4000, standard: 5000 },
  edmunds: { fast: 4000, standard: 5000 },
  // Generic fallback
  generic: { fast: 3000, standard: 4000 },
};

const TIMEOUTS = {
  fast: 3000,
  standard: 4000,
  ocr: 4000, // Reduced OCR timeout
};

// Max extraction attempts per store before giving up
const MAX_EXTRACTION_ATTEMPTS = 1; // No retries - fail fast

// ============== EXTRACTION METHODS ==============

interface ProductInfo {
  title: string | null;
  imageUrl: string | null;
}

// ============== BAD TITLE BLOCKLIST ==============
// Titles matching these patterns are rejected and treated as null
const BAD_TITLE_PATTERNS = [
  /skip\s+to\s+main\s+content/i,
  /product\s+summary\s+presents\s+key\s+product\s+information/i,
  /^home$/i,
  /^homepage$/i,
  /^tesla$/i,
  /^amazon$/i,
  /^walmart$/i,
  /^ebay$/i,
  /^target$/i,
  /^best\s*buy$/i,
  /^shein$/i,
  /^carvana$/i,
  /^cargurus$/i,
  /^wayfair$/i,
  /^mercari$/i,
  /^shop\s+now$/i,
  /^buy\s+now$/i,
  /^welcome$/i,
  /^page\s+not\s+found$/i,
  /^404$/i,
  /^error$/i,
  /^loading/i,
  /^untitled/i,
];

// Check if title looks like a URL
function looksLikeUrl(title: string): boolean {
  return /https?:\/\//.test(title) || /www\./.test(title) || /\.com\//.test(title) || /\.co\./.test(title);
}

// Validate and sanitize title
function validateTitle(rawTitle: string | null): string | null {
  if (!rawTitle) return null;
  
  const trimmed = rawTitle.trim();
  
  // Too short or too long
  if (trimmed.length < 3 || trimmed.length > 500) return null;
  
  // Check blocklist patterns
  for (const pattern of BAD_TITLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[extract-price] EXTRACT_PRICE_TITLE_REJECTED pattern="${pattern.source}" title="${trimmed.substring(0, 50)}"`);
      return null;
    }
  }
  
  // Check if it looks like a URL
  if (looksLikeUrl(trimmed)) {
    console.log(`[extract-price] EXTRACT_PRICE_TITLE_REJECTED reason="looks_like_url" title="${trimmed.substring(0, 50)}"`);
    return null;
  }
  
  return trimmed;
}

function extractProductInfo(html: string, store: StoreType): ProductInfo {
  let title: string | null = null;
  let rawTitle: string | null = null;
  let titleSource: string | null = null;
  let imageUrl: string | null = null;

  // ===== TITLE EXTRACTION PRIORITY ORDER =====
  // Priority 1: og:title meta tag (most reliable for product pages)
  if (!rawTitle) {
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogTitle && ogTitle[1]) {
      rawTitle = ogTitle[1].trim();
      titleSource = 'og:title';
    }
  }

  // Priority 2: twitter:title meta tag
  if (!rawTitle) {
    const twitterTitle = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:title["']/i);
    if (twitterTitle && twitterTitle[1]) {
      rawTitle = twitterTitle[1].trim();
      titleSource = 'twitter:title';
    }
  }

  // Priority 3: JSON-LD Product name
  if (!rawTitle) {
    try {
      const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatches) {
        for (const match of jsonLdMatches) {
          const jsonContent = match.replace(/<script[^>]*>|<\/script>/gi, '').trim();
          try {
            const data = JSON.parse(jsonContent);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
                if (!rawTitle && item.name) {
                  rawTitle = String(item.name).trim();
                  titleSource = 'json-ld';
                }
                if (!imageUrl && item.image) {
                  const img = Array.isArray(item.image) ? item.image[0] : item.image;
                  imageUrl = typeof img === 'string' ? img : img?.url ?? null;
                }
              }
            }
          } catch { /* Invalid JSON */ }
        }
      }
    } catch { /* Extraction failed */ }
  }

  // Priority 4: Document <title> tag (with store name stripping)
  if (!rawTitle) {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag && titleTag[1]) {
      rawTitle = titleTag[1]
        .replace(/\s*[-|–—:]\s*(Amazon|Walmart|eBay|Best Buy|Target|SHEIN|Home Depot|Macy's|Carvana|CarGurus|Wayfair|Mercari|Tesla|Edmunds).*$/i, '')
        .replace(/\s*\|\s*(Amazon|Walmart|eBay|Best Buy|Target|SHEIN|Home Depot|Macy's|Carvana|CarGurus|Wayfair|Mercari|Tesla|Edmunds).*$/i, '')
        .trim();
      titleSource = 'document-title';
    }
  }

  // Priority 5: h1 fallback (last resort)
  if (!rawTitle) {
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      rawTitle = h1Match[1].trim();
      titleSource = 'h1';
    }
  }

  // Log raw title before validation
  console.log(`[extract-price] EXTRACT_PRICE_TITLE_RAW source="${titleSource || 'none'}" title="${rawTitle?.substring(0, 80) || 'null'}"`);

  // Validate title through blocklist
  title = validateTitle(rawTitle);

  // Log final title after validation
  console.log(`[extract-price] EXTRACT_PRICE_TITLE_FINAL title="${title?.substring(0, 80) || 'null'}" accepted=${title !== null}`);

  // ===== IMAGE EXTRACTION =====
  // Get image from og:image if not already found via JSON-LD
  if (!imageUrl) {
    const ogImage = html.match(/<meta[^>]*property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i);
    if (ogImage && ogImage[1]) imageUrl = ogImage[1];
  }

  // Normalize image URL
  if (imageUrl && !imageUrl.startsWith('http')) {
    imageUrl = imageUrl.startsWith('//') ? `https:${imageUrl}` : null;
  }

  return { title, imageUrl };
}

function extractFromJsonLd(html: string): { price: number; currency?: string } | null {
  try {
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (!jsonLdMatches) return null;

    for (const match of jsonLdMatches) {
      const jsonContent = match.replace(/<script[^>]*>|<\/script>/gi, '').trim();
      try {
        const data = JSON.parse(jsonContent);
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
            const offers = item.offers;
            if (offers) {
              const offerList = Array.isArray(offers) ? offers : [offers];
              for (const offer of offerList) {
                const priceVal = offer.price ?? offer.lowPrice;
                if (priceVal !== undefined) {
                  const price = cleanPriceString(String(priceVal));
                  if (price) {
                    return { price, currency: offer.priceCurrency };
                  }
                }
              }
            }
          }
        }
      } catch { /* Invalid JSON */ }
    }
  } catch { /* Extraction failed */ }
  return null;
}

function extractFromSelectors(html: string, store: StoreType): number | null {
  const selectors = [...(STORE_SELECTORS[store] || []), ...STORE_SELECTORS.generic];

  for (const selector of selectors) {
    let pattern: RegExp | null = null;

    if (selector.startsWith('#')) {
      const id = selector.slice(1).split(/[\s.[\]]/)[0];
      pattern = new RegExp(`id=["']${id}["'][^>]*>([^<]*(?:<[^>]*>[^<]*)*)`, 'i');
    } else if (selector.startsWith('.')) {
      const className = selector.slice(1).split(/[\s.[\]]/)[0];
      pattern = new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([^<]*(?:<[^>]*>[^<]*)*)`, 'i');
    } else if (selector.startsWith('[')) {
      const attrMatch = selector.match(/\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]/);
      if (attrMatch) {
        const attr = attrMatch[1];
        const value = attrMatch[2];
        pattern = value
          ? new RegExp(`${attr}=["']${value}["'][^>]*>([^<]*)`, 'i')
          : new RegExp(`${attr}=["']([^"']+)["']`, 'i');
      }
    }

    if (pattern) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const price = cleanPriceString(match[1]);
        if (price) return price;
      }
    }
  }

  return null;
}

function extractWithRegex(html: string): { price: number; currencyHint: string } | null {
  // Only look for USD prices - avoid false positives with other currencies
  const patterns = [
    { regex: /(?:\$|USD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi, currency: 'USD' },
    { regex: /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:USD|\$)/gi, currency: 'USD' },
    { regex: /(?:€|EUR)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/gi, currency: 'EUR' },
    { regex: /(?:£|GBP)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi, currency: 'GBP' },
    // REMOVED CDF/FC pattern - causes too many false positives on US store pages
    { regex: /(?:data-)?price=["'](\d+(?:\.\d{1,2})?)["']/gi, currency: 'USD' },
    { regex: /"price":\s*["']?(\d+(?:\.\d{1,2})?)["']?/gi, currency: 'USD' },
  ];

  const candidates: { price: number; currency: string }[] = [];

  for (const { regex, currency } of patterns) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(html)) !== null) {
      const price = cleanPriceString(match[1]);
      if (price && price > 0.01 && price < 100000) {
        candidates.push({ price, currency });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Find most common price
  const priceCounts = new Map<number, { count: number; currency: string }>();
  for (const { price, currency } of candidates) {
    const existing = priceCounts.get(price);
    if (existing) {
      existing.count++;
      if (currency === 'USD') existing.currency = currency;
    } else {
      priceCounts.set(price, { count: 1, currency });
    }
  }

  let bestPrice = candidates[0].price;
  let bestCurrency = candidates[0].currency;
  let bestCount = 0;

  for (const [price, { count, currency }] of priceCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestPrice = price;
      bestCurrency = currency;
    }
  }

  return { price: bestPrice, currencyHint: bestCurrency };
}

async function extractWithOcr(url: string, timeout: number): Promise<number | null> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlApiKey) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.success || !data.markdown) return null;

    const result = extractWithRegex(data.markdown);
    return result?.price ?? null;
  } catch {
    return null;
  }
}

async function extractViaFirecrawlFull(
  url: string,
  store: StoreType,
  timeout: number
): Promise<{ price: number; currencyCode: string | null; title: string | null; imageUrl: string | null } | null> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlApiKey) return null;

  try {
    console.log(`[extract-price] Firecrawl full fallback attempting for ${store}: ${url.substring(0, 80)}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[extract-price] Firecrawl scrape failed: status=${response.status}`);
      return null;
    }

    const data = await response.json();
    const html = data?.data?.html || data?.html;
    if (!html || html.length < 100) {
      console.warn('[extract-price] Firecrawl returned empty/short HTML');
      return null;
    }

    // Extract price using the same methods as direct scraping
    let price: number | null = null;
    let currencyCode: string | null = null;

    // Try JSON-LD first
    const jsonLdResult = extractFromJsonLd(html);
    if (jsonLdResult) {
      price = jsonLdResult.price;
      currencyCode = jsonLdResult.currency ?? null;
    }

    // Try meta tags / selectors
    if (!price) {
      price = extractFromSelectors(html, store);
    }

    // Try regex
    if (!price) {
      const regexResult = extractWithRegex(html);
      if (regexResult) {
        price = regexResult.price;
        currencyCode = regexResult.currencyHint;
      }
    }

    if (!price) {
      console.warn('[extract-price] Firecrawl HTML returned but no price found');
      return null;
    }

    // Extract product info (title, image)
    const productInfo = extractProductInfo(html, store);

    // Detect currency if not already found
    if (!currencyCode) {
      const detected = detectCurrency(html, url);
      currencyCode = detected.code;
    }

    console.log(`[extract-price] Firecrawl full extraction succeeded for ${store}: price=${price} currency=${currencyCode}`);

    return {
      price,
      currencyCode,
      title: productInfo.title,
      imageUrl: productInfo.imageUrl,
    };
  } catch (error) {
    console.warn('[extract-price] Firecrawl full fallback failed:', error);
    return null;
  }
}

async function extractViaMirror(url: string, store: StoreType, timeout: number): Promise<{ price: number; currencyCode: string | null; title: string | null; imageUrl: string | null } | null> {
  try {
    const urlWithoutProtocol = url.replace(/^https?:\/\//i, '');
    const mirrorUrl = `https://r.jina.ai/http://${urlWithoutProtocol}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(mirrorUrl, {
      headers: {
        'Accept': 'text/plain,text/markdown;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const content = await response.text();
    if (!content || content.length < 50) return null;

    const regexResult = extractWithRegex(content);
    if (!regexResult?.price) return null;

    const headingMatch = content.match(/^#\s+(.+)$/m) || content.match(/^Title:\s*(.+)$/mi);
    const title = headingMatch?.[1]?.trim() || null;

    console.log(`[extract-price] Mirror extraction succeeded for ${store}: ${regexResult.price} ${regexResult.currencyHint}`);

    return {
      price: regexResult.price,
      currencyCode: regexResult.currencyHint ?? null,
      title,
      imageUrl: null,
    };
  } catch {
    return null;
  }
}

async function extractViaRainforestProduct(
  url: string,
  timeout: number
): Promise<{ price: number; currencyCode: string | null; title: string | null; imageUrl: string | null } | null> {
  const apiKey = Deno.env.get('RAINFOREST_API_KEY');
  if (!apiKey) return null;

  const asin = extractProductIdFromUrl(url, 'amazon');
  if (!asin) return null;

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const domainMatch = host.match(/amazon\.(com|ca|co\.uk|de|fr|it|es|nl|com\.au|com\.br|co\.jp|com\.mx|in|ae|sg|sa|se|pl|com\.tr)$/i);
    const amazonDomain = domainMatch ? `amazon.${domainMatch[1]}` : 'amazon.com';

    const requestUrl = new URL('https://api.rainforestapi.com/request');
    requestUrl.searchParams.set('api_key', apiKey);
    requestUrl.searchParams.set('type', 'product');
    requestUrl.searchParams.set('amazon_domain', amazonDomain);
    requestUrl.searchParams.set('asin', asin);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(requestUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[extract-price] Rainforest product fetch failed: asin=${asin} status=${response.status}`);
      return null;
    }

    const data = await response.json();
    const product = data?.product;
    if (!product) return null;

    const priceCandidate =
      Number(product?.buybox_winner?.price?.value) ||
      Number(product?.price?.value) ||
      Number(product?.current_price?.value) ||
      Number(product?.prices?.[0]?.value);

    if (!Number.isFinite(priceCandidate) || priceCandidate <= 0) return null;

    const currencyCode =
      product?.buybox_winner?.price?.currency ||
      product?.price?.currency ||
      product?.current_price?.currency ||
      product?.prices?.[0]?.currency ||
      'USD';

    const imageUrl =
      product?.main_image?.link ||
      product?.image ||
      product?.images?.[0]?.link ||
      null;

    const title = typeof product?.title === 'string' ? product.title : null;

    console.log(`[extract-price] Rainforest product extraction succeeded for amazon asin=${asin} price=${priceCandidate}`);

    return {
      price: priceCandidate,
      currencyCode,
      title,
      imageUrl,
    };
  } catch (error) {
    console.warn('[extract-price] Rainforest product fallback failed:', error);
    return null;
  }
}

// ============== CATALOG PERSISTENCE ==============
// Saves successful paste-link extractions to catalog_items permanently
// so future users get instant, zero-credit responses.

async function saveToCatalogItems(
  supabase: any,
  store: StoreType,
  url: string,
  price: number,
  title: string | null,
  imageUrl: string | null
): Promise<void> {
  try {
    // Skip if no price
    if (!price || price <= 0) return;
    // Extract product ID; skip if we can't identify the product
    const productId = extractProductIdFromUrl(url, store);
    if (!productId) return;

    const provider = store === 'generic' ? null : store;
    if (!provider) return;

    const now = new Date().toISOString();

    await supabase.from('catalog_items').upsert(
      {
        provider,
        provider_product_id: productId,
        product_url: url,
        price_usd: price,
        title: title || null,
        image_url: imageUrl || null,
        is_active: true,
        price_updated_at: now,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'provider,provider_product_id' }
    );

    console.log(`[extract-price] Saved to catalog_items: provider=${provider} id=${productId} price=${price}`);
  } catch (error) {
    console.warn('[extract-price] catalog_items save failed (non-blocking):', error);
  }
}

interface CachedPrice {
  basePrice: number;
  currencySymbol: string;
  rawCurrencyCode: string;
  store: string;
  title: string | null;
  imageUrl: string | null;
  lastFetchedAt: string;
  cacheType?: 'hot' | 'standard';
}

// Check HOT CACHE first (5-15 min TTL)
async function getHotCachedPrice(supabase: any, normalizedUrl: string): Promise<CachedPrice | null> {
  try {
    const { data, error } = await supabase
      .from('product_hot_cache')
      .select('response_json, store, expires_at, hit_count')
      .eq('url', normalizedUrl)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;

    // Update hit count (non-blocking)
    supabase
      .from('product_hot_cache')
      .update({ hit_count: (data.hit_count || 1) + 1 })
      .eq('url', normalizedUrl)
      .then(() => {})
      .catch(() => {});

    const response = data.response_json;
    return {
      basePrice: Number(response.basePrice),
      currencySymbol: response.currencySymbol || '$',
      rawCurrencyCode: response.rawCurrencyCode || 'USD',
      store: data.store || response.store,
      title: response.title,
      imageUrl: response.imageUrl,
      lastFetchedAt: response.lastFetchedAt || new Date().toISOString(),
      cacheType: 'hot',
    };
  } catch {
    return null;
  }
}

// Save to HOT CACHE (5-15 min TTL)
async function saveToHotCache(
  supabase: any,
  normalizedUrl: string,
  store: string,
  data: CachedPrice
): Promise<void> {
  try {
    const ttlMs = getHotCacheTtlForStore(store);
    const expiresAt = new Date(Date.now() + ttlMs);

    await supabase.from('product_hot_cache').upsert(
      {
        url: normalizedUrl,
        store,
        response_json: {
          basePrice: data.basePrice,
          currencySymbol: data.currencySymbol,
          rawCurrencyCode: data.rawCurrencyCode,
          title: data.title,
          imageUrl: data.imageUrl,
          lastFetchedAt: data.lastFetchedAt,
        },
        expires_at: expiresAt.toISOString(),
        hit_count: 1,
      },
      { onConflict: 'url' }
    );
  } catch (error) {
    console.warn('[extract-price] Hot cache write failed:', error);
  }
}

// Check STANDARD CACHE (4-48 hour TTL)
async function getCachedPrice(supabase: any, normalizedUrl: string, store: string): Promise<CachedPrice | null> {
  try {
    const ttlMs = getTtlForStore(store);
    const expiryThreshold = new Date(Date.now() - ttlMs).toISOString();

    const { data, error } = await supabase
      .from('price_cache')
      .select('base_price, currency, currency_symbol, raw_currency_code, store, title, image_url, fetched_at')
      .eq('url', normalizedUrl)
      .gt('fetched_at', expiryThreshold)
      .maybeSingle();

    if (error || !data) return null;

    return {
      basePrice: Number(data.base_price),
      currencySymbol: data.currency_symbol || getCurrencySymbol(data.currency || 'USD'),
      rawCurrencyCode: data.raw_currency_code || data.currency || 'USD',
      store: data.store,
      title: data.title,
      imageUrl: data.image_url,
      lastFetchedAt: data.fetched_at,
      cacheType: 'standard',
    };
  } catch {
    return null;
  }
}

async function setCachedPrice(
  supabase: any,
  normalizedUrl: string,
  data: {
    store: string;
    basePrice: number;
    currencySymbol: string;
    rawCurrencyCode: string;
    title: string | null;
    imageUrl: string | null;
  }
): Promise<void> {
  try {
    const now = new Date();
    const ttlMs = getTtlForStore(data.store);
    const expiresAt = new Date(now.getTime() + ttlMs);

    await supabase.from('price_cache').upsert(
      {
        url: normalizedUrl,
        store: data.store,
        base_price: data.basePrice,
        currency: data.rawCurrencyCode,
        currency_symbol: data.currencySymbol,
        raw_currency_code: data.rawCurrencyCode,
        display_price: formatDisplayPrice(data.basePrice, data.rawCurrencyCode),
        title: data.title,
        image_url: data.imageUrl,
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'url' }
    );
  } catch (error) {
    console.error('[extract-price] Cache write failed:', error);
  }
}


interface CatalogFallbackResult {
  basePrice: number;
  title: string | null;
  imageUrl: string | null;
  source: 'catalog' | 'catalog_cache';
}

function extractProductIdFromUrl(url: string, store: StoreType): string | null {
  const matchers: Record<StoreType, RegExp[]> = {
    amazon: [
      /\/dp\/([A-Z0-9]{10})/i,
      /\/gp\/product\/([A-Z0-9]{10})/i,
      /\/gp\/aw\/d\/([A-Z0-9]{10})/i,
      /\/gp\/offer-listing\/([A-Z0-9]{10})/i,
    ],
    ebay: [
      /\/itm\/(?:[^/]+\/)?(\d{9,14})/i,
      /[?&]item=(\d{9,14})/i,
    ],
    walmart: [/\/ip\/(?:[^/]+\/)?(\d{6,20})/i],
    bestbuy: [/\/site\/[^/]*\/(\d+)\.p/i],
    target: [/\/A-(\d{4,})/i],
    aliexpress: [/\/item\/(\d+)\.html/i],
    shein: [/-p-(\d+)\.html/i],
    macys: [],
    homedepot: [],
    mercari: [/\/item\/(m\w+)/i],
    wayfair: [/-([A-Z0-9]+)\.html/i],
    carvana: [/\/vehicle\/(\d+)/i],
    cargurus: [/\/Cars\/in\/[^/]+\/(\w+)/i],
    tesla_used: [/\/inventory\/[A-Z0-9]+\/(\w+)/i],
    edmunds: [/\/vin\/(\w+)/i],
    generic: [],
  };

  for (const regex of matchers[store] ?? []) {
    const match = url.match(regex);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

async function getCatalogFallbackPrice(
  supabase: any,
  formattedUrl: string,
  normalizedUrl: string,
  store: StoreType
): Promise<CatalogFallbackResult | null> {
  try {
    const parsed = new URL(formattedUrl);
    const baseUrl = `${parsed.origin}${parsed.pathname}`;
    const urlCandidates = Array.from(new Set([formattedUrl, normalizedUrl, baseUrl].filter(Boolean)));

    const baseQuery = supabase
      .from('catalog_items')
      .select('price_usd,title,image_url,provider,provider_product_id,product_url,updated_at')
      .gt('price_usd', 0)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1);

    const { data: exactUrlMatch } = await baseQuery.in('product_url', urlCandidates);
    if (exactUrlMatch?.[0]?.price_usd) {
      console.log(`[extract-price] Catalog fallback hit by URL for ${store}`);
      return {
        basePrice: Number(exactUrlMatch[0].price_usd),
        title: exactUrlMatch[0].title ?? null,
        imageUrl: exactUrlMatch[0].image_url ?? null,
        source: 'catalog',
      };
    }

    const productId = extractProductIdFromUrl(formattedUrl, store);
    if (!productId) return null;

    const provider = store === 'generic' ? null : store;
    const amazonProviders = ['amazon', 'rainforest'];

    let idQuery = supabase
      .from('catalog_items')
      .select('price_usd,title,image_url,provider,provider_product_id,updated_at')
      .gt('price_usd', 0)
      .eq('is_active', true)
      .eq('provider_product_id', productId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (store === 'amazon') {
      idQuery = idQuery.in('provider', amazonProviders);
    } else if (provider) {
      idQuery = idQuery.eq('provider', provider);
    }

    const { data: idMatch } = await idQuery;
    if (idMatch?.[0]?.price_usd) {
      console.log(`[extract-price] Catalog fallback hit by provider_product_id for ${store} id=${productId}`);
      return {
        basePrice: Number(idMatch[0].price_usd),
        title: idMatch[0].title ?? null,
        imageUrl: idMatch[0].image_url ?? null,
        source: 'catalog',
      };
    }

    const likeQuery = supabase
      .from('catalog_items')
      .select('price_usd,title,image_url,provider,provider_product_id,updated_at')
      .gt('price_usd', 0)
      .eq('is_active', true)
      .ilike('product_url', `%${productId}%`)
      .order('updated_at', { ascending: false })
      .limit(1);

    const { data: looseMatch } = store === 'amazon'
      ? await likeQuery.in('provider', amazonProviders)
      : (provider ? await likeQuery.eq('provider', provider) : await likeQuery);
    if (looseMatch?.[0]?.price_usd) {
      console.log(`[extract-price] Catalog fallback hit by URL fragment for ${store} id=${productId}`);
      return {
        basePrice: Number(looseMatch[0].price_usd),
        title: looseMatch[0].title ?? null,
        imageUrl: looseMatch[0].image_url ?? null,
        source: 'catalog',
      };
    }

    // Extra fallback for Amazon: inspect recent cached search payloads (catalog_cache.response.items)
    if (store === 'amazon') {
      const { data: cacheRows } = await supabase
        .from('catalog_cache')
        .select('response,updated_at')
        .order('updated_at', { ascending: false })
        .limit(25);

      for (const row of cacheRows ?? []) {
        const items = Array.isArray(row?.response?.items) ? row.response.items : [];
        const matched = items.find((item: any) => {
          const id = String(item?.providerProductId ?? '').toUpperCase();
          const candidatePrice = Number(item?.priceUsd);
          return id === productId && Number.isFinite(candidatePrice) && candidatePrice > 0;
        });

        if (matched) {
          console.log(`[extract-price] Catalog cache fallback hit for amazon id=${productId}`);
          return {
            basePrice: Number(matched.priceUsd),
            title: matched.title ?? null,
            imageUrl: matched.imageUrl ?? null,
            source: 'catalog_cache',
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.warn('[extract-price] Catalog fallback failed:', error);
    return null;
  }
}

// ============== MAIN HANDLER ==============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCors();
  }

  const startTime = Date.now();
  let logData: Record<string, any> = { event: 'price_extract' };

  try {
    if (req.method !== 'POST') {
      return jsonError(405, ErrorCodes.BAD_REQUEST, 'Method not allowed');
    }

    // Rate limiting
    const clientIp = getClientIp(req);
    if (!checkRateLimit(clientIp, 30, 60000)) {
      logData = { ...logData, status: 429, error: 'RATE_LIMIT', ip: clientIp };
      console.log(JSON.stringify(logData));
      return jsonError(429, ErrorCodes.RATE_LIMIT);
    }

    // Parse request
    const body = await req.json();
    const { url, forceRefresh = false, allowOcr = false, mode = 'standard' } = body;

    if (!url || typeof url !== 'string') {
      return jsonError(400, ErrorCodes.INVALID_URL);
    }

    // Format URL
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    // Security checks
    if (isPrivateUrl(formattedUrl)) {
      return jsonError(400, ErrorCodes.INVALID_URL);
    }

    if (!isAllowedDomain(formattedUrl)) {
      return jsonError(400, ErrorCodes.UNSUPPORTED_DOMAIN);
    }

    // Initialize
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { normalizedUrl, error: normalizeError } = normalizeUrl(formattedUrl);
    if (normalizeError) {
      return jsonError(400, ErrorCodes.INVALID_URL);
    }

    const store = detectStore(formattedUrl);
    logData = { ...logData, store, url: normalizedUrl.substring(0, 100) };

    // Check cache (unless forceRefresh) - TWO-TIER CACHING
    if (!forceRefresh) {
      // 1. Check HOT CACHE first (5-15 min TTL) - fastest
      const hotCached = await getHotCachedPrice(supabase, normalizedUrl);
      if (hotCached) {
        logData = { ...logData, cacheHit: true, cacheType: 'hot', duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        const response: PriceResolveResponse = {
          url: normalizedUrl,
          store,
          basePrice: hotCached.basePrice,
          currencySymbol: hotCached.currencySymbol,
          rawCurrencyCode: hotCached.rawCurrencyCode,
          title: hotCached.title,
          imageUrl: hotCached.imageUrl,
          cacheHit: true,
          lastFetchedAt: hotCached.lastFetchedAt,
        };
        return jsonSuccess(response);
      }

      // 2. Check STANDARD CACHE (4-48 hour TTL)
      const cached = await getCachedPrice(supabase, normalizedUrl, store);
      if (cached) {
        // Promote to hot cache for faster subsequent access
        saveToHotCache(supabase, normalizedUrl, store, cached).catch(() => {});
        
        logData = { ...logData, cacheHit: true, cacheType: 'standard', duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        const response: PriceResolveResponse = {
          url: normalizedUrl,
          store,
          basePrice: cached.basePrice,
          currencySymbol: cached.currencySymbol,
          rawCurrencyCode: cached.rawCurrencyCode,
          title: cached.title,
          imageUrl: cached.imageUrl,
          cacheHit: true,
          lastFetchedAt: cached.lastFetchedAt,
        };
        return jsonSuccess(response);
      }
    }

    // ===== AMAZON FAST PATH: Check catalog FIRST before any scraping =====
    // Amazon almost always blocks scraping, so check our indexed catalog first
    if (store === 'amazon') {
      const catalogResult = await getCatalogFallbackPrice(supabase, formattedUrl, normalizedUrl, store);
      if (catalogResult) {
        const now = new Date().toISOString();
        const currencyCodeFb = 'USD';
        const currencySymbolFb = getCurrencySymbol(currencyCodeFb);

        // Cache for faster subsequent access
        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: catalogResult.basePrice,
          currencySymbol: currencySymbolFb,
          rawCurrencyCode: currencyCodeFb,
          title: catalogResult.title,
          imageUrl: catalogResult.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: catalogResult.basePrice,
          currencySymbol: currencySymbolFb,
          rawCurrencyCode: currencyCodeFb,
          store,
          title: catalogResult.title,
          imageUrl: catalogResult.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        logData = { ...logData, cacheHit: false, method: 'amazon_catalog_fast_path', priceFound: true, duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: catalogResult.basePrice,
          currencySymbol: currencySymbolFb,
          rawCurrencyCode: currencyCodeFb,
          title: catalogResult.title,
          imageUrl: catalogResult.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // ASIN not in catalog — enqueue for background ingestion so it works next time
      const asin = extractProductIdFromUrl(formattedUrl, 'amazon');
      if (asin) {
        console.log(`[extract-price] Amazon ASIN ${asin} not in catalog, enqueuing for ingestion`);
        supabase
          .from('amazon_ingest_queue')
          .upsert(
            { query: asin, reason: 'paste_link_miss', priority: 10, status: 'pending', attempts: 0 },
            { onConflict: 'query' }
          )
          .then(() => {})
          .catch(() => {});
      }

      // Try Firecrawl FIRST for fastest results (returns full HTML with images)
      const firecrawlResult = await extractViaFirecrawlFull(formattedUrl, store, 10000);
      if (firecrawlResult?.price) {
        const now = new Date().toISOString();
        const resolvedCurrencyCode = firecrawlResult.currencyCode || 'USD';
        const resolvedCurrencySymbol = getCurrencySymbol(resolvedCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: firecrawlResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: firecrawlResult.title,
          imageUrl: firecrawlResult.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: firecrawlResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          store,
          title: firecrawlResult.title,
          imageUrl: firecrawlResult.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        // Persist to catalog (fire-and-forget)
        saveToCatalogItems(supabase, store, formattedUrl, firecrawlResult.price, firecrawlResult.title, firecrawlResult.imageUrl).catch(() => {});

        logData = { ...logData, cacheHit: false, method: 'amazon_firecrawl_primary', priceFound: true, duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: firecrawlResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: firecrawlResult.title,
          imageUrl: firecrawlResult.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // Fallback to Rainforest API if Firecrawl failed
      const rainforest = await extractViaRainforestProduct(formattedUrl, 8000);
      if (rainforest?.price) {
        const now = new Date().toISOString();
        const resolvedCurrencyCode = rainforest.currencyCode || 'USD';
        const resolvedCurrencySymbol = getCurrencySymbol(resolvedCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: rainforest.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: rainforest.title,
          imageUrl: rainforest.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: rainforest.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          store,
          title: rainforest.title,
          imageUrl: rainforest.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        // Persist to catalog (fire-and-forget)
        saveToCatalogItems(supabase, store, formattedUrl, rainforest.price, rainforest.title, rainforest.imageUrl).catch(() => {});

        logData = { ...logData, cacheHit: false, method: 'amazon_rainforest_fallback', priceFound: true, duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: rainforest.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: rainforest.title,
          imageUrl: rainforest.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // Last resort: mirror scraping
      const mirror = await extractViaMirror(formattedUrl, store, 4000);
      if (mirror?.price) {
        const now = new Date().toISOString();
        const resolvedCurrencyCode = mirror.currencyCode || 'USD';
        const resolvedCurrencySymbol = getCurrencySymbol(resolvedCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          store,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        // Persist to catalog (fire-and-forget)
        saveToCatalogItems(supabase, store, formattedUrl, mirror.price, mirror.title, mirror.imageUrl).catch(() => {});

        logData = { ...logData, cacheHit: false, method: 'amazon_mirror_fallback', priceFound: true, duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // Amazon: all automated methods failed — return clear error with manual fallback
      logData = { ...logData, status: 404, error: 'PRICE_NOT_FOUND', reason: 'amazon_all_methods_failed', duration: Date.now() - startTime };
      console.log(JSON.stringify(logData));
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'PRICE_NOT_FOUND',
          message: 'Amazon product not yet indexed',
          message_en: 'This Amazon product is not yet in our catalog. Please enter the price manually.',
          message_fr: 'Ce produit Amazon n\'est pas encore dans notre catalogue. Veuillez entrer le prix manuellement.',
          retryable: false,
          webviewFallback: true,
          suggestedFallback: 'MANUAL',
        }),
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }
      );
    }

    // ===== NON-AMAZON STORES: Standard scraping flow =====
    // Get store-specific timeout (fail fast for problematic stores)
    const storeTimeouts = STORE_TIMEOUTS[store] || STORE_TIMEOUTS.generic;
    const fetchTimeout = mode === 'fast' ? storeTimeouts.fast : storeTimeouts.standard;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`[extract-price] Timeout reached for ${store} after ${fetchTimeout}ms`);
      controller.abort();
    }, fetchTimeout);

    let response: Response;
    try {
      response = await fetch(formattedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeoutId);
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        // Fail fast with PRICE_NOT_FOUND instead of TIMEOUT for better mobile UX
        logData = { ...logData, status: 404, error: 'PRICE_NOT_FOUND', reason: 'timeout', store, duration };
        console.log(JSON.stringify(logData));
        return jsonError(404, ErrorCodes.PRICE_NOT_FOUND, `Price extraction timed out for ${store}`);
      }
      
      // Network error - fail fast
      logData = { ...logData, status: 404, error: 'PRICE_NOT_FOUND', reason: 'network_error', store, duration };
      console.log(JSON.stringify(logData));
      return jsonError(404, ErrorCodes.PRICE_NOT_FOUND, `Unable to fetch price from ${store}`);
    }

    if (!response.ok) {
      // Try Firecrawl FIRST for HTTP error responses (most reliable)
      const firecrawlHttpResult = await extractViaFirecrawlFull(formattedUrl, store, 10000);
      if (firecrawlHttpResult?.price) {
        const now = new Date().toISOString();
        const resolvedCurrencyCode = firecrawlHttpResult.currencyCode || 'USD';
        const resolvedCurrencySymbol = getCurrencySymbol(resolvedCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: firecrawlHttpResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: firecrawlHttpResult.title,
          imageUrl: firecrawlHttpResult.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: firecrawlHttpResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          store,
          title: firecrawlHttpResult.title,
          imageUrl: firecrawlHttpResult.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        // Persist to catalog (fire-and-forget)
        saveToCatalogItems(supabase, store, formattedUrl, firecrawlHttpResult.price, firecrawlHttpResult.title, firecrawlHttpResult.imageUrl).catch(() => {});

        logData = { ...logData, cacheHit: false, method: 'firecrawl_primary_http_error', priceFound: true, duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: firecrawlHttpResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: firecrawlHttpResult.title,
          imageUrl: firecrawlHttpResult.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // Fallback: mirror scraping
      const mirror = await extractViaMirror(formattedUrl, store, 3500);
      if (mirror?.price) {
        const now = new Date().toISOString();
        const resolvedCurrencyCode = mirror.currencyCode || 'USD';
        const resolvedCurrencySymbol = getCurrencySymbol(resolvedCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          store,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        saveToCatalogItems(supabase, store, formattedUrl, mirror.price, mirror.title, mirror.imageUrl).catch(() => {});

        logData = {
          ...logData,
          cacheHit: false,
          method: 'mirror_fallback_http_error',
          priceFound: true,
          duration: Date.now() - startTime,
          httpStatus: response.status,
        };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // Last resort: catalog fallback
      const fallback = await getCatalogFallbackPrice(supabase, formattedUrl, normalizedUrl, store);
      if (fallback) {
        const now = new Date().toISOString();
        const fallbackCurrencyCode = 'USD';
        const fallbackCurrencySymbol = getCurrencySymbol(fallbackCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: fallback.basePrice,
          currencySymbol: fallbackCurrencySymbol,
          rawCurrencyCode: fallbackCurrencyCode,
          title: fallback.title,
          imageUrl: fallback.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: fallback.basePrice,
          currencySymbol: fallbackCurrencySymbol,
          rawCurrencyCode: fallbackCurrencyCode,
          store,
          title: fallback.title,
          imageUrl: fallback.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        logData = {
          ...logData,
          cacheHit: false,
          method: 'catalog_fallback_http_error',
          priceFound: true,
          duration: Date.now() - startTime,
          httpStatus: response.status,
        };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: fallback.basePrice,
          currencySymbol: fallbackCurrencySymbol,
          rawCurrencyCode: fallbackCurrencyCode,
          title: fallback.title,
          imageUrl: fallback.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      logData = { ...logData, status: 404, error: 'PRICE_NOT_FOUND', reason: 'http_error', httpStatus: response.status, store };
      console.log(JSON.stringify(logData));
      return jsonError(404, ErrorCodes.PRICE_NOT_FOUND, `Store returned error ${response.status}`);
    }

    // Read response body with timeout protection
    let html: string;
    try {
      const bodyController = new AbortController();
      const bodyTimeout = setTimeout(() => bodyController.abort(), 3000);
      html = await response.text();
      clearTimeout(bodyTimeout);
    } catch {
      logData = { ...logData, status: 404, error: 'PRICE_NOT_FOUND', reason: 'body_timeout', store };
      console.log(JSON.stringify(logData));
      return jsonError(404, ErrorCodes.PRICE_NOT_FOUND, 'Response body read timeout');
    }

    // Check for bot detection / captcha pages
    if (detectBotBlock(html)) {
      // Try Firecrawl FIRST for bot-blocked stores (most reliable bypass)
      const firecrawlBotResult = await extractViaFirecrawlFull(formattedUrl, store, 10000);
      if (firecrawlBotResult?.price) {
        const now = new Date().toISOString();
        const resolvedCurrencyCode = firecrawlBotResult.currencyCode || 'USD';
        const resolvedCurrencySymbol = getCurrencySymbol(resolvedCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: firecrawlBotResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: firecrawlBotResult.title,
          imageUrl: firecrawlBotResult.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: firecrawlBotResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          store,
          title: firecrawlBotResult.title,
          imageUrl: firecrawlBotResult.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        saveToCatalogItems(supabase, store, formattedUrl, firecrawlBotResult.price, firecrawlBotResult.title, firecrawlBotResult.imageUrl).catch(() => {});

        logData = { ...logData, cacheHit: false, method: 'firecrawl_primary_bot_blocked', priceFound: true, duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: firecrawlBotResult.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: firecrawlBotResult.title,
          imageUrl: firecrawlBotResult.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // Fallback: mirror scraping
      const mirror = await extractViaMirror(formattedUrl, store, 3500);
      if (mirror?.price) {
        const now = new Date().toISOString();
        const resolvedCurrencyCode = mirror.currencyCode || 'USD';
        const resolvedCurrencySymbol = getCurrencySymbol(resolvedCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          store,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        saveToCatalogItems(supabase, store, formattedUrl, mirror.price, mirror.title, mirror.imageUrl).catch(() => {});

        logData = {
          ...logData,
          cacheHit: false,
          method: 'mirror_fallback_bot_blocked',
          priceFound: true,
          duration: Date.now() - startTime,
        };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: mirror.price,
          currencySymbol: resolvedCurrencySymbol,
          rawCurrencyCode: resolvedCurrencyCode,
          title: mirror.title,
          imageUrl: mirror.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      // Last resort: catalog fallback
      const fallback = await getCatalogFallbackPrice(supabase, formattedUrl, normalizedUrl, store);
      if (fallback) {
        const now = new Date().toISOString();
        const fallbackCurrencyCode = 'USD';
        const fallbackCurrencySymbol = getCurrencySymbol(fallbackCurrencyCode);

        await setCachedPrice(supabase, normalizedUrl, {
          store,
          basePrice: fallback.basePrice,
          currencySymbol: fallbackCurrencySymbol,
          rawCurrencyCode: fallbackCurrencyCode,
          title: fallback.title,
          imageUrl: fallback.imageUrl,
        });
        saveToHotCache(supabase, normalizedUrl, store, {
          basePrice: fallback.basePrice,
          currencySymbol: fallbackCurrencySymbol,
          rawCurrencyCode: fallbackCurrencyCode,
          store,
          title: fallback.title,
          imageUrl: fallback.imageUrl,
          lastFetchedAt: now,
        }).catch(() => {});

        logData = {
          ...logData,
          cacheHit: false,
          method: 'catalog_fallback_bot_blocked',
          priceFound: true,
          duration: Date.now() - startTime,
        };
        console.log(JSON.stringify(logData));

        return jsonSuccess({
          url: normalizedUrl,
          store,
          basePrice: fallback.basePrice,
          currencySymbol: fallbackCurrencySymbol,
          rawCurrencyCode: fallbackCurrencyCode,
          title: fallback.title,
          imageUrl: fallback.imageUrl,
          cacheHit: false,
          lastFetchedAt: now,
        } as PriceResolveResponse);
      }

      logData = { ...logData, status: 403, error: 'SCRAPE_BLOCKED', store, duration: Date.now() - startTime };
      console.log(JSON.stringify(logData));
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'SCRAPE_BLOCKED',
          message: `${store} is blocking automated access`,
          message_en: `${store} is blocking automated access. Please open the page manually.`,
          message_fr: `${store} bloque l'accès automatisé. Veuillez ouvrir la page manuellement.`,
          retryable: false,
          webviewFallback: true,
          suggestedFallback: 'WEBVIEW',
        }),
        { status: 403, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }
      );
    }

    let price: number | null = null;
    let currencyCode: string | null = null;
    let extractionMethod: string | null = null;

    // Strategy 1: JSON-LD (fastest, most reliable) - PRIORITY for Edmunds
    const jsonLdResult = extractFromJsonLd(html);
    if (jsonLdResult) {
      price = jsonLdResult.price;
      currencyCode = jsonLdResult.currency ?? null;
      extractionMethod = 'jsonld';
      console.log(`[extract-price] JSON-LD extraction succeeded: ${price} ${currencyCode}`);
    }

    // Strategy 2: Store-specific selectors
    if (!price) {
      price = extractFromSelectors(html, store);
      if (price) {
        extractionMethod = 'selector';
        console.log(`[extract-price] Selector extraction succeeded: ${price}`);
      }
    }

    // Strategy 3: Regex fallback (only if selectors fail)
    if (!price) {
      const regexResult = extractWithRegex(html);
      if (regexResult) {
        price = regexResult.price;
        currencyCode = regexResult.currencyHint;
        extractionMethod = 'regex';
        console.log(`[extract-price] Regex extraction succeeded: ${price} ${currencyCode}`);
      }
    }

    // Strategy 4: OCR (only for standard mode, skip for problematic stores)
    const skipOcrStores: StoreType[] = ['shein', 'aliexpress'];
    if (!price && allowOcr && !skipOcrStores.includes(store)) {
      price = await extractWithOcr(formattedUrl, TIMEOUTS.ocr);
      if (price) {
        extractionMethod = 'ocr';
        console.log(`[extract-price] OCR extraction succeeded: ${price}`);
      }
    }

    // Fail fast if no price found
    if (!price) {
      const fallback = await getCatalogFallbackPrice(supabase, formattedUrl, normalizedUrl, store);
      if (fallback) {
        price = fallback.basePrice;
        currencyCode = 'USD';
        extractionMethod = 'catalog_fallback_no_price';
      } else {
        const duration = Date.now() - startTime;
        logData = { ...logData, status: 404, error: 'PRICE_NOT_FOUND', store, duration, triedMethods: ['jsonld', 'selector', 'regex', allowOcr ? 'ocr' : 'none', 'catalog_fallback'] };
        console.log(JSON.stringify(logData));
        
        // For dynamic content stores, suggest WebView fallback
        const isDynamicStore = DYNAMIC_CONTENT_STORES.includes(store);
        const errorCode = isDynamicStore ? 'DYNAMIC_CONTENT' : 'PRICE_NOT_FOUND';
        
        return new Response(
          JSON.stringify({
            ok: false,
            code: errorCode,
            message: isDynamicStore 
              ? `${store} requires manual viewing`
              : `Could not extract price from ${store}`,
            message_en: isDynamicStore 
              ? `${store} requires manual viewing. Please open the product page.`
              : `Could not extract price from ${store}. Try opening the page manually.`,
            message_fr: isDynamicStore 
              ? `${store} nécessite une consultation manuelle. Veuillez ouvrir la page.`
              : `Impossible d'extraire le prix de ${store}. Essayez d'ouvrir la page manuellement.`,
            retryable: false,
            webviewFallback: true,
            suggestedFallback: 'WEBVIEW',
          }),
          { status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }
        );
      }
    }

    // Extract product info
    const productInfo = extractProductInfo(html, store);

    // Determine currency
    const detectedCurrency = currencyCode
      ? { code: currencyCode, symbol: getCurrencySymbol(currencyCode) }
      : detectCurrency(html, formattedUrl);

    // Cache result to BOTH caches
    const cacheData = {
      store,
      basePrice: price,
      currencySymbol: detectedCurrency.symbol,
      rawCurrencyCode: detectedCurrency.code,
      title: productInfo.title,
      imageUrl: productInfo.imageUrl,
    };
    
    // Save to standard cache (4-48 hour TTL)
    await setCachedPrice(supabase, normalizedUrl, cacheData);
    
    // Save to hot cache (5-15 min TTL) for fast subsequent access
    saveToHotCache(supabase, normalizedUrl, store, {
      ...cacheData,
      lastFetchedAt: new Date().toISOString(),
    }).catch(() => {});

    // Persist to catalog_items permanently (fire-and-forget)
    saveToCatalogItems(supabase, store, formattedUrl, price, productInfo.title, productInfo.imageUrl).catch(() => {});

    logData = {
      ...logData,
      cacheHit: false,
      method: extractionMethod,
      priceFound: true,
      duration: Date.now() - startTime,
    };
    console.log(JSON.stringify(logData));

    const result: PriceResolveResponse = {
      url: normalizedUrl,
      store,
      basePrice: price,
      currencySymbol: detectedCurrency.symbol,
      rawCurrencyCode: detectedCurrency.code,
      title: productInfo.title,
      imageUrl: productInfo.imageUrl,
      cacheHit: false,
      lastFetchedAt: new Date().toISOString(),
    };

    return jsonSuccess(result);
  } catch (error) {
    logData = { ...logData, status: 500, error: 'INTERNAL_ERROR', duration: Date.now() - startTime };
    console.error('[extract-price] Error:', error);
    console.log(JSON.stringify(logData));
    return jsonError(500, ErrorCodes.INTERNAL_ERROR);
  }
});
