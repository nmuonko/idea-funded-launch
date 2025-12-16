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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Authenticate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract orderId from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(p => p);
    const orderId = pathParts[pathParts.length - 1];

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Initiate Payment] Order ID:', orderId, 'User:', user.id);

    // Get order and validate
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (order.status !== 'PENDING_PAYMENT') {
      return new Response(JSON.stringify({ error: 'Order cannot be paid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user profile for customer info
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    // Get MaishaPay credentials - use same env vars as working functions
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE') || '1';
    const isLiveMode = gatewayMode === '1';
    
    const publicKey = isLiveMode
      ? (Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || Deno.env.get('MAISHAPAY_PUBLIC_KEY'))
      : Deno.env.get('MAISHAPAY_PUBLIC_KEY');
    
    const secretKey = isLiveMode
      ? (Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || Deno.env.get('MAISHAPAY_SECRET_KEY'))
      : Deno.env.get('MAISHAPAY_SECRET_KEY');
    
    const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || Deno.env.get('MAISHA_CALLBACK_URL');

    if (!publicKey || !secretKey || !callbackUrl) {
      console.error('[Initiate Payment] Missing MaishaPay config:', { 
        hasPublicKey: !!publicKey, 
        hasSecretKey: !!secretKey, 
        hasCallbackUrl: !!callbackUrl,
        gatewayMode,
        isLiveMode
      });
      return new Response(JSON.stringify({ error: 'MaishaPay not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create unique reference
    const reference = `AFRISHOP-${orderId}-${Date.now()}`;
    
    // USE USD - same as working payment functions (NOT CDF)
    // This fixes the "Ce mode de paiement ne prend pas en charge la devise en cours" error for vehicle orders
    const paymentAmount = Number(order.total_usd || 0);
    const paymentCurrency = 'USD';
    
    // Debug logging to verify currency consistency
    console.log('[Initiate Payment] MaishaPay payload:', {
      orderId,
      reference,
      amount: paymentAmount,
      currency: paymentCurrency,
      gatewayMode,
      isLiveMode,
      orderTotalUsd: order.total_usd,
      orderTotalCdf: order.total_cdf,
    });

    // Prepare MaishaPay request - using USD like the working functions
    const maishaPayload = {
      publicKey,
      amount: paymentAmount,
      currency: paymentCurrency,
      reference,
      customerEmail: user.email || '',
      customerPhone: profile?.phone || '',
      description: `AfriShop order ${orderId}`,
      callbackUrl,
    };

    // MaishaPay API endpoint
    const maishaApiUrl = isLiveMode
      ? 'https://marchand.maishapay.online/api/v1/transaction/create'
      : 'https://sandbox.maishapay.online/api/v1/transaction/create';

    console.log('[Initiate Payment] Calling MaishaPay:', { 
      url: maishaApiUrl,
      reference, 
      amount: paymentAmount,
      currency: paymentCurrency 
    });

    // Call MaishaPay API
    const maishaResponse = await fetch(maishaApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify(maishaPayload),
    });

    const maishaData = await maishaResponse.json();
    console.log('[Initiate Payment] MaishaPay Response:', maishaData);

    if (!maishaResponse.ok) {
      throw new Error(maishaData.message || 'MaishaPay request failed');
    }

    // Create maisha_payments record - store USD amounts
    const { error: paymentError } = await supabase
      .from('maisha_payments')
      .insert({
        order_id: orderId,
        maisha_reference: reference,
        status: 'pending',
        amount_usd: order.total_usd,
        amount_cdf: order.total_cdf,
        currency: paymentCurrency, // USD - consistent with working functions
        raw_request: maishaPayload,
        raw_response: maishaData,
      });

    if (paymentError) {
      console.error('[Initiate Payment] Error creating payment record:', paymentError);
    }

    // Update order with Maisha reference
    await supabase
      .from('orders')
      .update({
        maisha_transaction_id: reference,
        maisha_payment_status: 'pending',
      })
      .eq('id', orderId);

    return new Response(JSON.stringify({
      orderId,
      payment: {
        checkoutUrl: maishaData.checkoutUrl || maishaData.paymentUrl || maishaData.url,
        maishaReference: reference,
        amount: paymentAmount,
        currency: paymentCurrency, // USD - consistent with working functions
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Initiate Payment] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
