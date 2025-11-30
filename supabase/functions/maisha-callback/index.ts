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
    console.log('[Maisha Callback] Received webhook');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Parse webhook payload
    let payload;
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      payload = await req.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      payload = Object.fromEntries(params.entries());
    } else {
      payload = await req.json(); // Default to JSON
    }

    console.log('[Maisha Callback] Payload:', payload);

    // Extract data (adjust field names based on actual MaishaPay webhook structure)
    const reference = payload.reference || payload.transactionRef || payload.maishaReference;
    const status = payload.status || payload.paymentStatus;
    const paidAmount = payload.amount || payload.paidAmount;

    if (!reference) {
      return new Response(JSON.stringify({ error: 'Missing reference' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Maisha Callback] Processing:', { reference, status, paidAmount });

    // Find payment record
    const { data: payment, error: paymentError } = await supabase
      .from('maisha_payments')
      .select('*, orders(*)')
      .eq('maisha_reference', reference)
      .maybeSingle();

    if (paymentError || !payment) {
      console.error('[Maisha Callback] Payment not found:', reference);
      return new Response(JSON.stringify({ error: 'Payment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize status
    const normalizedStatus = ['success', 'paid', 'completed'].includes(status?.toLowerCase()) 
      ? 'paid' 
      : ['failed', 'cancelled', 'rejected'].includes(status?.toLowerCase())
      ? 'failed'
      : 'pending';

    console.log('[Maisha Callback] Normalized status:', normalizedStatus);

    // Update payment record
    const paymentUpdate: any = {
      status: normalizedStatus,
      raw_response: payload,
      updated_at: new Date().toISOString(),
    };

    if (normalizedStatus === 'paid') {
      paymentUpdate.paid_at = new Date().toISOString();
    }

    await supabase
      .from('maisha_payments')
      .update(paymentUpdate)
      .eq('id', payment.id);

    // Update order status
    if (normalizedStatus === 'paid') {
      await supabase
        .from('orders')
        .update({
          status: 'PAID',
          maisha_payment_status: 'paid',
          payment_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.order_id);

      console.log('[Maisha Callback] Order marked as PAID:', payment.order_id);
    } else if (normalizedStatus === 'failed') {
      await supabase
        .from('orders')
        .update({
          maisha_payment_status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.order_id);

      console.log('[Maisha Callback] Order marked as FAILED:', payment.order_id);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Maisha Callback] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
