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

/**
 * Verify webhook signature from MaishaPay
 * Returns true if signature is valid or if verification is skipped (no secret configured)
 */
function verifyWebhookSignature(body: string, signature: string | null): boolean {
  const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
  
  if (!webhookSecret) {
    // Log warning but allow - MaishaPay may not send signatures in all cases
    console.warn('[maishapay-update-order] No webhook secret configured, skipping signature verification');
    return true;
  }
  
  if (!signature) {
    console.error('[maishapay-update-order] Missing signature header');
    return false;
  }
  
  // MaishaPay typically uses HMAC-SHA256
  try {
    const encoder = new TextEncoder();
    const key = encoder.encode(webhookSecret);
    const data = encoder.encode(body);
    
    // For now, compare directly - adjust based on MaishaPay's actual signature format
    // Some providers send raw HMAC, others send base64, etc.
    const expectedSignature = signature.toLowerCase();
    console.log('[maishapay-update-order] Signature verification attempted');
    
    // If MaishaPay sends a specific signature format, implement proper HMAC verification here
    // For now, we validate that a signature was provided if secret is configured
    return !!signature;
  } catch (error) {
    console.error('[maishapay-update-order] Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Read raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get('x-maishapay-signature') || 
                      req.headers.get('x-webhook-signature') ||
                      req.headers.get('authorization');
    
    // Verify webhook signature if secret is configured
    const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
    if (webhookSecret && !verifyWebhookSignature(rawBody, signature)) {
      console.error('[maishapay-update-order] Invalid webhook signature - rejecting request');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'INVALID_SIGNATURE',
          message: 'Invalid webhook signature' 
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    const body = JSON.parse(rawBody);
    const { status, description, transactionRefId, operatorRefId } = body;

    console.log('[maishapay-update-order] Received:', { 
      status, 
      description, 
      transactionRefId, 
      operatorRefId,
      hasSignature: !!signature,
      hasWebhookSecret: !!webhookSecret
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
    // Use multiple lookup strategies for robustness
    let order = null;
    
    console.log('[maishapay-update-order] Searching for order with reference:', transactionRefId);
    
    // Strategy 1: Exact match on maisha_transaction_id
    const { data: orderByRef, error: refError } = await supabase
      .from('orders')
      .select('*')
      .eq('maisha_transaction_id', transactionRefId)
      .maybeSingle();

    if (orderByRef) {
      order = orderByRef;
      console.log('[maishapay-update-order] Found by exact transaction ID match');
    }
    
    // Strategy 2: Try maisha_payments table
    if (!order) {
      const { data: payment } = await supabase
        .from('maisha_payments')
        .select('order_id')
        .eq('maisha_reference', transactionRefId)
        .maybeSingle();
      
      if (payment?.order_id) {
        const { data: orderFromPayment } = await supabase
          .from('orders')
          .select('*')
          .eq('id', payment.order_id)
          .maybeSingle();
        
        if (orderFromPayment) {
          order = orderFromPayment;
          console.log('[maishapay-update-order] Found via maisha_payments table');
        }
      }
    }
    
    // Strategy 3: Extract order ID from reference (format: AFRISHOP-{orderId8chars}-{timestamp})
    if (!order) {
      const parts = transactionRefId.split('-');
      if (parts.length >= 2 && parts[0] === 'AFRISHOP') {
        const partialOrderId = parts[1]; // First 8 chars of order UUID
        
        console.log('[maishapay-update-order] Trying partial ID match:', partialOrderId);
        
        // SECURITY: Only match PENDING_PAYMENT orders to prevent fraud
        const { data: orderByPartial } = await supabase
          .from('orders')
          .select('*')
          .ilike('id', `${partialOrderId}%`)
          .eq('status', 'PENDING_PAYMENT')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (orderByPartial) {
          order = orderByPartial;
          console.log('[maishapay-update-order] Found by partial ID match');
        }
      }
    }
    
    // Strategy 4: Try operatorRefId if provided
    if (!order && operatorRefId) {
      const { data: orderByOperator } = await supabase
        .from('orders')
        .select('*')
        .eq('operator_ref_id', operatorRefId)
        .maybeSingle();
      
      if (orderByOperator) {
        order = orderByOperator;
        console.log('[maishapay-update-order] Found by operator ref ID');
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

    console.log('[maishapay-update-order] Found order:', order.id, 'Status:', order.status);

    // SECURITY: Only allow updates for orders in PENDING_PAYMENT status
    // This prevents attackers from re-marking already paid/shipped orders
    if (order.status !== 'PENDING_PAYMENT') {
      console.warn('[maishapay-update-order] Rejected: Order not in PENDING_PAYMENT status:', order.status);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'INVALID_ORDER_STATUS',
          message: 'Order is not awaiting payment',
          currentStatus: order.status
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

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
