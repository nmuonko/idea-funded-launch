import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MaishaPay Update Order
 * 
 * Called by the /maishapay/result frontend page to update order status
 * based on the MaishaPay callback parameters.
 * 
 * MaishaPay status codes:
 * - 202: Payment accepted/successful
 * - Other: Failed or pending
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
    const body = await req.json();
    const { status, description, transactionRefId, operatorRefId } = body;

    console.log('[maishapay-update-order] Received:', { 
      status, 
      description, 
      transactionRefId, 
      operatorRefId 
    });

    if (!transactionRefId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'MISSING_TRANSACTION_REF',
          message: 'Transaction reference is required' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Find order by maisha_transaction_id (reference)
    let order = null;
    
    // Try finding by exact reference match
    const { data: orderByRef, error: refError } = await supabase
      .from('orders')
      .select('*')
      .eq('maisha_transaction_id', transactionRefId)
      .maybeSingle();

    if (orderByRef) {
      order = orderByRef;
    } else {
      // Try extracting order ID from reference (format: AFRISHOP-{orderId}-{timestamp})
      const parts = transactionRefId.split('-');
      if (parts.length >= 2 && parts[0] === 'AFRISHOP') {
        const partialOrderId = parts[1];
        
        const { data: orderByPartial } = await supabase
          .from('orders')
          .select('*')
          .ilike('id', `${partialOrderId}%`)
          .eq('status', 'PENDING_PAYMENT')
          .maybeSingle();
        
        if (orderByPartial) {
          order = orderByPartial;
        }
      }
    }

    if (!order) {
      console.error('[maishapay-update-order] Order not found for reference:', transactionRefId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'ORDER_NOT_FOUND',
          message: 'Could not find order for this transaction' 
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('[maishapay-update-order] Found order:', order.id);

    // Determine payment status based on MaishaPay status code
    let paymentStatus: 'PAID' | 'PENDING' | 'FAILED';
    let orderStatus: string;
    
    // Status 202 = payment accepted/successful
    if (status === 202 || status === '202') {
      paymentStatus = 'PAID';
      orderStatus = 'PAID';
    } else if (status === 201 || status === '201') {
      paymentStatus = 'PENDING';
      orderStatus = 'PENDING_PAYMENT';
    } else {
      paymentStatus = 'FAILED';
      orderStatus = 'PENDING_PAYMENT'; // Keep as pending so user can retry
    }

    // Update order
    const updateData: any = {
      status: orderStatus,
      maisha_payment_status: paymentStatus,
      maisha_status_code: String(status),
      maisha_description: description,
      operator_ref_id: operatorRefId,
      updated_at: new Date().toISOString(),
    };

    // If paid, add payment timestamp
    if (paymentStatus === 'PAID') {
      updateData.payment_verified_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', order.id);

    if (updateError) {
      console.error('[maishapay-update-order] Update error:', updateError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'UPDATE_FAILED',
          message: 'Failed to update order status' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Update maisha_payments record if exists
    await supabase
      .from('maisha_payments')
      .update({
        status: paymentStatus.toLowerCase(),
        paid_at: paymentStatus === 'PAID' ? new Date().toISOString() : null,
        raw_response: { status, description, transactionRefId, operatorRefId },
        updated_at: new Date().toISOString(),
      })
      .eq('order_id', order.id);

    console.log('[maishapay-update-order] Order updated successfully:', {
      orderId: order.id,
      paymentStatus,
      orderStatus,
    });

    // Try to send notifications (non-blocking)
    try {
      if (paymentStatus === 'PAID') {
        // Send payment confirmation email
        await supabase.functions.invoke('send-payment-confirmation', {
          body: { orderId: order.id },
        });
        
        // Send admin notification
        await supabase.functions.invoke('send-admin-payment-notification', {
          body: { orderId: order.id },
        });
      }
    } catch (notifyError) {
      console.error('[maishapay-update-order] Notification error (non-blocking):', notifyError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId: order.id,
        paymentStatus,
        orderStatus,
        totalUsd: order.total_usd,
        totalCdf: order.total_cdf,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('[maishapay-update-order] Error:', error.message);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'INTERNAL_ERROR',
        message: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
