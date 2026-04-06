import { createClient } from "@supabase/supabase-js";
import { loadPricingSettings, applyAllInclusivePricingToItems } from "../_shared/allInclusivePricing.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only accept GET
    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const deviceId = url.searchParams.get('device_id');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 30, 1), 100) : 30;

    // Validate device_id
    if (!deviceId || deviceId.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_DEVICE_ID', message: 'device_id query parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sanitizedDeviceId = deviceId.trim().substring(0, 255);

    // Create Supabase client with service role
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

    console.log(`[recently-viewed-list] Fetching: device=${sanitizedDeviceId}, user=${userId || 'guest'}, limit=${limit}`);

    // Call the get function
    const { data, error } = await supabase.rpc('get_recently_viewed', {
      p_user_id: userId,
      p_device_id: sanitizedDeviceId,
      p_limit: limit
    });

    if (error) {
      console.error('[recently-viewed-list] Error:', error);
      return new Response(
        JSON.stringify({ success: false, code: 'DB_ERROR', message: 'Failed to fetch recently viewed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[recently-viewed-list] Success: found ${data?.length || 0} items`);

    // Apply all-inclusive pricing to recently viewed items
    let items = data || [];
    try {
      const pricingSettings = await loadPricingSettings();
      items = applyAllInclusivePricingToItems(items as Record<string, unknown>[], pricingSettings);
    } catch (e) {
      console.error('[recently-viewed-list] Pricing transform error:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        items,
        count: items.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[recently-viewed-list] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
