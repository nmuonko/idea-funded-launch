import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { normalizePaymentStatus as normalizeProviderStatus } from "../_shared/paymentProviders.ts";
import { generateTraceId, logAudit } from "../_shared/auditLog.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
};

const verifyPaymentSchema = z.object({
  orderId: z.string().uuid(),
  status: z.union([z.string(), z.number()]),
  description: z.string().max(500).optional().default(''),
  transactionRefId: z.string().max(255).optional().default(''),
  operatorRefId: z.string().max(255).optional().default(''),
  currency: z.string().max(10).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
});

async function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedSignature.length !== signature.length) return false;
    let result = 0;
    for (let i = 0; i < computedSignature.length; i++) {
      result |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  } catch (error) {
    console.error('[verify-payment] Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const traceId = generateTraceId();

  try {
    console.log('[verify-payment] Request received, trace:', traceId);

    const rawBody = await req.text();
    
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parseResult = verifyPaymentSchema.safeParse(body);
    if (!parseResult.success) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request data', details: parseResult.error.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId, status, description, transactionRefId, operatorRefId } = parseResult.data;

    // Authorization check
    const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
    const signature = req.headers.get('x-webhook-signature');
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let isAuthorized = false;
    let authMethod = 'none';
    let authenticatedUserId: string | null = null;

    // Webhook signature
    if (webhookSecret && signature) {
      isAuthorized = await verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (isAuthorized) authMethod = 'webhook';
    }

    // JWT token
    if (!isAuthorized && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });

      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (!authError && user) {
        authenticatedUserId = user.id;
        isAuthorized = true;
        authMethod = 'jwt';
      }
    }

    // Service role
    if (!isAuthorized && authHeader === `Bearer ${supabaseServiceKey}`) {
      isAuthorized = true;
      authMethod = 'service_role';
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, user_id, total_usd, total_cdf, maisha_transaction_id, normalized_currency, exchange_rate_used')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // JWT user must own the order
    if (authMethod === 'jwt' && authenticatedUserId && order.user_id !== authenticatedUserId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Already processed?
    if (['PAID', 'COMPLETED', 'SHIPPED', 'READY_FOR_PICKUP'].includes(order.status)) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Order already processed',
          order: { id: order.id, status: order.status, totalUsd: order.total_usd, totalCdf: order.total_cdf },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Must be PENDING_PAYMENT
    if (order.status !== 'PENDING_PAYMENT') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid order state', message: `Order status is ${order.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize status using provider-specific logic (pawaPay or generic)
    const pawaStatus = normalizeProviderStatus('pawapay', String(status));
    const normalizedStatus = pawaStatus === 'succeeded' ? 'paid' : pawaStatus;
    console.log('[verify-payment] Status:', { raw: status, normalized: normalizedStatus });

    // Log to audit
    await logAudit(supabase, {
      traceId,
      eventType: 'VERIFY_PAYMENT_REQUEST',
      userId: order.user_id,
      orderId,
      payload: { normalizedStatus, authMethod },
    });

    // ============================================
    // P0 FIX: Use finalize_paid_order RPC for atomicity
    // ============================================
    if (normalizedStatus === 'paid') {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('finalize_paid_order', {
        p_order_id: orderId,
        p_payment_ref: transactionRefId || order.maisha_transaction_id,
        p_operator_ref: operatorRefId || null,
        p_trace_id: traceId,
      });

      if (rpcError) {
        console.error('[verify-payment] finalize_paid_order RPC error:', rpcError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to finalize order' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[verify-payment] finalize_paid_order result:', rpcResult);

      // Fetch updated order
      const { data: updatedOrder } = await supabase
        .from('orders')
        .select('id, status, total_usd, total_cdf, maisha_transaction_id, maisha_payment_status, operator_ref_id')
        .eq('id', orderId)
        .single();

      const orderRef = orderId.substring(0, 8).toUpperCase();
      const expectedCurrency = order.normalized_currency || 'USD';

      return new Response(
        JSON.stringify({
          success: true,
          order: {
            id: updatedOrder?.id || orderId,
            orderRef,
            status: updatedOrder?.status || 'PAID',
            paymentStatus: 'SUCCESS',
            totalUsd: updatedOrder?.total_usd,
            totalCdf: updatedOrder?.total_cdf,
            currency: expectedCurrency,
            exchangeRate: order.exchange_rate_used || 2500,
            transactionRef: updatedOrder?.maisha_transaction_id,
            operatorRef: updatedOrder?.operator_ref_id,
          },
          authMethod,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // Failed/cancelled - keep as PENDING_PAYMENT for retry
      const maishapayStatus = normalizedStatus === 'failed' ? 'FAILED' : normalizedStatus === 'cancelled' ? 'CANCELLED' : 'PENDING';
      
      await supabase.from('orders').update({
        maisha_payment_status: maishapayStatus,
        maisha_status_code: String(status),
        maisha_description: description || null,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);

      await supabase.from('maisha_payments').update({
        status: normalizedStatus,
        maishapay_status: maishapayStatus,
        maishapay_description: description || null,
        updated_at: new Date().toISOString(),
      }).eq('order_id', orderId);

      const orderRef = orderId.substring(0, 8).toUpperCase();

      return new Response(
        JSON.stringify({
          success: true,
          order: {
            id: orderId,
            orderRef,
            status: 'PENDING_PAYMENT',
            paymentStatus: maishapayStatus,
            totalUsd: order.total_usd,
            totalCdf: order.total_cdf,
          },
          authMethod,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: unknown) {
    console.error('[verify-payment] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
