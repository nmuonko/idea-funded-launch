import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-maishapay-signature',
};

// HMAC signature verification for webhook security
// SECURITY: Webhook secret is REQUIRED. Requests are rejected if not configured.
async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<{ valid: boolean; reason: string }> {
  const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
  
  // SECURITY FIX: Reject if webhook secret is not configured
  if (!webhookSecret) {
    console.error('[Web Maisha Callback] CRITICAL: MAISHAPAY_WEBHOOK_SECRET not configured - rejecting request for security');
    return { valid: false, reason: 'webhook_secret_not_configured' };
  }
  
  // If secret is configured but no signature provided, reject for security
  if (!signature) {
    console.warn('[Web Maisha Callback] Webhook secret configured but no signature provided - rejecting');
    return { valid: false, reason: 'missing_signature' };
  }
  
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const providedSig = signature.toLowerCase().replace(/^sha256=/, '');
    const isValid = expectedSignature === providedSig;
    
    if (!isValid) {
      console.warn('[Web Maisha Callback] Signature mismatch - rejecting request');
      return { valid: false, reason: 'signature_mismatch' };
    }
    
    return { valid: true, reason: 'signature_valid' };
  } catch (error) {
    console.error('[Web Maisha Callback] Signature verification error:', error);
    return { valid: false, reason: 'verification_error' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[Web Maisha Callback] Request received:', req.method);

  try {
    // Read raw body for signature verification
    const rawBody = await req.text();
    
    // Verify webhook signature for POST requests
    if (req.method === 'POST') {
      const signature = req.headers.get('x-maishapay-signature') || 
                        req.headers.get('x-webhook-signature') ||
                        req.headers.get('x-signature');
      
      const verification = await verifyWebhookSignature(rawBody, signature);
      
      if (!verification.valid) {
        console.error('[Web Maisha Callback] Invalid webhook signature - rejecting:', verification.reason);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid or missing signature',
          reason: verification.reason
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      console.log('[Web Maisha Callback] Webhook signature check passed:', verification.reason);
    }
    
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

    if (req.method === 'POST' && rawBody) {
      const contentType = req.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        try {
          payload = { ...payload, ...JSON.parse(rawBody) };
        } catch {
          console.warn('[Web Maisha Callback] Failed to parse JSON body');
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody);
        for (const [key, value] of params.entries()) {
          payload[key] = value;
        }
      } else {
        try {
          payload = { ...payload, ...JSON.parse(rawBody) };
        } catch {
          const params = new URLSearchParams(rawBody);
          for (const [key, value] of params.entries()) {
            payload[key] = value;
          }
        }
      }
    }

    console.log('[Web Maisha Callback] Payload:', JSON.stringify(payload, null, 2));

    const { status, description, transactionRefId, operatorRefId } = payload;
    const reference = transactionRefId || payload.reference || payload.orderNumber;

    // Validate - but always return 200 for valid webhooks
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
