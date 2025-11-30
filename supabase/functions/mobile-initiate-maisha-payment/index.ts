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

    // Get MaishaPay credentials
    const publicKey = Deno.env.get('MAISHA_PUBLIC_KEY');
    const secretKey = Deno.env.get('MAISHA_SECRET_KEY');
    const baseUrl = Deno.env.get('MAISHA_API_BASE_URL');
    const callbackUrl = Deno.env.get('MAISHA_CALLBACK_URL');

    if (!publicKey || !secretKey || !baseUrl || !callbackUrl) {
      return new Response(JSON.stringify({ error: 'MaishaPay not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create unique reference
    const reference = `AFRISHOP-${orderId}-${Date.now()}`;
    
    // Prepare MaishaPay request
    const maishaPayload = {
      publicKey,
      amount: Math.round(order.total_cdf || 0), // MaishaPay likely uses CDF
      currency: 'CDF',
      reference,
      customerEmail: user.email || '',
      customerPhone: profile?.phone || '',
      description: `AfriShop order ${orderId}`,
      callbackUrl,
    };

    console.log('[Initiate Payment] Calling MaishaPay:', { reference, amount: maishaPayload.amount });

    // Call MaishaPay API
    const maishaResponse = await fetch(`${baseUrl}/transaction/create`, {
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

    // Create maisha_payments record
    const { error: paymentError } = await supabase
      .from('maisha_payments')
      .insert({
        order_id: orderId,
        maisha_reference: reference,
        status: 'pending',
        amount_usd: order.total_usd,
        amount_cdf: order.total_cdf,
        currency: 'CDF',
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
        amount: order.total_cdf,
        currency: 'CDF',
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
