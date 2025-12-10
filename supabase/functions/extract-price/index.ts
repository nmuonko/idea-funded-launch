const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Allowed domains for SSRF prevention
const ALLOWED_DOMAINS = [
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca',
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

// Universal price selectors covering all major stores
const PRICE_SELECTORS = [
  // Amazon-specific
  '[data-asin-price]',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#priceblock_saleprice',
  '.a-price .a-offscreen',
  '#corePrice_feature_div .a-price-whole',
  '#apex_offerDisplay_desktop .a-price .a-offscreen',
  '.priceToPay .a-offscreen',
  '#price_inside_buybox',
  
  // eBay-specific
  '.x-price-primary span',
  '.x-bin-price__content .ux-textspans',
  '[itemprop="price"]',
  '.vi-price',
  
  // Walmart-specific
  '[itemprop="price"]',
  '[data-automation-id="product-price"] .f2',
  '.price-characteristic',
  '.prod-PriceHero',
  
  // BestBuy-specific
  '.priceView-customer-price span',
  '.priceView-hero-price span',
  '[data-testid="customer-price"] span',
  
  // Target-specific
  '[data-test="product-price"]',
  '.styles__CurrentPriceFontSize-sc',
  
  // AliExpress-specific
  '.product-price-value',
  '.uniform-banner-box-price',
  '.snow-price_SnowPrice__mainS__18x8np',
  
  // Generic patterns (work across many sites)
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
  '.pdp-price',
  '.product__price',
  '.ProductPrice',
  
  // SHEIN-specific
  '.from.original',
  '.product-intro__head-price',
  
  // Macy's-specific
  '.price .lowest-sale-price',
  '.price-sales',
  
  // Home Depot / Lowes
  '.price-format__main-price',
  '.art-pd-price',
];

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
    
    // Check for localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    
    // Check for private IP ranges
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

function cleanPriceString(priceStr: string): number | null {
  if (!priceStr || typeof priceStr !== 'string') return null;
  
  // Remove currency symbols and clean up
  let cleaned = priceStr
    .replace(/[$€£¥₹₦CDF\s]/gi, '')
    .replace(/USD|EUR|GBP|JPY/gi, '')
    .trim();
  
  // Handle different number formats
  // Format: 1,299.99 (US) or 1.299,99 (EU)
  const usFormat = cleaned.match(/^(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)$/);
  const euFormat = cleaned.match(/^(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)$/);
  
  if (usFormat) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (euFormat) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Simple cleanup for other formats
    cleaned = cleaned.replace(/,/g, '');
  }
  
  const price = parseFloat(cleaned);
  
  // Validate: must be positive, finite, and reasonable (under $1M)
  if (isNaN(price) || !isFinite(price) || price <= 0 || price > 1000000) {
    return null;
  }
  
  return Math.round(price * 100) / 100;
}

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
          // Check for Product schema
          if (item['@type'] === 'Product' || item['@type']?.includes('Product')) {
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

function extractFromSelectors(html: string): number | null {
  for (const selector of PRICE_SELECTORS) {
    // Build regex patterns for common selector types
    let pattern: RegExp | null = null;
    
    if (selector.startsWith('#')) {
      // ID selector
      const id = selector.slice(1).split(' ')[0].split('.')[0];
      pattern = new RegExp(`id=["']${id}["'][^>]*>([^<]*(?:<[^>]*>[^<]*)*?)`, 'i');
    } else if (selector.startsWith('.')) {
      // Class selector
      const className = selector.slice(1).split(' ')[0].split('.')[0];
      pattern = new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>([^<]*(?:<[^>]*>[^<]*)*?)`, 'i');
    } else if (selector.startsWith('[')) {
      // Attribute selector
      const attrMatch = selector.match(/\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]/);
      if (attrMatch) {
        const attr = attrMatch[1];
        const value = attrMatch[2];
        if (value) {
          pattern = new RegExp(`${attr}=["']${value}["'][^>]*>([^<]*)`, 'i');
        } else {
          pattern = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
        }
      }
    }
    
    if (pattern) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const price = cleanPriceString(match[1]);
        if (price) {
          console.log(`Found price ${price} using selector pattern: ${selector}`);
          return price;
        }
      }
    }
  }
  
  return null;
}

function extractWithRegex(html: string): number | null {
  // Multiple regex patterns for price extraction
  const patterns = [
    // Pattern: $199.99 or USD 199.99
    /(?:\$|USD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi,
    // Pattern: 199.99 USD
    /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:USD|\$)/gi,
    // Pattern: €199.99 or EUR 199.99
    /(?:€|EUR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi,
    // Pattern: £199.99 or GBP 199.99
    /(?:£|GBP)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi,
    // Pattern: price="199.99" or data-price="199.99"
    /(?:data-)?price=["'](\d+(?:\.\d{1,2})?)["']/gi,
    // Pattern: "price":199.99 or "price":"199.99"
    /"price":\s*["']?(\d+(?:\.\d{1,2})?)["']?/gi,
  ];
  
  const candidates: number[] = [];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const price = cleanPriceString(match[1]);
      if (price && price > 0.01 && price < 100000) {
        candidates.push(price);
      }
    }
  }
  
  if (candidates.length === 0) return null;
  
  // Return the most common price, or the first reasonable one
  const priceCounts = new Map<number, number>();
  for (const price of candidates) {
    priceCounts.set(price, (priceCounts.get(price) || 0) + 1);
  }
  
  let bestPrice = candidates[0];
  let bestCount = 0;
  for (const [price, count] of priceCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestPrice = price;
    }
  }
  
  console.log(`Found price ${bestPrice} using regex fallback`);
  return bestPrice;
}

function detectCurrency(html: string, url: string): string {
  // Check URL for hints
  if (url.includes('.co.uk') || url.includes('.uk')) return 'GBP';
  if (url.includes('.de') || url.includes('.fr') || url.includes('.it') || url.includes('.es')) return 'EUR';
  
  // Check HTML content
  if (html.includes('£') || html.includes('GBP')) return 'GBP';
  if (html.includes('€') || html.includes('EUR')) return 'EUR';
  
  // Default to USD
  return 'USD';
}

function formatDisplayPrice(price: number, currency: string): string {
  const symbols: Record<string, string> = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
  };
  const symbol = symbols[currency] || '$';
  return `${symbol}${price.toFixed(2)}`;
}

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

    const { url } = await req.json();

    // Validate URL
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, message: "Please provide a valid product URL." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    console.log(`Extracting price from: ${formattedUrl}`);

    // Fetch the page
    const response = await fetch(formattedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch URL: ${response.status}`);
      return new Response(
        JSON.stringify({ success: false, message: "We couldn't access this product page. Please check the URL and try again." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();
    let price: number | null = null;

    // Strategy 1: JSON-LD structured data (most reliable)
    price = extractFromJsonLd(html);
    if (price) {
      console.log(`Price found via JSON-LD: ${price}`);
    }

    // Strategy 2: CSS selectors
    if (!price) {
      price = extractFromSelectors(html);
      if (price) {
        console.log(`Price found via selectors: ${price}`);
      }
    }

    // Strategy 3: Regex fallback
    if (!price) {
      price = extractWithRegex(html);
      if (price) {
        console.log(`Price found via regex: ${price}`);
      }
    }

    // Return result
    if (price) {
      const currency = detectCurrency(html, formattedUrl);
      const displayPrice = formatDisplayPrice(price, currency);
      
      console.log(`Successfully extracted price: ${displayPrice}`);
      
      return new Response(
        JSON.stringify({
          success: true,
          basePrice: price,
          displayPrice: displayPrice,
          currency: currency,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No price found
    console.log('No price found on page');
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: "We couldn't extract the price for this product. Please try again or enter the price manually." 
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
