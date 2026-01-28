// Cleanup expired cache entries from price_cache, product_cache, and product_hot_cache tables
// Triggered via cron job (every 5-15 minutes) or manually by admin

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[cleanup-expired-caches] Starting cache cleanup');

    // 1. Clean HOT CACHE (product_hot_cache) - most important, runs every 5 min
    const { error: hotCacheError } = await supabase.rpc('clean_expired_hot_cache');
    if (hotCacheError) {
      console.error('[cleanup-expired-caches] Error cleaning hot cache:', hotCacheError);
    } else {
      console.log('[cleanup-expired-caches] Hot cache cleaned successfully');
    }

    // 2. Clean PRICE CACHE
    const { error: priceCacheError } = await supabase.rpc('clean_expired_price_cache');
    if (priceCacheError) {
      console.error('[cleanup-expired-caches] Error cleaning price cache:', priceCacheError);
    } else {
      console.log('[cleanup-expired-caches] Price cache cleaned successfully');
    }

    // 3. Clean PRODUCT CACHE
    const { error: productCacheError } = await supabase.rpc('clean_expired_product_cache');
    if (productCacheError) {
      console.error('[cleanup-expired-caches] Error cleaning product cache:', productCacheError);
    } else {
      console.log('[cleanup-expired-caches] Product cache cleaned successfully');
    }

    // 4. Clean SEARCH CACHE (entries older than 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { error: searchCacheError } = await supabase
      .from('catalog_search_cache')
      .delete()
      .lt('updated_at', twoHoursAgo);
    
    if (searchCacheError) {
      console.error('[cleanup-expired-caches] Error cleaning search cache:', searchCacheError);
    } else {
      console.log('[cleanup-expired-caches] Search cache cleaned successfully');
    }

    // 5. Clean CATALOG_CACHE expired entries (including negative cache)
    const now = new Date().toISOString();
    const { error: catalogCacheError, count: catalogCacheDeleted } = await supabase
      .from('catalog_cache')
      .delete()
      .lt('expires_at', now);
    
    if (catalogCacheError) {
      console.error('[cleanup-expired-caches] Error cleaning catalog_cache:', catalogCacheError);
    } else {
      console.log(`[cleanup-expired-caches] Catalog cache cleaned: ${catalogCacheDeleted || 0} entries removed`);
    }

    // Get counts for logging
    const [hotCacheResult, priceCacheResult, productCacheResult, searchCacheResult, catalogCacheResult] = await Promise.all([
      supabase.from('product_hot_cache').select('id', { count: 'exact', head: true }),
      supabase.from('price_cache').select('id', { count: 'exact', head: true }),
      supabase.from('product_cache').select('id', { count: 'exact', head: true }),
      supabase.from('catalog_search_cache').select('id', { count: 'exact', head: true }),
      supabase.from('catalog_cache').select('cache_key', { count: 'exact', head: true }),
    ]);

    const duration = Date.now() - startTime;

    const result = {
      success: true,
      message: 'Cache cleanup completed',
      duration,
      stats: {
        hotCacheRemaining: hotCacheResult.count || 0,
        priceCacheRemaining: priceCacheResult.count || 0,
        productCacheRemaining: productCacheResult.count || 0,
        searchCacheRemaining: searchCacheResult.count || 0,
        catalogCacheRemaining: catalogCacheResult.count || 0,
        cleanedAt: new Date().toISOString(),
      },
    };

    console.log('[cleanup-expired-caches] Cleanup complete:', JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error('[cleanup-expired-caches] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message,
      duration,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
