import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateConfirmationCode } from "../_shared/confirmationCode.ts";

/**
 * MaishaPay Process Result
 * 
 * Called by the /maishapay/result frontend page to process payment callback
 * and generate/return confirmation codes.
 * 
 * MaishaPay status codes:
 * - 202: Payment accepted/successful
 * - 201: Payment pending
 * - Other: Failed or cancelled
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalize MaishaPay status to internal status
function normalizeStatus(status: string | number | null): 'SUCCESS' | 'PENDING' | 'FAILED' | 'CANCELLED' {
  if (!status && status !== 0) return 'PENDING';
  
  const s = String(status).toLowerCase();
  
  if (s === '202' || s === 'success' || s === 'accepted' || s === 'paid') {
    return 'SUCCESS';
  }
  if (s === '201' || s === 'pending' || s === 'processing') {
    return 'PENDING';
  }
  if (s === '203' || s === 'cancelled' || s === 'canceled') {
    return 'CANCELLED';
  }
  // 204, 400, 500, etc = failed
  return 'FAILED';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { 
      status, 
      description, 
      transactionRefId, 
      operatorRefId,
      orderId,
      rawQuery 
    } = body;

    console.log('[maishapay-process-result] Received:', { 
      status, 
      description, 
      transactionRefId, 
      operatorRefId,
      orderId,
    });

    // Create Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Normalize the status
    const normalizedStatus = normalizeStatus(status);
    console.log('[maishapay-process-result] Normalized status:', normalizedStatus);

    // Try to find the payment/order using multiple strategies
    let payment = null;
    let order = null;

    // Strategy 1: Find by transactionRefId in maisha_payments
    if (transactionRefId) {
      const { data: paymentByRef } = await supabase
        .from('maisha_payments')
        .select('*, orders(*)')
        .or(`maisha_reference.eq.${transactionRefId},maishapay_transaction_ref_id.eq.${transactionRefId}`)
        .maybeSingle();
      
      if (paymentByRef) {
        payment = paymentByRef;
        order = paymentByRef.orders;
        console.log('[maishapay-process-result] Found payment by reference');
      }
    }

    // Strategy 2: Find by order's maisha_transaction_id
    if (!payment && transactionRefId) {
      const { data: orderByRef } = await supabase
        .from('orders')
        .select('*')
        .eq('maisha_transaction_id', transactionRefId)
        .maybeSingle();
      
      if (orderByRef) {
        order = orderByRef;
        console.log('[maishapay-process-result] Found order by transaction ID');
        
        // Find or create payment record
        const { data: existingPayment } = await supabase
          .from('maisha_payments')
          .select('*')
          .eq('order_id', orderByRef.id)
          .maybeSingle();
        
        payment = existingPayment;
      }
    }

    // Strategy 3: Extract order ID from reference (format: AFRISHOP-{orderId8chars}-{timestamp})
    if (!order && transactionRefId) {
      const parts = transactionRefId.split('-');
      if (parts.length >= 2 && parts[0] === 'AFRISHOP') {
        const partialOrderId = parts[1];
        
        const { data: orderByPartial } = await supabase
          .from('orders')
          .select('*')
          .ilike('id', `${partialOrderId}%`)
          .in('status', ['PENDING_PAYMENT', 'DRAFT'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (orderByPartial) {
          order = orderByPartial;
          console.log('[maishapay-process-result] Found order by partial ID match');
        }
      }
    }

    // Strategy 4: Use orderId directly if provided
    if (!order && orderId) {
      const { data: orderById } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();
      
      if (orderById) {
        order = orderById;
        console.log('[maishapay-process-result] Found order by direct ID');
      }
    }

    // If no order found, return error but don't crash
    if (!order) {
      console.warn('[maishapay-process-result] No order found for reference:', transactionRefId);
      return new Response(
        JSON.stringify({
          success: false,
          status: normalizedStatus,
          confirmationCode: null,
          description: description || 'Payment received but order not found',
          error: 'ORDER_NOT_FOUND',
        }),
        { 
          status: 200, // Return 200 so frontend can show appropriate message
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Generate confirmation code if payment is successful and doesn't have one
    let confirmationCode = payment?.confirmation_code || null;
    
    if (normalizedStatus === 'SUCCESS' && !confirmationCode) {
      // Generate unique confirmation code with retry logic
      let attempts = 0;
      while (!confirmationCode && attempts < 5) {
        const newCode = generateConfirmationCode();
        
        // Check if code already exists
        const { data: existing } = await supabase
          .from('maisha_payments')
          .select('id')
          .eq('confirmation_code', newCode)
          .maybeSingle();
        
        if (!existing) {
          confirmationCode = newCode;
        }
        attempts++;
      }
      
      if (!confirmationCode) {
        // Fallback: use timestamp-based code
        confirmationCode = `AFS-${Date.now().toString(36).toUpperCase().slice(-8)}`;
      }
      
      console.log('[maishapay-process-result] Generated confirmation code:', confirmationCode);
    }

    // Update or create payment record
    const paymentData = {
      order_id: order.id,
      user_id: order.user_id,
      maisha_reference: transactionRefId || payment?.maisha_reference || `REF-${Date.now()}`,
      amount_usd: order.total_usd,
      amount_cdf: order.total_cdf,
      currency: 'USD',
      status: normalizedStatus === 'SUCCESS' ? 'paid' : normalizedStatus === 'PENDING' ? 'pending' : 'failed',
      confirmation_code: confirmationCode,
      maishapay_status: String(status),
      maishapay_description: description,
      maishapay_transaction_ref_id: transactionRefId,
      maishapay_operator_ref_id: operatorRefId,
      raw_query: rawQuery || { status, description, transactionRefId, operatorRefId },
      paid_at: normalizedStatus === 'SUCCESS' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    if (payment) {
      // Update existing payment
      const { error: updateError } = await supabase
        .from('maisha_payments')
        .update(paymentData)
        .eq('id', payment.id);
      
      if (updateError) {
        console.error('[maishapay-process-result] Payment update error:', updateError);
      }
    } else {
      // Create new payment record
      const { error: insertError } = await supabase
        .from('maisha_payments')
        .insert(paymentData);
      
      if (insertError) {
        console.error('[maishapay-process-result] Payment insert error:', insertError);
      }
    }

    // Update order status
    const orderStatus = normalizedStatus === 'SUCCESS' ? 'PAID' : 
                       normalizedStatus === 'PENDING' ? 'PENDING_PAYMENT' : 'PENDING_PAYMENT';
    
    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update({
        status: orderStatus,
        maisha_payment_status: normalizedStatus,
        maisha_status_code: String(status),
        maisha_description: description,
        maisha_transaction_id: transactionRefId || order.maisha_transaction_id,
        operator_ref_id: operatorRefId,
        payment_verified_at: normalizedStatus === 'SUCCESS' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    if (orderUpdateError) {
      console.error('[maishapay-process-result] Order update error:', orderUpdateError);
    }

    // Send notifications for successful payments (non-blocking)
    if (normalizedStatus === 'SUCCESS') {
      try {
        // Send payment confirmation email
        await supabase.functions.invoke('send-payment-confirmation', {
          body: { orderId: order.id },
        });
        
        // Send admin notification
        await supabase.functions.invoke('send-admin-payment-notification', {
          body: { orderId: order.id },
        });
      } catch (notifyError) {
        console.error('[maishapay-process-result] Notification error (non-blocking):', notifyError);
      }
    }

    console.log('[maishapay-process-result] Success:', {
      orderId: order.id,
      status: normalizedStatus,
      confirmationCode,
    });

    return new Response(
      JSON.stringify({
        success: true,
        status: normalizedStatus,
        confirmationCode,
        description: description || (normalizedStatus === 'SUCCESS' ? 'Payment successful' : 'Payment processing'),
        orderId: order.id,
        amountUsd: order.total_usd,
        amountCdf: order.total_cdf,
        currency: 'USD',
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('[maishapay-process-result] Error:', error.message);
    return new Response(
      JSON.stringify({ 
        success: false, 
        status: 'FAILED',
        confirmationCode: null,
        error: 'INTERNAL_ERROR',
        description: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
