import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { device_id, store_id, product_url, title, image_url } = body;

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
    const sanitizedTitle = title ? title.trim().substring(0, 500) : null;
    const sanitizedImageUrl = image_url ? image_url.trim().substring(0, 2000) : null;

    // Create Supabase client with service role for upsert
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user is authenticated (optional)
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id || null;
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
        id: data?.id
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
