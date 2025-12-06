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
  'carvana.com', 'www.carvana.com',
  'cargurus.com', 'www.cargurus.com',
  'target.com', 'www.target.com',
  'homedepot.com', 'www.homedepot.com',
  'shein.com', 'www.shein.com', 'us.shein.com', 'm.shein.com',
  'macys.com', 'www.macys.com', 'm.macys.com',
];

// Block private/internal IP ranges
function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // Block localhost and common internal hostnames
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
    
    // Block private IP ranges
    const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Pattern);
    if (match) {
      const [, a, b] = match.map(Number);
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 169 && b === 254) return true; // Link-local
    }
    
    return false;
  } catch {
    return true;
  }
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
  source: 'api' | 'jsonld' | 'json' | 'selectors' | 'cached' | 'unknown';
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
  'shein.com': [
    '.product-intro__head-price',
    '.original.from',
    '[class*="productPrice"]',
  ],
  'macys.com': [
    '.price .regular-price',
    '.lowest-sale-price',
    '[data-auto="product-price"]',
  ],
};

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^0-9.,]/g, '').replace(',', '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

async function checkCache(supabase: any, url: string): Promise<ProductInfo | null> {
  const { data, error } = await supabase
    .from('product_cache')
    .select('*')
    .eq('product_url', url)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return null;

  console.log('[get-product-info] Cache hit for:', url);
  return {
    title: data.title,
    imageUrl: data.image_url,
    price: data.price ? parseFloat(data.price) : null,
    currency: data.currency || 'USD',
    source: 'cached',
  };
}

async function saveToCache(supabase: any, url: string, info: ProductInfo) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await supabase
    .from('product_cache')
    .upsert({
      product_url: url,
      title: info.title,
      image_url: info.imageUrl,
      price: info.price,
      currency: info.currency,
      source: info.source,
      expires_at: expiresAt.toISOString(),
    }, { onConflict: 'product_url' });

  console.log('[get-product-info] Saved to cache:', url);
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
  console.log('[get-product-info] Scraping:', url);
  const domain = extractDomain(url);
  console.log('[get-product-info] Domain:', domain);

  try {
    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    
    // Multi-layer extraction
    let result: Partial<ProductInfo> = {};

    // ALWAYS try to extract image first using og:image (highest priority)
    const ogImage = extractImageUrl(html, domain);
    if (ogImage) {
      result.imageUrl = ogImage;
      console.log('[get-product-info] Found image URL:', ogImage.substring(0, 100));
    }

    // 1. JSON-LD (most reliable for structured data)
    const jsonLdData = extractFromJsonLd(html);
    result = { ...jsonLdData, ...result }; // Keep og:image if we found it
    if (!result.imageUrl && jsonLdData.imageUrl) {
      result.imageUrl = jsonLdData.imageUrl;
    }
    
    if (jsonLdData.price) {
      console.log('[get-product-info] Extracted from JSON-LD');
      return {
        title: result.title || null,
        imageUrl: result.imageUrl || null,
        price: result.price || null,
        currency: result.currency || 'USD',
        source: 'jsonld',
      };
    }

    // 2. Embedded JSON
    const embeddedData = extractFromEmbeddedJson(html);
    if (embeddedData.title && !result.title) result.title = embeddedData.title;
    if (embeddedData.imageUrl && !result.imageUrl) result.imageUrl = embeddedData.imageUrl;
    if (embeddedData.price) result.price = embeddedData.price;
    if (embeddedData.currency) result.currency = embeddedData.currency;
    
    if (embeddedData.price) {
      console.log('[get-product-info] Extracted from embedded JSON');
      return {
        title: result.title || null,
        imageUrl: result.imageUrl || null,
        price: result.price || null,
        currency: result.currency || 'USD',
        source: 'json',
      };
    }

    // 3. CSS Selectors
    const selectorData = extractFromSelectors(html, domain);
    if (selectorData.title && !result.title) result.title = selectorData.title;
    if (selectorData.imageUrl && !result.imageUrl) result.imageUrl = selectorData.imageUrl;
    if (selectorData.price) result.price = selectorData.price;
    
    if (selectorData.price) {
      console.log('[get-product-info] Extracted from CSS selectors');
      return {
        title: result.title || null,
        imageUrl: result.imageUrl || null,
        price: result.price || null,
        currency: result.currency || 'USD',
        source: 'selectors',
      };
    }

    console.log('[get-product-info] Could not extract price, returning partial data');
    return {
      title: result.title || null,
      imageUrl: result.imageUrl || null,
      price: null,
      currency: 'USD',
      source: 'unknown',
    };

  } catch (error: any) {
    console.error('[get-product-info] Scraping error:', error.message);
    return {
      title: null,
      imageUrl: null,
      price: null,
      currency: 'USD',
      source: 'unknown',
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json();

    // Validate input with zod schema (SSRF prevention)
    const parseResult = productInfoSchema.safeParse({ productUrl: body.productUrl || body.url });
    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors.map(e => e.message).join(', ');
      console.log('[get-product-info] Validation error:', errorMessage);
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { productUrl } = parseResult.data;
    console.log('[get-product-info] Request for:', productUrl);

    // Check cache first
    const cached = await checkCache(supabaseClient, productUrl);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Scrape product info
    const info = await scrapeProduct(productUrl);

    // Save to cache if we got any useful data (price OR image)
    if (info.price !== null || info.imageUrl !== null || info.title !== null) {
      await saveToCache(supabaseClient, productUrl, info);
    }

    return new Response(JSON.stringify(info), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[get-product-info] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});