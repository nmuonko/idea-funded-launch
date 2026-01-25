import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpsertRecentlyViewedRequest {
  device_id: string;
  store_id: string;
  product_url: string;
  title?: string;
  image_url?: string;
}

/**
 * Fetch product info from get-product-info edge function
 */
async function fetchProductInfo(productUrl: string, supabaseUrl: string, supabaseKey: string): Promise<{ title: string | null; imageUrl: string | null }> {
  try {
    console.log('[recently-viewed-upsert] Fetching product info for:', productUrl.substring(0, 60));
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/get-product-info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ productUrl }),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        console.log('[recently-viewed-upsert] Product info fetch failed:', response.status);
        return { title: null, imageUrl: null };
      }
      
      const data = await response.json();
      
      if (data.ok) {
        console.log('[recently-viewed-upsert] Product info fetched:', { hasTitle: !!data.productTitle, hasImage: !!data.imageUrl });
        return {
          title: data.productTitle || null,
          imageUrl: data.imageUrl || null,
        };
      }
      
      return { title: null, imageUrl: null };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('[recently-viewed-upsert] Product info fetch timed out');
    } else {
      console.warn('[recently-viewed-upsert] Product info fetch error:', err.message);
    }
    return { title: null, imageUrl: null };
  }
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
        JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: UpsertRecentlyViewedRequest = await req.json();
    let { device_id, store_id, product_url, title, image_url } = body;

    // Validate required fields
    if (!device_id || typeof device_id !== 'string' || device_id.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_DEVICE_ID', message: 'device_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!store_id || typeof store_id !== 'string' || store_id.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_STORE_ID', message: 'store_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!product_url || typeof product_url !== 'string' || product_url.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_PRODUCT_URL', message: 'product_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize inputs
    const sanitizedDeviceId = device_id.trim().substring(0, 255);
    const sanitizedStoreId = store_id.trim().substring(0, 100);
    const sanitizedProductUrl = product_url.trim().substring(0, 2000);
    let sanitizedTitle = title ? title.trim().substring(0, 500) : null;
    let sanitizedImageUrl = image_url ? image_url.trim().substring(0, 2000) : null;

    // Create Supabase client with service role for upsert
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user is authenticated (optional)
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id || null;
    }

    // If image or title is missing, try to fetch from get-product-info
    if (!sanitizedImageUrl || !sanitizedTitle) {
      console.log('[recently-viewed-upsert] Missing image/title, fetching from get-product-info...');
      const productInfo = await fetchProductInfo(sanitizedProductUrl, supabaseUrl, supabaseServiceKey);
      
      if (!sanitizedTitle && productInfo.title) {
        sanitizedTitle = productInfo.title.substring(0, 500);
        console.log('[recently-viewed-upsert] Got title from product info:', sanitizedTitle?.substring(0, 50));
      }
      
      if (!sanitizedImageUrl && productInfo.imageUrl) {
        sanitizedImageUrl = productInfo.imageUrl.substring(0, 2000);
        console.log('[recently-viewed-upsert] Got image from product info:', sanitizedImageUrl?.substring(0, 80));
      }
    }

    console.log(`[recently-viewed-upsert] Upserting: store=${sanitizedStoreId}, device=${sanitizedDeviceId}, user=${userId || 'guest'}, url=${sanitizedProductUrl.substring(0, 50)}...`);

    // Call the upsert function
    const { data, error } = await supabase.rpc('upsert_recently_viewed', {
      p_user_id: userId,
      p_device_id: sanitizedDeviceId,
      p_store_id: sanitizedStoreId,
      p_product_url: sanitizedProductUrl,
      p_title: sanitizedTitle,
      p_image_url: sanitizedImageUrl
    });

    if (error) {
      console.error('[recently-viewed-upsert] Error:', error);
      return new Response(
        JSON.stringify({ success: false, code: 'DB_ERROR', message: 'Failed to upsert recently viewed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[recently-viewed-upsert] Success: view_count=${data?.view_count}`);

    return new Response(
      JSON.stringify({
        success: true,
        view_count: data?.view_count || 1,
        id: data?.id,
        title: sanitizedTitle,
        image_url: sanitizedImageUrl,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[recently-viewed-upsert] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
