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
    console.log('[Web Maisha Callback] Request received');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { status, description, transactionRefId, operatorRefId } = await req.json();

    console.log('[Web Maisha Callback] Payload:', { 
      status, 
      description, 
      transactionRefId, 
      operatorRefId 
    });

    // Validate transaction reference
    if (!transactionRefId) {
      console.error('[Web Maisha Callback] Missing transaction reference');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'MISSING_TRANSACTION_REF',
          message: 'Transaction reference is required'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up order by maisha_transaction_id
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('maisha_transaction_id', transactionRefId)
      .maybeSingle();

    if (orderError || !order) {
      console.error('[Web Maisha Callback] Order not found:', transactionRefId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'ORDER_NOT_FOUND',
          message: 'Could not find order with this transaction reference'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Interpret Maisha status codes
    const statusCode = typeof status === 'string' ? parseInt(status) : status;
    let paymentStatus: 'paid' | 'pending' | 'failed';
    let orderStatus: string;

    if (statusCode === 202) {
      // SUCCESS
      paymentStatus = 'paid';
      orderStatus = 'PAID';
    } else if (statusCode === 201 || (statusCode >= 200 && statusCode < 300)) {
      // PENDING
      paymentStatus = 'pending';
      orderStatus = 'PENDING_PAYMENT';
    } else {
      // FAILED
      paymentStatus = 'failed';
      orderStatus = 'CANCELLED';
    }

    console.log('[Web Maisha Callback] Updating order:', { 
      orderId: order.id, 
      paymentStatus, 
      orderStatus 
    });

    // Update order
    const updateData: any = {
      maisha_payment_status: paymentStatus,
      status: orderStatus,
      operator_ref_id: operatorRefId,
      maisha_status_code: statusCode.toString(),
      maisha_description: description,
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
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'DB_UPDATE_FAILED',
          message: 'Could not update order',
          details: updateError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also update maisha_payments table if exists
    await supabase
      .from('maisha_payments')
      .update({
        status: paymentStatus,
        raw_response: { status, description, transactionRefId, operatorRefId },
        updated_at: new Date().toISOString(),
        paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
      })
      .eq('maisha_reference', transactionRefId);

    console.log('[Web Maisha Callback] Success:', { 
      orderId: order.id, 
      paymentStatus 
    });

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
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
