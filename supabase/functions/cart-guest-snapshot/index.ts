import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CartItem {
  productUrl: string;
  title?: string;
  imageUrl?: string;
  store?: string;
  unitPrice: number;
  quantity: number;
  currency?: string;
}

interface GuestSnapshotRequest {
  device_id: string;
  cart: CartItem[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] cart-guest-snapshot: Start`);

  try {
    // Only accept POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${requestId}] Missing environment variables`);
      return new Response(
        JSON.stringify({ success: false, code: 'CONFIG_ERROR', message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: GuestSnapshotRequest;
    try {
      body = await req.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_JSON', message: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { device_id, cart } = body;

    // Validate device_id
    if (!device_id || typeof device_id !== 'string' || device_id.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_DEVICE_ID', message: 'device_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate cart is an array
    if (!Array.isArray(cart)) {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_CART', message: 'cart must be an array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sanitizedDeviceId = device_id.trim().substring(0, 255);
    
    // Sanitize cart items - limit to 100 items max
    const sanitizedCart = cart.slice(0, 100).map((item: CartItem) => ({
      productUrl: (item.productUrl || '').substring(0, 2000),
      title: item.title ? item.title.substring(0, 500) : null,
      imageUrl: item.imageUrl ? item.imageUrl.substring(0, 2000) : null,
      store: item.store ? item.store.substring(0, 50) : null,
      unitPrice: typeof item.unitPrice === 'number' ? Math.max(0, item.unitPrice) : 0,
      quantity: typeof item.quantity === 'number' ? Math.max(1, Math.min(100, item.quantity)) : 1,
      currency: item.currency ? item.currency.substring(0, 10) : 'USD',
    })).filter((item: CartItem) => item.productUrl && item.unitPrice > 0);

    console.log(`[${requestId}] Saving guest cart snapshot: device=${sanitizedDeviceId}, items=${sanitizedCart.length}`);

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Upsert guest cart snapshot
    const { error: upsertError } = await supabase
      .from('guest_cart_snapshots')
      .upsert({
        device_id: sanitizedDeviceId,
        cart_json: sanitizedCart,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'device_id'
      });

    if (upsertError) {
      console.error(`[${requestId}] Failed to save snapshot:`, upsertError.message);
      return new Response(
        JSON.stringify({ success: false, code: 'DB_ERROR', message: 'Failed to save cart snapshot' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${requestId}] Guest cart snapshot saved successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Cart snapshot saved',
        item_count: sanitizedCart.length,
        requestId,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${requestId}] Unexpected error:`, errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
