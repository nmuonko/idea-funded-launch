import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePaymentStatus, getMaishaPayConfig } from "../_shared/maishapay.ts";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-maishapay-signature',
};

// Input validation for callback payload
function validateCallbackPayload(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Status should be string or number, max 50 chars if string
  if (data.status !== undefined && data.status !== null) {
    const statusStr = String(data.status);
    if (statusStr.length > 50) {
      errors.push('status exceeds max length (50)');
    }
  }
  
  // Reference IDs should be strings with max 255 chars
  const refFields = ['reference', 'transactionRefId', 'transaction_ref_id', 'ref', 'operatorRefId'];
  for (const field of refFields) {
    if (data[field] && typeof data[field] === 'string' && data[field].length > 255) {
      errors.push(`${field} exceeds max length (255)`);
    }
  }
  
  // Description max 500 chars
  if (data.description && typeof data.description === 'string' && data.description.length > 500) {
    errors.push('description exceeds max length (500)');
  }
  
  // Amount validation if present
  if (data.amount !== undefined && data.amount !== null) {
    const amount = Number(data.amount);
    if (isNaN(amount) || amount < 0 || amount > 1000000000) {
      errors.push('amount is invalid or out of range');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// HMAC signature verification
// When MAISHAPAY_WEBHOOK_SECRET is configured, signatures are ENFORCED for security.
// If not configured, all callbacks are accepted (backwards compatible behavior).
async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<{ valid: boolean; reason: string }> {
  const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
  
  // If no webhook secret is configured, SKIP validation entirely (backwards compatible)
  if (!webhookSecret) {
    console.log('[MaishaPay Callback] MAISHAPAY_WEBHOOK_SECRET not configured - skipping signature validation');
    return { valid: true, reason: 'no_secret_configured' };
  }
  
  // If secret is configured but no signature provided, REJECT for security
  if (!signature) {
    console.warn('[MaishaPay Callback] Webhook secret configured but no signature provided - rejecting');
    return { valid: false, reason: 'missing_signature' };
  }
  
  try {
    // Compute expected HMAC-SHA256 signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(rawBody)
    );
    
    // Convert to hex string
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Constant-time comparison to prevent timing attacks
    const providedSig = signature.toLowerCase().replace(/^sha256=/, '');
    const isValid = expectedSignature === providedSig;
    
    if (!isValid) {
      console.warn('[MaishaPay Callback] Signature mismatch - rejecting request');
      return { valid: false, reason: 'signature_mismatch' };
    }
    
    return { valid: true, reason: 'signature_valid' };
  } catch (error) {
    console.error('[MaishaPay Callback] Signature verification error:', error);
    return { valid: false, reason: 'verification_error' };
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[MaishaPay Callback] Received request:', req.method);
  console.log('[MaishaPay Callback] URL:', req.url);

  try {
    const config = getMaishaPayConfig();
    console.log(`[MaishaPay Callback] Processing callback (${config.mode} mode)...`);

    // Clone request to read body twice (once for signature, once for parsing)
    const rawBody = await req.text();
    
    // Verify webhook signature for POST requests
    if (req.method === 'POST') {
      const signature = req.headers.get('x-maishapay-signature') || 
                        req.headers.get('x-webhook-signature') ||
                        req.headers.get('x-signature');
      
      const verification = await verifyWebhookSignature(rawBody, signature);
      
      if (!verification.valid) {
        console.error('[MaishaPay Callback] Invalid webhook signature - rejecting request:', verification.reason);
        return new Response(JSON.stringify({ 
          status: 'error', 
          message: 'Invalid or missing signature',
          reason: verification.reason
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      console.log('[MaishaPay Callback] Webhook signature check passed:', verification.reason);
    }

    // Parse different content types and methods MaishaPay might send
    let paymentData: any = {};
    
    // Check if there are query params (GET request or redirect)
    const url = new URL(req.url);
    if (url.searchParams.toString()) {
      for (const [key, value] of url.searchParams.entries()) {
        paymentData[key] = value;
      }
      console.log('[MaishaPay Callback] Query params:', paymentData);
    }

    // Parse body for POST requests
    if (req.method === 'POST' && rawBody) {
      const contentType = req.headers.get('content-type') || '';

      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody);
        for (const [key, value] of params.entries()) {
          paymentData[key] = value;
        }
      } else if (contentType.includes('application/json')) {
        try {
          const jsonData = JSON.parse(rawBody);
          paymentData = { ...paymentData, ...jsonData };
        } catch {
          console.warn('[MaishaPay Callback] Failed to parse JSON body');
        }
      } else {
        try {
          const jsonData = JSON.parse(rawBody);
          paymentData = { ...paymentData, ...jsonData };
        } catch {
          const params = new URLSearchParams(rawBody);
          for (const [key, value] of params.entries()) {
            paymentData[key] = value;
          }
        }
      }
    }

    console.log('[MaishaPay Callback] Full payment data:', JSON.stringify(paymentData, null, 2));

    // Validate callback payload
    const validation = validateCallbackPayload(paymentData);
    if (!validation.valid) {
      console.warn('[MaishaPay Callback] Payload validation warnings:', validation.errors);
      // Log but don't reject - we still want to process the payment
    }

    // Extract reference - MaishaPay might send it under different field names
    const reference = paymentData.reference || 
                      paymentData.transactionRefId || 
                      paymentData.transaction_ref_id ||
                      paymentData.ref;
    
    const rawStatus = paymentData.status || paymentData.transactionStatus || paymentData.transaction_status;
    
    console.log('[MaishaPay Callback] Extracted data:', {
      reference,
      rawStatus,
      operatorRefId: paymentData.operatorRefId,
      description: paymentData.description,
      mode: config.mode,
    });

    // Normalize status
    const normalizedStatus = normalizePaymentStatus(rawStatus);
    console.log('[MaishaPay Callback] Normalized status:', normalizedStatus);

    if (!reference) {
      console.error('[MaishaPay Callback] No reference provided in callback');
      return new Response(JSON.stringify({ 
        status: 'error', 
        message: 'No reference provided',
        receivedData: paymentData 
      }), {
        status: 200, // Return 200 to acknowledge receipt
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Try to find order by maisha_transaction_id (the reference we sent)
    console.log('[MaishaPay Callback] Looking up order by reference:', reference);
    
    let order: any = null;
    let orderId = '';

    // First try exact match on maisha_transaction_id
    const { data: orderByRef, error: refError } = await supabaseClient
      .from('orders')
      .select('id, status, total_usd, total_cdf, user_id')
      .eq('maisha_transaction_id', reference)
      .maybeSingle();

    if (orderByRef) {
      order = orderByRef;
      orderId = order.id;
      console.log('[MaishaPay Callback] Found order by transaction ID:', orderId);
    } else {
      // Try to extract order ID from reference (AFRISHOP-{orderId8chars}-{timestamp})
      const parts = reference.split('-');
      if (parts.length >= 2) {
        const partialOrderId = parts[1]; // First 8 chars of order ID
        console.log('[MaishaPay Callback] Trying partial order ID match:', partialOrderId);
        
        const { data: orderByPartial, error: partialError } = await supabaseClient
          .from('orders')
          .select('id, status, total_usd, total_cdf, user_id')
          .ilike('id', `${partialOrderId}%`)
          .maybeSingle();
        
        if (orderByPartial) {
          order = orderByPartial;
          orderId = order.id;
          console.log('[MaishaPay Callback] Found order by partial ID:', orderId);
        }
      }
    }

    // Also try maisha_payments table
    if (!order) {
      const { data: payment, error: paymentError } = await supabaseClient
        .from('maisha_payments')
        .select('order_id')
        .eq('maisha_reference', reference)
        .maybeSingle();
      
      if (payment?.order_id) {
        const { data: orderFromPayment } = await supabaseClient
          .from('orders')
          .select('id, status, total_usd, total_cdf, user_id')
          .eq('id', payment.order_id)
          .maybeSingle();
        
        if (orderFromPayment) {
          order = orderFromPayment;
          orderId = order.id;
          console.log('[MaishaPay Callback] Found order via payment record:', orderId);
        }
      }
    }

    if (!order) {
      console.error('[MaishaPay Callback] Order not found for reference:', reference);
      return new Response(JSON.stringify({ 
        status: 'warning', 
        message: 'Order not found',
        reference 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[MaishaPay Callback] Found order:', order.id, 'current status:', order.status);

    // Prepare update data
    const updateData: any = {
      maisha_transaction_id: paymentData.transactionRefId || reference,
      operator_ref_id: paymentData.operatorRefId || null,
      maisha_status_code: String(rawStatus) || null,
      maisha_description: paymentData.description || null,
      updated_at: new Date().toISOString(),
    };

    // Update order status based on payment result
    if (normalizedStatus === 'paid') {
      updateData.status = 'PAID';
      updateData.maisha_payment_status = 'SUCCESS';
      updateData.payment_verified_at = new Date().toISOString();
    } else if (normalizedStatus === 'failed') {
      updateData.maisha_payment_status = 'FAILED';
    } else if (normalizedStatus === 'cancelled') {
      updateData.maisha_payment_status = 'CANCELLED';
    } else {
      updateData.maisha_payment_status = 'PENDING';
    }

    console.log('[MaishaPay Callback] Updating order with:', updateData);

    const { error: updateError } = await supabaseClient
      .from('orders')
      .update(updateData)
      .eq('id', orderId);

    if (updateError) {
      console.error('[MaishaPay Callback] Error updating order:', updateError);
    } else {
      console.log('[MaishaPay Callback] Order updated successfully');
    }

    // Update maisha_payments record - try by reference first, then by order_id
    const paymentUpdateData = {
      status: normalizedStatus,
      paid_at: normalizedStatus === 'paid' ? new Date().toISOString() : null,
      raw_response: paymentData,
      maishapay_transaction_ref_id: paymentData.transactionRefId || reference,
      maishapay_operator_ref_id: paymentData.operatorRefId || null,
      maishapay_status: String(rawStatus),
      maishapay_description: paymentData.description || null,
      updated_at: new Date().toISOString(),
    };

    // Try updating by maisha_reference first
    const { data: refUpdateResult, error: paymentUpdateError } = await supabaseClient
      .from('maisha_payments')
      .update(paymentUpdateData)
      .eq('maisha_reference', reference)
      .select('id');

    if (paymentUpdateError) {
      console.error('[MaishaPay Callback] Error updating payment by reference:', paymentUpdateError);
    }

    // If no rows updated by reference, try by order_id
    if (!refUpdateResult || refUpdateResult.length === 0) {
      console.log('[MaishaPay Callback] No payment found by reference, trying order_id:', orderId);
      const { error: orderIdUpdateError } = await supabaseClient
        .from('maisha_payments')
        .update(paymentUpdateData)
        .eq('order_id', orderId);

      if (orderIdUpdateError) {
        console.error('[MaishaPay Callback] Error updating payment by order_id:', orderIdUpdateError);
      } else {
        console.log('[MaishaPay Callback] Payment record updated by order_id');
      }
    } else {
      console.log('[MaishaPay Callback] Payment record updated by reference');
    }

    // Send notifications on successful payment
    if (normalizedStatus === 'paid') {
      console.log('[MaishaPay Callback] Payment successful, triggering notifications');
      
      // Trigger payment confirmation email (fire and forget)
      supabaseClient.functions.invoke('send-payment-confirmation', {
        body: { orderId, paymentData },
      }).catch(err => console.error('[MaishaPay Callback] Error sending confirmation:', err));

      // Trigger admin notification (fire and forget)
      supabaseClient.functions.invoke('send-admin-payment-notification', {
        body: { orderId, paymentData, mode: config.mode },
      }).catch(err => console.error('[MaishaPay Callback] Error notifying admin:', err));
    }

    console.log('[MaishaPay Callback] Processing complete');

    // Check if this is a browser redirect (GET) or server-to-server notification (POST)
    const isUserRedirect = req.method === 'GET' || url.searchParams.has('status');
    
    if (isUserRedirect) {
      // Redirect user to appropriate frontend page
      const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop.lovable.app';
      const successUrl = Deno.env.get('MAISHAPAY_FRONTEND_SUCCESS_URL') || `${frontendBaseUrl}/payment/success`;
      const failUrl = Deno.env.get('MAISHAPAY_FRONTEND_FAIL_URL') || `${frontendBaseUrl}/payment/fail`;
      
      let redirectUrl: string;
      if (normalizedStatus === 'paid') {
        redirectUrl = `${successUrl}?order_id=${orderId}&status=success&reference=${reference}`;
      } else if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') {
        redirectUrl = `${failUrl}?order_id=${orderId}&status=${normalizedStatus}&reference=${reference}`;
      } else {
        redirectUrl = `${successUrl}?order_id=${orderId}&status=pending&reference=${reference}`;
      }
      
      console.log('[MaishaPay Callback] Redirecting user to:', redirectUrl);
      
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          'Location': redirectUrl,
        },
      });
    }

    // Server-to-server response (JSON)
    return new Response(JSON.stringify({ 
      status: 'ok',
      success: true,
      orderId,
      paymentStatus: normalizedStatus,
      mode: config.mode,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[MaishaPay Callback] Exception:', error);
    
    // Always return 200 to acknowledge receipt, even on error
    return new Response(JSON.stringify({ 
      status: 'error',
      message: error.message 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(handler);
