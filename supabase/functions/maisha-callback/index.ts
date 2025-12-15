import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-maishapay-signature',
};

// HMAC signature verification for webhook security
async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<{ valid: boolean; reason: string }> {
  const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
  
  // If no webhook secret is configured, skip validation (backwards compatible)
  if (!webhookSecret) {
    console.log('[Maisha Callback] MAISHAPAY_WEBHOOK_SECRET not configured - skipping signature validation');
    return { valid: true, reason: 'no_secret_configured' };
  }
  
  // If secret is configured but no signature provided, reject for security
  if (!signature) {
    console.warn('[Maisha Callback] Webhook secret configured but no signature provided - rejecting');
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
      console.warn('[Maisha Callback] Signature mismatch - rejecting request');
      return { valid: false, reason: 'signature_mismatch' };
    }
    
    return { valid: true, reason: 'signature_valid' };
  } catch (error) {
    console.error('[Maisha Callback] Signature verification error:', error);
    return { valid: false, reason: 'verification_error' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[Maisha Callback] Received webhook:', req.method);

  try {
    // Parse body first for signature verification
    const rawBody = await req.text();
    
    // Verify webhook signature for POST requests
    if (req.method === 'POST') {
      const signature = req.headers.get('x-maishapay-signature') || 
                        req.headers.get('x-webhook-signature') ||
                        req.headers.get('x-signature');
      
      const verification = await verifyWebhookSignature(rawBody, signature);
      
      if (!verification.valid) {
        console.error('[Maisha Callback] Invalid webhook signature - rejecting:', verification.reason);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid or missing signature',
          reason: verification.reason
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      console.log('[Maisha Callback] Webhook signature check passed:', verification.reason);
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Parse webhook payload
    let payload: any = {};
    
    // Check query params first
    const url = new URL(req.url);
    for (const [key, value] of url.searchParams.entries()) {
      payload[key] = value;
    }

    // Parse body
    if (rawBody) {
      const contentType = req.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        try {
          payload = { ...payload, ...JSON.parse(rawBody) };
        } catch {
          console.warn('[Maisha Callback] Failed to parse JSON body');
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody);
        for (const [key, value] of params.entries()) {
          payload[key] = value;
        }
      } else {
        // Try JSON first, then form-urlencoded
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

    console.log('[Maisha Callback] Payload:', JSON.stringify(payload, null, 2));

    // Extract data - try multiple field names MaishaPay might use
    const reference = payload.reference || 
                      payload.transactionRefId || 
                      payload.transaction_ref_id ||
                      payload.maishaReference ||
                      payload.orderNumber ||
                      payload.ref;
    
    const status = payload.status || 
                   payload.paymentStatus || 
                   payload.transactionStatus ||
                   payload.transaction_status;
    
    const amount = payload.amount || payload.paidAmount;
    const operatorRefId = payload.operatorRefId || payload.operator_ref_id;
    const description = payload.description || payload.message;

    console.log('[Maisha Callback] Extracted:', { reference, status, amount, operatorRefId });

    // Validate required fields - be permissive
    if (!reference) {
      console.warn('[Maisha Callback] No reference in payload - acknowledging anyway');
      return new Response(JSON.stringify({ success: true, message: 'Acknowledged (no reference)' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize status
    const statusLower = String(status).toLowerCase();
    let normalizedStatus = 'pending';
    
    if (['success', 'paid', 'completed', 'approved', '202', '200'].includes(statusLower)) {
      normalizedStatus = 'paid';
    } else if (['failed', 'failure', 'rejected', 'error', '500', '400'].includes(statusLower)) {
      normalizedStatus = 'failed';
    } else if (['cancelled', 'canceled', 'cancel'].includes(statusLower)) {
      normalizedStatus = 'cancelled';
    }

    console.log('[Maisha Callback] Normalized status:', normalizedStatus);

    // Find order - try multiple lookup strategies
    let order: any = null;

    // Strategy 1: Direct match on maisha_transaction_id
    const { data: orderByTxId } = await supabase
      .from('orders')
      .select('id, status, total_usd, total_cdf, user_id')
      .eq('maisha_transaction_id', reference)
      .maybeSingle();

    if (orderByTxId) {
      order = orderByTxId;
      console.log('[Maisha Callback] Found order by transaction ID');
    }

    // Strategy 2: Look up via maisha_payments table
    if (!order) {
      const { data: payment } = await supabase
        .from('maisha_payments')
        .select('order_id')
        .eq('maisha_reference', reference)
        .maybeSingle();

      if (payment?.order_id) {
        const { data: orderFromPayment } = await supabase
          .from('orders')
          .select('id, status, total_usd, total_cdf, user_id')
          .eq('id', payment.order_id)
          .maybeSingle();

        if (orderFromPayment) {
          order = orderFromPayment;
          console.log('[Maisha Callback] Found order via payment record');
        }
      }
    }

    // Strategy 3: Extract order ID from reference pattern (AFRISHOP-{id8}-{timestamp})
    if (!order && reference.includes('-')) {
      const parts = reference.split('-');
      if (parts.length >= 2) {
        const partialId = parts[1];
        const { data: orderByPartial } = await supabase
          .from('orders')
          .select('id, status, total_usd, total_cdf, user_id')
          .ilike('id', `${partialId}%`)
          .maybeSingle();

        if (orderByPartial) {
          order = orderByPartial;
          console.log('[Maisha Callback] Found order by partial ID match');
        }
      }
    }

    if (!order) {
      console.warn('[Maisha Callback] Order not found for reference:', reference);
      return new Response(JSON.stringify({ success: true, message: 'Order not found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Maisha Callback] Processing order:', order.id, 'current status:', order.status);

    // Build update data
    const orderUpdate: any = {
      maisha_transaction_id: reference,
      operator_ref_id: operatorRefId || null,
      maisha_status_code: String(status) || null,
      maisha_description: description || null,
      updated_at: new Date().toISOString(),
    };

    // Update status based on payment result
    if (normalizedStatus === 'paid') {
      orderUpdate.status = 'PAID';
      orderUpdate.maisha_payment_status = 'paid';
      orderUpdate.payment_verified_at = new Date().toISOString();
    } else if (normalizedStatus === 'failed') {
      orderUpdate.maisha_payment_status = 'failed';
    } else if (normalizedStatus === 'cancelled') {
      orderUpdate.maisha_payment_status = 'cancelled';
    } else {
      orderUpdate.maisha_payment_status = 'pending';
    }

    // Update order
    const { error: updateError } = await supabase
      .from('orders')
      .update(orderUpdate)
      .eq('id', order.id);

    if (updateError) {
      console.error('[Maisha Callback] Order update error:', updateError);
    } else {
      console.log('[Maisha Callback] Order updated to:', orderUpdate.status || order.status);
    }

    // Update maisha_payments record - try by reference first, then by order_id
    const paymentUpdateData = {
      status: normalizedStatus,
      paid_at: normalizedStatus === 'paid' ? new Date().toISOString() : null,
      raw_response: payload,
      maishapay_transaction_ref_id: reference,
      maishapay_operator_ref_id: operatorRefId || null,
      maishapay_status: String(status),
      maishapay_description: description || null,
      updated_at: new Date().toISOString(),
    };

    // Try updating by maisha_reference first
    const { data: refUpdateResult, error: paymentRefError } = await supabase
      .from('maisha_payments')
      .update(paymentUpdateData)
      .eq('maisha_reference', reference)
      .select('id');

    if (paymentRefError) {
      console.error('[Maisha Callback] Payment update by reference error:', paymentRefError);
    }

    // If no rows updated by reference, try by order_id
    if (!refUpdateResult || refUpdateResult.length === 0) {
      console.log('[Maisha Callback] No payment found by reference, trying order_id:', order.id);
      const { error: orderIdError } = await supabase
        .from('maisha_payments')
        .update(paymentUpdateData)
        .eq('order_id', order.id);

      if (orderIdError) {
        console.error('[Maisha Callback] Payment update by order_id error:', orderIdError);
      } else {
        console.log('[Maisha Callback] Payment record updated by order_id');
      }
    } else {
      console.log('[Maisha Callback] Payment record updated by reference');
    }

    // Send notifications on successful payment
    if (normalizedStatus === 'paid') {
      console.log('[Maisha Callback] Payment successful - sending notifications');

      // Send payment confirmation email to customer
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
        console.log('[Maisha Callback] Payment confirmation email sent');
      } catch (emailError) {
        console.error('[Maisha Callback] Email error (non-blocking):', emailError);
      }

      // Notify admin
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
        console.log('[Maisha Callback] Admin notification sent');
      } catch (adminError) {
        console.error('[Maisha Callback] Admin notification error (non-blocking):', adminError);
      }
    }

    console.log('[Maisha Callback] Processing complete');

    // Always return 200 OK
    return new Response(JSON.stringify({ 
      success: true, 
      orderId: order.id,
      status: normalizedStatus,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[Maisha Callback] Error:', error);
    
    // Always return 200 to prevent MaishaPay retries
    return new Response(JSON.stringify({ 
      success: true, 
      error: error.message,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
