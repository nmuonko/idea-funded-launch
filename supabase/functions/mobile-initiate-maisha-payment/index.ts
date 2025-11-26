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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const orderId = url.pathname.split('/').filter(p => p).pop()?.replace('initiate-maisha-payment', '').replace(/\//g, '');
    const { shippingCity, customerPhone } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (order.status !== 'DRAFT' && order.status !== 'PENDING_PAYMENT') {
      return new Response(JSON.stringify({ error: 'Order cannot be paid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Recalculate totals
    const { data: settings } = await supabase.from('settings').select('*').single();
    const itemTotal = order.order_items.reduce((sum: number, i: any) => sum + (Number(i.subtotal_usd || 0)), 0);
    const serviceFee = itemTotal * (settings?.service_fee_percent || 0.12);
    const shippingFee = Number(settings?.shipping_base_fee_usd || 10) + (itemTotal * (settings?.shipping_percent || 0.10));
    const totalUsd = itemTotal + serviceFee + shippingFee;
    const totalCdf = totalUsd * (settings?.exchange_rate_usd_to_cdf || 2800);

    // Update order
    await supabase
      .from('orders')
      .update({
        shipping_city: shippingCity,
        status: 'PENDING_PAYMENT',
        item_total_usd: itemTotal,
        service_fee_usd: serviceFee,
        shipping_fee_usd: shippingFee,
        total_usd: totalUsd,
        total_cdf: totalCdf,
        exchange_rate_used: settings?.exchange_rate_usd_to_cdf,
      })
      .eq('id', orderId);

    // Call MaishaPay
    const mode = Deno.env.get('MAISHAPAY_MODE') || 'test';
    const publicKey = mode === 'production' 
      ? Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY')
      : Deno.env.get('MAISHAPAY_TEST_PUBLIC_KEY');
    const secretKey = mode === 'production'
      ? Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY')
      : Deno.env.get('MAISHAPAY_TEST_SECRET_KEY');

    const reference = `AFRISHOP-${orderId}`;
    const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || `${Deno.env.get('FRONTEND_BASE_URL')}/api/payment/maishapay/callback`;

    const maishaPayload = {
      publicKey,
      montant: Math.round(totalCdf),
      devise: 'CDF',
      reference,
      telephone: customerPhone || '',
      callbackUrl,
    };

    console.log('[MaishaPay Initiate] Payload:', maishaPayload);

    const maishaResponse = await fetch('https://api.maishapay.online/transaction/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify(maishaPayload),
    });

    const maishaData = await maishaResponse.json();
    console.log('[MaishaPay Initiate] Response:', maishaData);

    if (!maishaResponse.ok) {
      throw new Error(maishaData.message || 'MaishaPay request failed');
    }

    // Update order with MaishaPay transaction ID
    await supabase
      .from('orders')
      .update({
        maisha_transaction_id: maishaData.transactionRefId || maishaData.reference || reference,
        maisha_payment_status: 'PENDING',
      })
      .eq('id', orderId);

    return new Response(JSON.stringify({
      orderId,
      maishaTransactionId: maishaData.transactionRefId || maishaData.reference || reference,
      status: 'PENDING',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[MaishaPay Initiate] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
