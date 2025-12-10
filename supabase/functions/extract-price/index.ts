import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Store types
type StoreType = 'amazon' | 'walmart' | 'bestbuy' | 'ebay' | 'aliexpress' | 'target' | 'shein' | 'macys' | 'homedepot' | 'generic';

// Allowed domains for SSRF prevention
const ALLOWED_DOMAINS = [
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.es', 'amazon.it',
  'ebay.com', 'ebay.co.uk', 'ebay.de', 'ebay.fr',
  'walmart.com',
  'bestbuy.com',
  'target.com',
  'aliexpress.com', 'aliexpress.us',
  'shein.com',
  'macys.com',
  'homedepot.com',
  'lowes.com',
  'costco.com',
  'newegg.com',
  'carvana.com',
  'cargurus.com',
  'autotrader.com',
  'cars.com',
];

// Store-specific selectors (ordered by priority)
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

// Currency patterns
const CURRENCY_PATTERNS: Record<string, RegExp> = {
  USD: /\$|USD/i,
  EUR: /€|EUR/i,
  GBP: /£|GBP/i,
  CDF: /CDF|FC/i,
};

// ============== UTILITY FUNCTIONS ==============

function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url.trim());
    // Normalize: lowercase host, remove fragments, keep path and essential params
    let normalized = `${urlObj.protocol}//${urlObj.hostname.toLowerCase()}${urlObj.pathname}`;
    // Keep important query params for product identification
    const importantParams = ['id', 'asin', 'product', 'item', 'sku', 'pid'];
    const params = new URLSearchParams();
    for (const [key, value] of urlObj.searchParams) {
      if (importantParams.some(p => key.toLowerCase().includes(p))) {
        params.set(key, value);
      }
    }
    const paramStr = params.toString();
    if (paramStr) normalized += `?${paramStr}`;
    return normalized;
  } catch {
    return url.trim().toLowerCase();
  }
}

function detectStore(url: string): StoreType {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    
    if (host.includes('amazon.')) return 'amazon';
    if (host.includes('walmart.')) return 'walmart';
    if (host.includes('bestbuy.')) return 'bestbuy';
    if (host.includes('ebay.')) return 'ebay';
    if (host.includes('aliexpress.')) return 'aliexpress';
    if (host.includes('target.')) return 'target';
    if (host.includes('shein.')) return 'shein';
    if (host.includes('macys.')) return 'macys';
    if (host.includes('homedepot.')) return 'homedepot';
    
    return 'generic';
  } catch {
    return 'generic';
  }
}

function isAllowedDomain(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    return ALLOWED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

function isPrivateUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
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

function detectCurrency(text: string, url: string): string {
  // Check URL for domain hints
  if (url.includes('.co.uk') || url.includes('.uk')) return 'GBP';
  if (url.includes('.de') || url.includes('.fr') || url.includes('.it') || url.includes('.es')) return 'EUR';
  
  // Check text for currency symbols
  if (CURRENCY_PATTERNS.GBP.test(text)) return 'GBP';
  if (CURRENCY_PATTERNS.EUR.test(text)) return 'EUR';
  if (CURRENCY_PATTERNS.CDF.test(text)) return 'CDF';
  
  return 'USD';
}

function cleanPriceString(rawText: string): number | null {
  if (!rawText || typeof rawText !== 'string') return null;
  
  // Remove currency symbols, whitespace, non-breaking spaces
  let cleaned = rawText
    .replace(/[$€£¥₹₦\u00A0\s]/g, '')
    .replace(/USD|EUR|GBP|CDF|FC/gi, '')
    .trim();
  
  if (!cleaned) return null;
  
  // Handle different number formats
  // US format: 1,299.99 (comma = thousands, dot = decimal)
  // EU format: 1.299,99 (dot = thousands, comma = decimal)
  
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  
  if (hasComma && hasDot) {
    // Both present - determine which is decimal
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // EU format: 1.299,99
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,299.99
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // Only comma - check if it's decimal or thousands
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Likely EU decimal: 299,99
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely thousands: 1,299
      cleaned = cleaned.replace(/,/g, '');
    }
  }
  // If only dot or neither, it's already in correct format
  
  const price = parseFloat(cleaned);
  
  // Validate: positive, finite, reasonable range
  if (isNaN(price) || !isFinite(price) || price <= 0 || price > 1000000) {
    return null;
  }
  
  return Math.round(price * 100) / 100;
}

function formatDisplayPrice(price: number, currency: string): string {
  const symbols: Record<string, string> = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'CDF': 'CDF ',
  };
  const symbol = symbols[currency] || '$';
  
  if (currency === 'CDF') {
    return `${symbol}${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  return `${symbol}${price.toFixed(2)}`;
}

// ============== EXTRACTION METHODS ==============

function extractFromJsonLd(html: string): number | null {
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
                if (offer.price !== undefined) {
                  const price = cleanPriceString(String(offer.price));
                  if (price) return price;
                }
                if (offer.lowPrice !== undefined) {
                  const price = cleanPriceString(String(offer.lowPrice));
                  if (price) return price;
                }
              }
            }
          }
        }
      } catch {
        // Invalid JSON, continue
      }
    }
  } catch {
    // Extraction failed
  }
  return null;
}

function extractFromSelectors(html: string, store: StoreType): number | null {
  // Get store-specific selectors first, then generic
  const selectors = [
    ...(STORE_SELECTORS[store] || []),
    ...STORE_SELECTORS.generic,
  ];
  
  for (const selector of selectors) {
    let pattern: RegExp | null = null;
    
    if (selector.startsWith('#')) {
      // ID selector
      const id = selector.slice(1).split(/[\s.[\]]/)[0];
      pattern = new RegExp(`id=["']${id}["'][^>]*>([^<]*(?:<[^>]*>[^<]*)*)`, 'i');
    } else if (selector.startsWith('.')) {
      // Class selector
      const className = selector.slice(1).split(/[\s.[\]]/)[0];
      pattern = new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([^<]*(?:<[^>]*>[^<]*)*)`, 'i');
    } else if (selector.startsWith('[')) {
      // Attribute selector
      const attrMatch = selector.match(/\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]/);
      if (attrMatch) {
        const attr = attrMatch[1];
        const value = attrMatch[2];
        if (value) {
          pattern = new RegExp(`${attr}=["']${value}["'][^>]*>([^<]*)`, 'i');
        } else {
          // Just check for attribute presence
          pattern = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
        }
      }
    }
    
    if (pattern) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const price = cleanPriceString(match[1]);
        if (price) {
          console.log(`Found price ${price} using selector: ${selector}`);
          return price;
        }
      }
    }
  }
  
  return null;
}

function extractWithRegex(html: string): { price: number; currencyHint: string } | null {
  // Multiple regex patterns for price extraction
  const patterns = [
    // Pattern: $199.99 or USD 199.99
    { regex: /(?:\$|USD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi, currency: 'USD' },
    // Pattern: 199.99 USD
    { regex: /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:USD|\$)/gi, currency: 'USD' },
    // Pattern: €199.99 or EUR 199.99
    { regex: /(?:€|EUR)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/gi, currency: 'EUR' },
    // Pattern: £199.99 or GBP 199.99
    { regex: /(?:£|GBP)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi, currency: 'GBP' },
    // Pattern: CDF 350,000 or FC 350000
    { regex: /(?:CDF|FC)\s*(\d{1,3}(?:[.,\s]\d{3})*)/gi, currency: 'CDF' },
    // Pattern: price="199.99" or data-price="199.99"
    { regex: /(?:data-)?price=["'](\d+(?:\.\d{1,2})?)["']/gi, currency: 'USD' },
    // Pattern: "price":199.99 or "price":"199.99"
    { regex: /"price":\s*["']?(\d+(?:\.\d{1,2})?)["']?/gi, currency: 'USD' },
  ];
  
  const candidates: { price: number; currency: string }[] = [];
  
  for (const { regex, currency } of patterns) {
    let match;
    regex.lastIndex = 0; // Reset regex
    while ((match = regex.exec(html)) !== null) {
      const price = cleanPriceString(match[1]);
      if (price && price > 0.01 && price < 100000) {
        candidates.push({ price, currency });
      }
    }
  }
  
  if (candidates.length === 0) return null;
  
  // Return the most common price, preferring USD
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
  
  console.log(`Found price ${bestPrice} (${bestCurrency}) using regex fallback`);
  return { price: bestPrice, currencyHint: bestCurrency };
}

async function extractWithOcr(url: string, timeout: number): Promise<number | null> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  if (!firecrawlApiKey) {
    console.log('FIRECRAWL_API_KEY not configured, skipping OCR fallback');
    return null;
  }
  
  try {
    console.log('Attempting OCR fallback via Firecrawl...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Use Firecrawl to scrape with screenshot
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error('Firecrawl request failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.success || !data.markdown) {
      console.log('Firecrawl returned no content');
      return null;
    }
    
    // Parse the markdown content for prices
    const result = extractWithRegex(data.markdown);
    if (result) {
      console.log(`OCR fallback found price: ${result.price}`);
      return result.price;
    }
    
    return null;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('OCR request timed out');
    } else {
      console.error('OCR fallback error:', error);
    }
    return null;
  }
}

// ============== TIMEOUT CONFIGURATION ==============

const TIMEOUTS = {
  fast: 6000,      // 6 seconds for fast mode
  standard: 15000, // 15 seconds for standard mode
  ocr: 10000,      // 10 seconds max for OCR
};

// ============== CACHE FUNCTIONS ==============

async function getCachedPrice(supabase: any, normalizedUrl: string): Promise<{
  basePrice: number;
  displayPrice: string;
  currency: string;
  store: string;
} | null> {
  try {
    const { data, error } = await supabase
      .from('price_cache')
      .select('base_price, display_price, currency, store')
      .eq('url', normalizedUrl)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    
    if (error || !data) return null;
    
    return {
      basePrice: Number(data.base_price),
      displayPrice: data.display_price,
      currency: data.currency,
      store: data.store,
    };
  } catch {
    return null;
  }
}

async function setCachedPrice(
  supabase: any,
  normalizedUrl: string,
  store: string,
  basePrice: number,
  currency: string,
  displayPrice: string
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 12); // 12 hour TTL
    
    await supabase
      .from('price_cache')
      .upsert({
        url: normalizedUrl,
        store,
        base_price: basePrice,
        currency,
        display_price: displayPrice,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: 'url',
      });
  } catch (error) {
    console.error('Failed to cache price:', error);
  }
}

// ============== MAIN HANDLER ==============

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only accept POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, message: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { url, allowOcr = false, mode = 'standard' } = body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, message: "Please provide a valid product URL." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine timeout based on mode
    const fetchTimeout = mode === 'fast' ? TIMEOUTS.fast : TIMEOUTS.standard;

    // Format URL
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    // Security checks
    if (isPrivateUrl(formattedUrl)) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid URL provided." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isAllowedDomain(formattedUrl)) {
      return new Response(
        JSON.stringify({ success: false, message: "This store is not supported yet. Please try Amazon, Walmart, eBay, BestBuy, or other major retailers." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Normalize URL for caching
    const normalizedUrl = normalizeUrl(formattedUrl);
    const store = detectStore(formattedUrl);

    console.log(`Processing price extraction for: ${formattedUrl}`);
    console.log(`Mode: ${mode}, allowOcr: ${allowOcr}, timeout: ${fetchTimeout}ms`);
    console.log(`Detected store: ${store}`);

    // Check cache first
    const cached = await getCachedPrice(supabase, normalizedUrl);
    if (cached) {
      console.log('Returning cached price');
      return new Response(
        JSON.stringify({
          success: true,
          basePrice: cached.basePrice,
          displayPrice: cached.displayPrice,
          currency: cached.currency,
          store: cached.store,
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the page with timeout
    console.log('Fetching page HTML...');
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
        console.log(`Fetch timed out after ${fetchTimeout}ms`);
        return new Response(
          JSON.stringify({ success: false, message: "Request timed out. Please try again." }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw fetchError;
    }

    if (!response.ok) {
      console.error(`Failed to fetch URL: ${response.status}`);
      return new Response(
        JSON.stringify({ success: false, message: "We couldn't reach this product page. Please try again." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();
    let price: number | null = null;
    let currencyFromExtraction: string | null = null;
    let extractionMethod: string | null = null;

    // Strategy 1: JSON-LD structured data (most reliable)
    console.log('Trying JSON-LD extraction...');
    price = extractFromJsonLd(html);
    if (price) {
      extractionMethod = 'jsonld';
      console.log(`Price found via JSON-LD: ${price}`);
    }

    // Strategy 2: Store-specific + generic CSS selectors
    if (!price) {
      console.log('Trying selector extraction...');
      price = extractFromSelectors(html, store);
      if (price) {
        extractionMethod = 'selector';
        console.log(`Price found via selectors: ${price}`);
      }
    }

    // Strategy 3: Regex fallback
    if (!price) {
      console.log('Trying regex fallback...');
      const regexResult = extractWithRegex(html);
      if (regexResult) {
        price = regexResult.price;
        currencyFromExtraction = regexResult.currencyHint;
        extractionMethod = 'regex';
        console.log(`Price found via regex: ${price}`);
      }
    }

    // Strategy 4: OCR fallback (only if explicitly requested)
    if (!price && allowOcr) {
      console.log('Trying OCR fallback (explicitly requested)...');
      price = await extractWithOcr(formattedUrl, TIMEOUTS.ocr);
      if (price) {
        extractionMethod = 'ocr';
        console.log(`Price found via OCR: ${price}`);
      }
    } else if (!price) {
      console.log('Skipping OCR (allowOcr=false)');
    }

    // Return result
    if (price) {
      const currency = currencyFromExtraction || detectCurrency(html, formattedUrl);
      const displayPrice = formatDisplayPrice(price, currency);
      
      // Cache the result
      await setCachedPrice(supabase, normalizedUrl, store, price, currency, displayPrice);
      
      console.log(`Successfully extracted price: ${displayPrice} from ${store} via ${extractionMethod}`);
      
      return new Response(
        JSON.stringify({
          success: true,
          basePrice: price,
          displayPrice: displayPrice,
          currency: currency,
          store: store,
          cached: false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No price found after all methods
    console.log('No price found on page after all extraction methods');
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: "We couldn't detect a price on this page. Please try again or choose a different product." 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error extracting price:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: "We couldn't extract the price for this product. Please try again." 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
