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

    // Verify admin access
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roleData || roleData.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { orderId, reason } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Refund] Processing refund for order:', orderId);

    // Get order and payment
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, maisha_payments(*)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (order.status !== 'PAID' && order.status !== 'PROCESSING') {
      return new Response(JSON.stringify({ error: 'Order cannot be refunded' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payment = order.maisha_payments?.[0];
    if (!payment || payment.status !== 'paid') {
      return new Response(JSON.stringify({ error: 'No paid payment found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call MaishaPay refund API
    const secretKey = Deno.env.get('MAISHA_SECRET_KEY');
    const baseUrl = Deno.env.get('MAISHA_API_BASE_URL');

    if (!secretKey || !baseUrl) {
      return new Response(JSON.stringify({ error: 'MaishaPay not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const refundPayload = {
      transactionReference: payment.maisha_reference,
      amount: payment.amount_cdf,
      reason: reason || 'Customer refund request',
    };

    console.log('[Refund] Calling MaishaPay refund API:', refundPayload);

    const maishaResponse = await fetch(`${baseUrl}/transaction/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify(refundPayload),
    });

    // SAFE: Read as text first - MaishaPay often returns empty body
    const responseText = await maishaResponse.text();
    console.log('[Refund] MaishaPay raw response:', {
      status: maishaResponse.status,
      ok: maishaResponse.ok,
      bodyLength: responseText.length,
      body: responseText.substring(0, 200),
    });

    let maishaData: any;
    if (responseText && responseText.trim() !== '') {
      try {
        maishaData = JSON.parse(responseText);
      } catch (e) {
        console.error('[Refund] Failed to parse MaishaPay response:', e);
        maishaData = { success: maishaResponse.ok, rawResponse: responseText };
      }
    } else {
      // Empty body - per MaishaPay docs, this can indicate success
      maishaData = { success: maishaResponse.ok, _emptyResponse: true };
      console.log('[Refund] Empty MaishaPay response - treating based on HTTP status');
    }

    console.log('[Refund] Parsed MaishaPay data:', maishaData);

    if (!maishaResponse.ok) {
      throw new Error(maishaData.message || maishaData.error || `Refund failed with status ${maishaResponse.status}`);
    }

    // Update payment status to refunded
    await supabase
      .from('maisha_payments')
      .update({
        status: 'refunded',
        raw_response: { ...payment.raw_response, refund: maishaData },
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    // Update order status
    await supabase
      .from('orders')
      .update({
        status: 'CANCELLED',
        maisha_payment_status: 'refunded',
        admin_notes: `Refunded: ${reason || 'No reason provided'}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    // Log action
    await supabase
      .from('order_actions')
      .insert({
        order_id: orderId,
        actor_id: user.id,
        action_type: 'refund_processed',
        action_message: `Refund processed: ${reason || 'No reason provided'}`,
        metadata: { refund_response: maishaData },
      });

    return new Response(JSON.stringify({
      success: true,
      message: 'Refund processed successfully',
      refundReference: maishaData.refundReference || maishaData.reference,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Refund] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
