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

  console.log('[Web Maisha Callback] Request received:', req.method);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Parse payload from body or query params
    let payload: any = {};
    
    const url = new URL(req.url);
    for (const [key, value] of url.searchParams.entries()) {
      payload[key] = value;
    }

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        payload = { ...payload, ...body };
      } catch {
        // Body might be empty or not JSON
      }
    }

    console.log('[Web Maisha Callback] Payload:', JSON.stringify(payload, null, 2));

    const { status, description, transactionRefId, operatorRefId } = payload;
    const reference = transactionRefId || payload.reference || payload.orderNumber;

    // Validate - but always return 200
    if (!reference) {
      console.warn('[Web Maisha Callback] Missing transaction reference');
      return new Response(
        JSON.stringify({ success: true, message: 'No reference provided' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find order by maisha_transaction_id
    let order: any = null;

    const { data: orderByTxId } = await supabase
      .from('orders')
      .select('*')
      .eq('maisha_transaction_id', reference)
      .maybeSingle();

    if (orderByTxId) {
      order = orderByTxId;
    } else {
      // Try maisha_payments lookup
      const { data: payment } = await supabase
        .from('maisha_payments')
        .select('order_id')
        .eq('maisha_reference', reference)
        .maybeSingle();

      if (payment?.order_id) {
        const { data: orderFromPayment } = await supabase
          .from('orders')
          .select('*')
          .eq('id', payment.order_id)
          .maybeSingle();
        
        if (orderFromPayment) {
          order = orderFromPayment;
        }
      }
    }

    if (!order) {
      console.warn('[Web Maisha Callback] Order not found:', reference);
      return new Response(
        JSON.stringify({ success: true, message: 'Order not found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize status
    const statusCode = typeof status === 'string' ? parseInt(status) : status;
    let paymentStatus: 'paid' | 'pending' | 'failed';
    let orderStatus: string;

    if (statusCode === 202 || String(status).toLowerCase() === 'success') {
      paymentStatus = 'paid';
      orderStatus = 'PAID';
    } else if (statusCode === 201 || (statusCode >= 200 && statusCode < 300)) {
      paymentStatus = 'pending';
      orderStatus = 'PENDING_PAYMENT';
    } else {
      paymentStatus = 'failed';
      orderStatus = 'CANCELLED';
    }

    console.log('[Web Maisha Callback] Updating order:', order.id, 'to:', orderStatus);

    // Update order
    const updateData: any = {
      maisha_payment_status: paymentStatus,
      status: orderStatus,
      operator_ref_id: operatorRefId || null,
      maisha_status_code: String(statusCode),
      maisha_description: description || null,
      updated_at: new Date().toISOString(),
    };

    if (paymentStatus === 'paid') {
      updateData.payment_verified_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', order.id);

    if (updateError) {
      console.error('[Web Maisha Callback] Update error:', updateError);
    }

    // Update maisha_payments table - try by reference first, then by order_id
    const paymentUpdateData = {
      status: paymentStatus,
      raw_response: payload,
      updated_at: new Date().toISOString(),
      paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
      maishapay_status: String(statusCode),
      maishapay_description: description || null,
      maishapay_operator_ref_id: operatorRefId || null,
    };

    const { data: refUpdateResult } = await supabase
      .from('maisha_payments')
      .update(paymentUpdateData)
      .eq('maisha_reference', reference)
      .select('id');

    // If no rows updated by reference, try by order_id
    if (!refUpdateResult || refUpdateResult.length === 0) {
      console.log('[Web Maisha Callback] No payment found by reference, trying order_id:', order.id);
      await supabase
        .from('maisha_payments')
        .update(paymentUpdateData)
        .eq('order_id', order.id);
    }

    // Send notifications on successful payment
    if (paymentStatus === 'paid') {
      console.log('[Web Maisha Callback] Payment successful - sending notifications');

      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        await fetch(`${supabaseUrl}/functions/v1/send-payment-confirmation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ orderId: order.id }),
        });
        console.log('[Web Maisha Callback] Customer email sent');
      } catch (emailError) {
        console.error('[Web Maisha Callback] Email error:', emailError);
      }

      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        await fetch(`${supabaseUrl}/functions/v1/send-admin-payment-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ orderId: order.id, amount: order.total_usd }),
        });
        console.log('[Web Maisha Callback] Admin notification sent');
      } catch (adminError) {
        console.error('[Web Maisha Callback] Admin notification error:', adminError);
      }
    }

    console.log('[Web Maisha Callback] Complete:', order.id, paymentStatus);

    // Always return 200
    return new Response(
      JSON.stringify({
        success: true,
        orderId: order.id,
        paymentStatus,
        totalUsd: order.total_usd,
        totalCdf: order.total_cdf,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Web Maisha Callback] Error:', error);
    
    // Always return 200 to acknowledge receipt
    return new Response(
      JSON.stringify({ success: true, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
