import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePaymentStatus, getMaishaPayConfig } from "../_shared/maishapay.ts";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { generateTraceId, logAudit } from "../_shared/auditLog.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-maishapay-signature',
};

// Input validation for callback payload
function validateCallbackPayload(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (data.status !== undefined && data.status !== null) {
    const statusStr = String(data.status);
    if (statusStr.length > 50) {
      errors.push('status exceeds max length (50)');
    }
  }
  
  const refFields = ['reference', 'transactionRefId', 'transaction_ref_id', 'ref', 'operatorRefId'];
  for (const field of refFields) {
    if (data[field] && typeof data[field] === 'string' && data[field].length > 255) {
      errors.push(`${field} exceeds max length (255)`);
    }
  }
  
  if (data.description && typeof data.description === 'string' && data.description.length > 500) {
    errors.push('description exceeds max length (500)');
  }
  
  if (data.amount !== undefined && data.amount !== null) {
    const amount = Number(data.amount);
    if (isNaN(amount) || amount < 0 || amount > 1000000000) {
      errors.push('amount is invalid or out of range');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// HMAC signature verification
async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<{ valid: boolean; reason: string }> {
  const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
  
  if (!webhookSecret) {
    console.error('[MaishaPay Callback] CRITICAL: MAISHAPAY_WEBHOOK_SECRET not configured - rejecting request');
    return { valid: false, reason: 'webhook_secret_not_configured' };
  }
  
  if (!signature) {
    console.warn('[MaishaPay Callback] Webhook secret configured but no signature provided - rejecting');
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
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(rawBody)
    );
    
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = generateTraceId();
  console.log('[MaishaPay Callback] Received request:', req.method, 'trace:', traceId);

  try {
    const config = getMaishaPayConfig();
    console.log(`[MaishaPay Callback] Processing callback (${config.mode} mode)...`);

    const rawBody = await req.text();
    
    // Verify webhook signature for POST requests
    if (req.method === 'POST') {
      const signature = req.headers.get('x-maishapay-signature') || 
                        req.headers.get('x-webhook-signature') ||
                        req.headers.get('x-signature');
      
      const verification = await verifyWebhookSignature(rawBody, signature);
      
      if (!verification.valid) {
        console.error('[MaishaPay Callback] Invalid webhook signature:', verification.reason);
        return new Response(JSON.stringify({ 
          status: 'error', 
          message: 'Invalid or missing signature',
          reason: verification.reason
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Parse payment data
    let paymentData: any = {};
    
    const url = new URL(req.url);
    if (url.searchParams.toString()) {
      for (const [key, value] of url.searchParams.entries()) {
        paymentData[key] = value;
      }
    }

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

    console.log('[MaishaPay Callback] Payment data:', JSON.stringify(paymentData, null, 2));

    // Validate callback payload
    const validation = validateCallbackPayload(paymentData);
    if (!validation.valid) {
      console.warn('[MaishaPay Callback] Payload validation warnings:', validation.errors);
    }

    // Extract reference
    const reference = paymentData.reference || 
                      paymentData.transactionRefId || 
                      paymentData.transaction_ref_id ||
                      paymentData.ref;
    
    const rawStatus = paymentData.status || paymentData.transactionStatus || paymentData.transaction_status;
    const operatorRefId = paymentData.operatorRefId || paymentData.operator_ref_id || null;
    
    console.log('[MaishaPay Callback] Extracted:', { reference, rawStatus, operatorRefId });

    // Normalize status
    const normalizedStatus = normalizePaymentStatus(rawStatus);
    console.log('[MaishaPay Callback] Normalized status:', normalizedStatus);

    if (!reference) {
      console.error('[MaishaPay Callback] No reference provided');
      return new Response(JSON.stringify({ 
        status: 'error', 
        message: 'No reference provided',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find order by reference
    let order: any = null;
    let orderId = '';

    // Try exact match on maisha_transaction_id
    const { data: orderByRef } = await supabaseClient
      .from('orders')
      .select('id, status, total_usd, total_cdf, user_id')
      .eq('maisha_transaction_id', reference)
      .maybeSingle();

    if (orderByRef) {
      order = orderByRef;
      orderId = order.id;
    } else {
      // Try partial match
      const parts = reference.split('-');
      if (parts.length >= 2) {
        const partialOrderId = parts[1];
        
        const { data: orderByPartial } = await supabaseClient
          .from('orders')
          .select('id, status, total_usd, total_cdf, user_id')
          .ilike('id', `${partialOrderId}%`)
          .maybeSingle();
        
        if (orderByPartial) {
          order = orderByPartial;
          orderId = order.id;
        }
      }
    }

    // Try maisha_payments table
    if (!order) {
      const { data: payment } = await supabaseClient
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

    // Log to audit
    await logAudit(supabaseClient, {
      traceId,
      eventType: 'CALLBACK_RECEIVED',
      userId: order.user_id,
      orderId,
      payload: { reference, rawStatus, normalizedStatus },
    });

    // ============================================
    // P0 FIX: Use finalize_paid_order RPC for atomicity
    // ============================================
    if (normalizedStatus === 'succeeded') {
      console.log('[MaishaPay Callback] Payment SUCCESS - calling finalize_paid_order RPC');
      
      const { data: rpcResult, error: rpcError } = await supabaseClient.rpc('finalize_paid_order', {
        p_order_id: orderId,
        p_payment_ref: paymentData.transactionRefId || reference,
        p_operator_ref: operatorRefId,
        p_trace_id: traceId,
      });

      if (rpcError) {
        console.error('[MaishaPay Callback] finalize_paid_order RPC error:', rpcError);
        // Fallback to direct update
        await supabaseClient.from('orders').update({
          status: 'PAID',
          maisha_payment_status: 'SUCCESS',
          operator_ref_id: operatorRefId,
          payment_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', orderId);
      } else {
        console.log('[MaishaPay Callback] finalize_paid_order result:', rpcResult);
      }

      // Send notifications
      supabaseClient.functions.invoke('send-payment-confirmation', {
        body: { orderId, paymentData },
      }).catch(err => console.error('[MaishaPay Callback] Error sending confirmation:', err));

      supabaseClient.functions.invoke('send-admin-payment-notification', {
        body: { orderId, paymentData, mode: config.mode },
      }).catch(err => console.error('[MaishaPay Callback] Error notifying admin:', err));

    } else if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') {
      // Keep as PENDING_PAYMENT for retry
      await supabaseClient.from('orders').update({
        maisha_payment_status: normalizedStatus === 'failed' ? 'FAILED' : 'CANCELLED',
        maisha_status_code: String(rawStatus),
        maisha_description: paymentData.description || null,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);

      await supabaseClient.from('maisha_payments').update({
        status: normalizedStatus,
        maishapay_status: String(rawStatus),
        maishapay_description: paymentData.description || null,
        updated_at: new Date().toISOString(),
      }).eq('order_id', orderId);

      console.log(`[MaishaPay Callback] Payment ${normalizedStatus.toUpperCase()} - order stays PENDING_PAYMENT`);
    }

    console.log('[MaishaPay Callback] Processing complete');

    // Handle redirect vs JSON response
    const isUserRedirect = req.method === 'GET' || url.searchParams.has('status');
    
    if (isUserRedirect) {
      const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop.lovable.app';
      const successUrl = Deno.env.get('MAISHAPAY_FRONTEND_SUCCESS_URL') || `${frontendBaseUrl}/payment/success`;
      const failUrl = Deno.env.get('MAISHAPAY_FRONTEND_FAIL_URL') || `${frontendBaseUrl}/payment/fail`;
      
      let redirectUrl: string;
      if (normalizedStatus === 'succeeded') {
        redirectUrl = `${successUrl}?order_id=${orderId}&status=success&reference=${reference}`;
      } else if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') {
        redirectUrl = `${failUrl}?order_id=${orderId}&status=${normalizedStatus}&reference=${reference}`;
      } else {
        redirectUrl = `${successUrl}?order_id=${orderId}&status=pending&reference=${reference}`;
      }
      
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, 'Location': redirectUrl },
      });
    }

    return new Response(JSON.stringify({ 
      status: 'ok',
      success: true,
      orderId,
      paymentStatus: normalizedStatus,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[MaishaPay Callback] Exception:', error);
    
    return new Response(JSON.stringify({ 
      status: 'error',
      message: 'An error occurred processing the callback'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(handler);
