import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MaishaPay Get Checkout Data
 * 
 * Returns order data AND MaishaPay configuration for the checkout page.
 * Uses service role to bypass RLS since the WebView isn't authenticated.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();

    console.log('[maishapay-get-checkout-data] Request for orderId:', orderId);

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing orderId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role to bypass RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch order data
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, total_usd, total_cdf, maisha_transaction_id, status, user_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('[maishapay-get-checkout-data] Order fetch error:', orderError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch order', details: orderError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!order) {
      console.error('[maishapay-get-checkout-data] Order not found:', orderId);
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[maishapay-get-checkout-data] Order found:', { 
      id: order.id, 
      status: order.status, 
      total_usd: order.total_usd 
    });

    // Validate order status - allow PENDING_PAYMENT or DRAFT
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'DRAFT') {
      console.warn('[maishapay-get-checkout-data] Invalid order status:', order.status);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Order cannot be paid. Status: ${order.status}`,
          orderStatus: order.status
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get MaishaPay configuration
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
    const legacyMode = Deno.env.get('MAISHAPAY_MODE');
    
    const isLiveMode = gatewayMode === '1' || 
                       legacyMode === '1' || 
                       legacyMode?.toLowerCase() === 'live';
    
    let publicKey: string;
    let secretKey: string;
    
    if (isLiveMode) {
      publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || 
                  Deno.env.get('MAISHA_SECRET_KEY') || '';
    } else {
      publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || 
                  Deno.env.get('MAISHA_SECRET_KEY') || '';
    }
    
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || `${frontendBaseUrl}/maishapay/result`;
    
    if (!publicKey || !secretKey) {
      console.error('[maishapay-get-checkout-data] Missing payment gateway keys');
      return new Response(
        JSON.stringify({ success: false, error: 'Payment gateway not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate reference if not exists
    let reference = order.maisha_transaction_id;
    if (!reference) {
      reference = `AFRISHOP-${orderId.slice(0, 8)}-${Date.now().toString(36)}`;
      
      // Update order with reference
      await supabase
        .from('orders')
        .update({ maisha_transaction_id: reference })
        .eq('id', orderId);
      
      console.log('[maishapay-get-checkout-data] Generated new reference:', reference);
    }

    console.log('[maishapay-get-checkout-data] Returning checkout data:', {
      orderId: order.id,
      amount: order.total_usd,
      mode: isLiveMode ? 'live' : 'sandbox',
      callbackUrl,
    });

    return new Response(
      JSON.stringify({
        success: true,
        order: {
          id: order.id,
          amount: order.total_usd || 0,
          amountCdf: order.total_cdf || 0,
          currency: 'USD',
          status: order.status,
          reference,
        },
        config: {
          gatewayMode: isLiveMode ? '1' : '0',
          publicApiKey: publicKey,
          secretApiKey: secretKey,
          callbackUrl,
          mode: isLiveMode ? 'live' : 'sandbox',
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[maishapay-get-checkout-data] Error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
