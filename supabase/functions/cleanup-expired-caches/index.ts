// Cleanup expired cache entries from price_cache and product_cache tables
// Triggered via cron job (daily) or manually by admin

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

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[cleanup-expired-caches] Starting cache cleanup');

    // Call database functions to clean expired cache entries
    const { error: priceCacheError } = await supabase.rpc('clean_expired_price_cache');
    
    if (priceCacheError) {
      console.error('[cleanup-expired-caches] Error cleaning price cache:', priceCacheError);
    } else {
      console.log('[cleanup-expired-caches] Price cache cleaned successfully');
    }

    const { error: productCacheError } = await supabase.rpc('clean_expired_product_cache');
    
    if (productCacheError) {
      console.error('[cleanup-expired-caches] Error cleaning product cache:', productCacheError);
    } else {
      console.log('[cleanup-expired-caches] Product cache cleaned successfully');
    }

    // Get counts for logging
    const { count: priceCacheCount } = await supabase
      .from('price_cache')
      .select('*', { count: 'exact', head: true });

    const { count: productCacheCount } = await supabase
      .from('product_cache')
      .select('*', { count: 'exact', head: true });

    const result = {
      success: true,
      message: 'Cache cleanup completed',
      stats: {
        priceCacheRemaining: priceCacheCount || 0,
        productCacheRemaining: productCacheCount || 0,
        cleanedAt: new Date().toISOString(),
      },
    };

    console.log('[cleanup-expired-caches] Cleanup complete:', result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[cleanup-expired-caches] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
