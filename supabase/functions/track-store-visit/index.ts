import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrackVisitRequest {
  store_id: string;
  device_id: string;
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

    const body: TrackVisitRequest = await req.json();
    const { store_id, device_id } = body;

    // Validate required fields
    if (!store_id || typeof store_id !== 'string' || store_id.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_STORE_ID', message: 'store_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!device_id || typeof device_id !== 'string' || device_id.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_DEVICE_ID', message: 'device_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize inputs
    const sanitizedStoreId = store_id.trim().substring(0, 100);
    const sanitizedDeviceId = device_id.trim().substring(0, 255);

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

    console.log(`[track-store-visit] Tracking visit: store=${sanitizedStoreId}, device=${sanitizedDeviceId}, user=${userId || 'guest'}`);

    // Call the upsert function
    const { data, error } = await supabase.rpc('upsert_store_visit', {
      p_user_id: userId,
      p_device_id: sanitizedDeviceId,
      p_store_id: sanitizedStoreId
    });

    if (error) {
      console.error('[track-store-visit] Error:', error);
      return new Response(
        JSON.stringify({ success: false, code: 'DB_ERROR', message: 'Failed to track visit' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[track-store-visit] Success: visit_count=${data?.visit_count}`);

    return new Response(
      JSON.stringify({
        success: true,
        visit_count: data?.visit_count || 1,
        id: data?.id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[track-store-visit] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
