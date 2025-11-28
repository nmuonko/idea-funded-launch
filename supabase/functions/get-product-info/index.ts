import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  ],
  'bestbuy.com': [
    '.priceView-customer-price',
    '.priceView-hero-price',
  ],
  'ebay.com': [
    '.x-price-primary',
    '[itemprop="price"]',
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

  // Try to extract main image
  const imgMatch = html.match(/<img[^>]*(?:id|class)="[^"]*(?:main|product|hero)[^"]*"[^>]*src="([^"]+)"/i);
  if (imgMatch) {
    result.imageUrl = imgMatch[1];
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    
    // Multi-layer extraction
    let result: Partial<ProductInfo> = {};

    // 1. JSON-LD (most reliable)
    const jsonLdData = extractFromJsonLd(html);
    result = { ...result, ...jsonLdData };
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
    result = { ...result, ...embeddedData };
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
    result = { ...result, ...selectorData };
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

    console.log('[get-product-info] Could not extract price');
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

    const { productUrl } = await req.json();

    if (!productUrl) {
      return new Response(JSON.stringify({ error: 'productUrl is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Save to cache
    if (info.price !== null) {
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