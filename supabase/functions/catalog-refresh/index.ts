/**
 * Catalog Refresh Edge Function
 * 
 * Fetches bestseller products from Rainforest API and upserts to catalog_items.
 * Triggered by cron schedule or manual admin call.
 * 
 * Protected by CRON_SECRET header for scheduled invocation.
 * 
 * POST /catalog-refresh
 * Headers: x-cron-secret: <CRON_SECRET>
 * Body: { "categories": ["phones", "computers"] } (optional - defaults to all)
 */

import { createClient } from "@supabase/supabase-js";
import { verifyCronAuth, cronAuthErrorResponse } from '../_shared/cronAuth.ts';
import { mapUnifiedCategory } from '../_shared/categoryMapper.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Category mapping: slug → Amazon Bestseller URL path
const CATEGORY_URLS: Record<string, { url: string; category: string }> = {
  phones: {
    url: 'https://www.amazon.com/Best-Sellers-Cell-Phones-Accessories/zgbs/wireless',
    category: 'phones',
  },
  tablets: {
    url: 'https://www.amazon.com/Best-Sellers-Computers-Accessories-Tablets/zgbs/pc/1232597011',
    category: 'tablets',
  },
  computers: {
    url: 'https://www.amazon.com/Best-Sellers-Computers-Accessories-Laptops/zgbs/pc/565108',
    category: 'computers',
  },
  monitors: {
    url: 'https://www.amazon.com/Best-Sellers-Electronics-Computer-Monitors/zgbs/electronics/1292115011',
    category: 'monitors',
  },
  audio: {
    url: 'https://www.amazon.com/Best-Sellers-Electronics-Headphones/zgbs/electronics/172541',
    category: 'audio',
  },
  gaming: {
    url: 'https://www.amazon.com/Best-Sellers-Video-Games/zgbs/videogames',
    category: 'gaming',
  },
  accessories: {
    url: 'https://www.amazon.com/Best-Sellers-Electronics-Computer-Accessories/zgbs/electronics/172456',
    category: 'accessories',
  },
};

interface RainforestProduct {
  asin?: string;
  title?: string;
  link?: string;
  image?: string;
  images?: Array<{ link?: string }>;
  price?: { value?: number; raw?: string };
  rating?: number;
  ratings_total?: number;
  availability?: { raw?: string };
  brand?: string;
}

interface CatalogItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string | null;
  price_usd: number | null;
  image_url: string | null;
  images: string[];
  product_url: string | null;
  in_stock: boolean | null;
  rating: number | null;
  review_count: number | null;
  brand: string | null;
  category_key: string;
  unified_category: string;
  tags: string[];
  raw: unknown;
}

function normalizeProduct(product: RainforestProduct, categoryKey: string): CatalogItem | null {
  if (!product.asin) return null;

  const id = `rainforest:${product.asin}`;
  const title = product.title || null;
  
  // Extract price
  let priceUsd: number | null = null;
  if (product.price?.value && product.price.value > 0) {
    priceUsd = product.price.value;
  }

  // Extract images
  const images: string[] = [];
  if (product.image) {
    images.push(product.image.replace(/^http:/, 'https:'));
  }
  if (product.images) {
    for (const img of product.images) {
      if (img.link) {
        const normalized = img.link.replace(/^http:/, 'https:');
        if (!images.includes(normalized)) {
          images.push(normalized);
        }
      }
    }
  }

  // Check stock
  const inStock = product.availability?.raw
    ? !product.availability.raw.toLowerCase().includes('unavailable')
    : null;

  // Compute unified_category using categoryMapper
  const unifiedCategory = mapUnifiedCategory({
    title: title || undefined,
    provider: 'rainforest',
    productUrl: product.link || `https://www.amazon.com/dp/${product.asin}`,
  });

  // Skip blocked items
  if (unifiedCategory === 'blocked') {
    console.log(`[REFRESH] Skipping blocked item: ${title?.slice(0, 50)}`);
    return null;
  }

  // Build tags from title and category
  const tags: string[] = [categoryKey];
  if (product.brand) {
    tags.push(product.brand.toLowerCase());
  }

  return {
    id,
    provider: 'rainforest',
    provider_product_id: product.asin,
    title,
    price_usd: priceUsd,
    image_url: images[0] || null,
    images,
    product_url: product.link || `https://www.amazon.com/dp/${product.asin}`,
    in_stock: inStock,
    rating: product.rating || null,
    review_count: product.ratings_total || null,
    brand: product.brand || null,
    category_key: categoryKey,
    unified_category: unifiedCategory,
    tags,
    raw: product,
  };
}

async function fetchBestsellers(
  apiKey: string,
  categorySlug: string,
  categoryConfig: { url: string; category: string }
): Promise<CatalogItem[]> {
  console.log(`[REFRESH] Fetching bestsellers for ${categorySlug}`);
  
  const params = new URLSearchParams({
    api_key: apiKey,
    type: 'bestsellers',
    url: categoryConfig.url,
    amazon_domain: 'amazon.com',
    output: 'json',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`https://api.rainforestapi.com/request?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[REFRESH] Rainforest API error for ${categorySlug}:`, errorText);
      throw new Error(`Rainforest API error: ${response.status}`);
    }

    const data = await response.json();
    const products: RainforestProduct[] = data.bestsellers || [];
    
    console.log(`[REFRESH] Got ${products.length} products for ${categorySlug}`);
    
    const items: CatalogItem[] = [];
    for (const product of products.slice(0, 20)) { // Max 20 per category
      const normalized = normalizeProduct(product, categoryConfig.category);
      if (normalized) {
        items.push(normalized);
      }
    }
    
    return items;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const rainforestApiKey = Deno.env.get('RAINFOREST_API_KEY');

  // Auth: Either cron secret OR admin user
  const cronAuth = verifyCronAuth(req);
  let isAuthorized = cronAuth.authorized;
  
  if (!isAuthorized) {
    // Check for admin auth
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      if (user) {
        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();
        isAuthorized = !!roles;
      }
    }
  }

  if (!isAuthorized) {
    return cronAuthErrorResponse('Unauthorized: Requires cron secret or admin token');
  }

  if (!rainforestApiKey) {
    return new Response(
      JSON.stringify({ success: false, error: 'RAINFOREST_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Parse request body for optional category filter
  let targetCategories = Object.keys(CATEGORY_URLS);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.categories && Array.isArray(body.categories)) {
      targetCategories = body.categories.filter((c: string) => CATEGORY_URLS[c]);
    }
  } catch {
    // Use all categories
  }

  console.log(`[REFRESH] Starting refresh for categories: ${targetCategories.join(', ')}`);

  const results: Record<string, { fetched: number; upserted: number; error?: string }> = {};
  const allItems: CatalogItem[] = [];
  const categoryItems: Record<string, string[]> = {};

  for (const slug of targetCategories) {
    const config = CATEGORY_URLS[slug];
    
    // Create job record
    const { data: job } = await supabase
      .from('catalog_refresh_jobs')
      .insert({
        slug,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    try {
      const items = await fetchBestsellers(rainforestApiKey, slug, config);
      
      // Upsert items
      if (items.length > 0) {
        const { error: upsertError } = await supabase
          .from('catalog_items')
          .upsert(
            items.map(item => ({
              ...item,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: 'id' }
          );

        if (upsertError) {
          throw new Error(`Upsert failed: ${upsertError.message}`);
        }
      }

      // Track item IDs for collection
      categoryItems[slug] = items.map(i => i.id);
      allItems.push(...items);

      results[slug] = { fetched: items.length, upserted: items.length };

      // Update job
      if (job?.id) {
        await supabase
          .from('catalog_refresh_jobs')
          .update({
            status: 'ok',
            completed_at: new Date().toISOString(),
            items_fetched: items.length,
            items_upserted: items.length,
          })
          .eq('id', job.id);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[REFRESH] Error for ${slug}:`, errorMsg);
      results[slug] = { fetched: 0, upserted: 0, error: errorMsg };

      if (job?.id) {
        await supabase
          .from('catalog_refresh_jobs')
          .update({
            status: 'error',
            completed_at: new Date().toISOString(),
            last_error: errorMsg,
          })
          .eq('id', job.id);
      }
    }

    // Rate limit: wait 500ms between categories
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Update collections with item IDs
  for (const [slug, itemIds] of Object.entries(categoryItems)) {
    if (itemIds.length > 0) {
      await supabase
        .from('catalog_collections')
        .update({
          item_ids: itemIds,
          updated_at: new Date().toISOString(),
        })
        .eq('slug', slug);
    }
  }

  // Build trending_electronics from top items of each category
  const trendingIds: string[] = [];
  for (const slug of ['phones', 'computers', 'audio', 'monitors', 'tablets', 'gaming']) {
    const catItems = categoryItems[slug] || [];
    trendingIds.push(...catItems.slice(0, 15)); // Top 15 from each
  }
  
  if (trendingIds.length > 0) {
    await supabase
      .from('catalog_collections')
      .update({
        item_ids: trendingIds.slice(0, 100), // Max 100 trending
        updated_at: new Date().toISOString(),
      })
      .eq('slug', 'trending_electronics');
  }

  console.log(`[REFRESH] Complete. Total items: ${allItems.length}`);

  return new Response(
    JSON.stringify({
      success: true,
      results,
      totalItems: allItems.length,
      trendingCount: Math.min(trendingIds.length, 100),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
