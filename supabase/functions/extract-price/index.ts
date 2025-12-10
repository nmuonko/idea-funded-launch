import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  normalizeUrl,
  isAllowedDomain,
  isPrivateUrl,
  detectStore,
  getTtlForStore,
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
  ],
  walmart: [
    '[itemprop="price"]',
    '.price-characteristic',
    '.prod-PriceHero .price-group',
    '[data-automation-id="product-price"]',
    '.price-main .visuallyhidden',
    '.price-main-block span',
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
  shein: [
    '.from.original',
    '.product-intro__head-price',
    '.goods-price__main-price',
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

// ============== TIMEOUT CONFIGURATION ==============

const TIMEOUTS = {
  fast: 6000,
  standard: 15000,
  ocr: 10000,
};

// ============== EXTRACTION METHODS ==============

interface ProductInfo {
  title: string | null;
  imageUrl: string | null;
}

function extractProductInfo(html: string, store: StoreType): ProductInfo {
  let title: string | null = null;
  let imageUrl: string | null = null;

  // Strategy 1: JSON-LD
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
              if (!title && item.name) title = String(item.name).trim();
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

  // Strategy 2: Meta tags
  if (!title) {
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitle) title = ogTitle[1].trim();
  }
  if (!imageUrl) {
    const ogImage = html.match(/<meta[^>]*property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i);
    if (ogImage) imageUrl = ogImage[1];
  }

  // Strategy 3: Title tag fallback
  if (!title) {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag) {
      title = titleTag[1]
        .replace(/\s*[-|–—]\s*(Amazon|Walmart|eBay|Best Buy|Target|SHEIN|Home Depot|Macy's|Carvana|CarGurus).*$/i, '')
        .trim();
    }
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
  const patterns = [
    { regex: /(?:\$|USD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi, currency: 'USD' },
    { regex: /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:USD|\$)/gi, currency: 'USD' },
    { regex: /(?:€|EUR)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/gi, currency: 'EUR' },
    { regex: /(?:£|GBP)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi, currency: 'GBP' },
    { regex: /(?:CDF|FC)\s*(\d{1,3}(?:[.,\s]\d{3})*)/gi, currency: 'CDF' },
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

// ============== CACHE FUNCTIONS ==============

interface CachedPrice {
  basePrice: number;
  currencySymbol: string;
  rawCurrencyCode: string;
  store: string;
  title: string | null;
  imageUrl: string | null;
  lastFetchedAt: string;
}

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

    // Check cache (unless forceRefresh)
    if (!forceRefresh) {
      const cached = await getCachedPrice(supabase, normalizedUrl, store);
      if (cached) {
        logData = { ...logData, cacheHit: true, duration: Date.now() - startTime };
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

    // Fetch page
    const fetchTimeout = mode === 'fast' ? TIMEOUTS.fast : TIMEOUTS.standard;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

    let response: Response;
    try {
      response = await fetch(formattedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logData = { ...logData, status: 408, error: 'TIMEOUT', duration: Date.now() - startTime };
        console.log(JSON.stringify(logData));
        return jsonError(408, ErrorCodes.TIMEOUT);
      }
      throw fetchError;
    }

    if (!response.ok) {
      logData = { ...logData, status: 502, error: 'SCRAPE_FAILED', httpStatus: response.status };
      console.log(JSON.stringify(logData));
      return jsonError(502, ErrorCodes.SCRAPE_FAILED);
    }

    const html = await response.text();
    let price: number | null = null;
    let currencyCode: string | null = null;
    let extractionMethod: string | null = null;

    // Strategy 1: JSON-LD
    const jsonLdResult = extractFromJsonLd(html);
    if (jsonLdResult) {
      price = jsonLdResult.price;
      currencyCode = jsonLdResult.currency ?? null;
      extractionMethod = 'jsonld';
    }

    // Strategy 2: Selectors
    if (!price) {
      price = extractFromSelectors(html, store);
      if (price) extractionMethod = 'selector';
    }

    // Strategy 3: Regex
    if (!price) {
      const regexResult = extractWithRegex(html);
      if (regexResult) {
        price = regexResult.price;
        currencyCode = regexResult.currencyHint;
        extractionMethod = 'regex';
      }
    }

    // Strategy 4: OCR (optional)
    if (!price && allowOcr) {
      price = await extractWithOcr(formattedUrl, TIMEOUTS.ocr);
      if (price) extractionMethod = 'ocr';
    }

    if (!price) {
      logData = { ...logData, status: 404, error: 'PRICE_NOT_FOUND', duration: Date.now() - startTime };
      console.log(JSON.stringify(logData));
      return jsonError(404, ErrorCodes.PRICE_NOT_FOUND);
    }

    // Extract product info
    const productInfo = extractProductInfo(html, store);

    // Determine currency
    const detectedCurrency = currencyCode
      ? { code: currencyCode, symbol: getCurrencySymbol(currencyCode) }
      : detectCurrency(html, formattedUrl);

    // Cache result
    await setCachedPrice(supabase, normalizedUrl, {
      store,
      basePrice: price,
      currencySymbol: detectedCurrency.symbol,
      rawCurrencyCode: detectedCurrency.code,
      title: productInfo.title,
      imageUrl: productInfo.imageUrl,
    });

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
