import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { normalizePaymentStatus } from "../_shared/maishapay.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
};

// Input validation schema
const verifyPaymentSchema = z.object({
  orderId: z.string().uuid(),
  status: z.union([z.string(), z.number()]),
  description: z.string().max(500).optional().default(''),
  transactionRefId: z.string().max(255).optional().default(''),
  operatorRefId: z.string().max(255).optional().default(''),
});

/**
 * HMAC-SHA256 signature verification for webhook security
 */
async function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) {
    console.warn('[verify-payment] Missing signature or secret for webhook verification');
    return false;
  }

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

    // Constant-time comparison to prevent timing attacks
    if (computedSignature.length !== signature.length) {
      return false;
    }
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

/**
 * verify-payment Edge Function
 * 
 * Called by mobile app after WebView detects MaishaPay redirect to callback URL.
 * Updates order status based on MaishaPay response parameters.
 * 
 * SECURITY: Requires one of:
 * 1. Valid webhook signature (x-webhook-signature header)
 * 2. Valid JWT token (user must own the order)
 * 3. Service role key (internal calls)
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('[verify-payment] Request received');

    // Read raw body for signature verification
    const rawBody = await req.text();
    
    // Parse and validate request body
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
      console.error('[verify-payment] Validation error:', parseResult.error.errors);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid request data',
          details: parseResult.error.errors,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId, status, description, transactionRefId, operatorRefId } = parseResult.data;

    // ========== SECURITY: Authorization Check ==========
    const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
    const signature = req.headers.get('x-webhook-signature');
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let isAuthorized = false;
    let authMethod = 'none';
    let authenticatedUserId: string | null = null;

    // Method 1: Webhook signature verification (for MaishaPay callbacks)
    if (webhookSecret && signature) {
      isAuthorized = await verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (isAuthorized) {
        authMethod = 'webhook';
        console.log('[verify-payment] Authorized via webhook signature');
      }
    }

    // Method 2: JWT token verification (for authenticated users)
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
        console.log('[verify-payment] Authorized via JWT for user:', user.id);
      }
    }

    // Method 3: Service role key (for internal calls)
    if (!isAuthorized && authHeader === `Bearer ${supabaseServiceKey}`) {
      isAuthorized = true;
      authMethod = 'service_role';
      console.log('[verify-payment] Authorized via service role key');
    }

    // Reject if no valid authorization
    if (!isAuthorized) {
      console.warn('[verify-payment] Unauthorized request for order:', orderId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Unauthorized', 
          message: 'Valid webhook signature or authentication required' 
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ========== END SECURITY CHECK ==========

    // Create Supabase client with service_role key to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the order to verify it exists
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, user_id, total_usd, total_cdf, maisha_transaction_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('[verify-payment] Order not found:', orderId, orderError);
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SECURITY: If authenticated via JWT, verify user owns the order
    if (authMethod === 'jwt' && authenticatedUserId && order.user_id !== authenticatedUserId) {
      console.warn('[verify-payment] User', authenticatedUserId, 'attempted to verify order', orderId, 'owned by', order.user_id);
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden', message: 'You do not own this order' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[verify-payment] Found order:', { id: order.id, currentStatus: order.status, authMethod });

    // Prevent re-processing of already completed orders
    if (order.status === 'PAID' || order.status === 'COMPLETED' || order.status === 'SHIPPED' || order.status === 'DELIVERED') {
      console.log('[verify-payment] Order already processed, returning current state');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Order already processed',
          order: {
            id: order.id,
            status: order.status,
            totalUsd: order.total_usd,
            totalCdf: order.total_cdf,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only allow status updates for PENDING_PAYMENT orders
    if (order.status !== 'PENDING_PAYMENT') {
      console.log('[verify-payment] Order not in PENDING_PAYMENT state:', order.status);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid order state',
          message: `Order status is ${order.status}, expected PENDING_PAYMENT`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize MaishaPay status code
    const normalizedStatus = normalizePaymentStatus(status);
    console.log('[verify-payment] Status mapping:', { raw: status, normalized: normalizedStatus });

    // Map to order status
    let newOrderStatus: string;
    let maishapayStatus: string;

    switch (normalizedStatus) {
      case 'paid':
        newOrderStatus = 'PAID';
        maishapayStatus = 'SUCCESS';
        break;
      case 'cancelled':
        newOrderStatus = 'PENDING_PAYMENT'; // Keep as pending so user can retry
        maishapayStatus = 'CANCELLED';
        break;
      case 'failed':
        newOrderStatus = 'CANCELLED';
        maishapayStatus = 'FAILED';
        break;
      default:
        newOrderStatus = 'PENDING_PAYMENT';
        maishapayStatus = 'PENDING';
    }

    console.log('[verify-payment] Updating order to:', { newOrderStatus, maishapayStatus });

    // Update the order
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: newOrderStatus,
        maisha_payment_status: maishapayStatus,
        maisha_status_code: String(status),
        maisha_description: description || null,
        operator_ref_id: operatorRefId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select('id, status, total_usd, total_cdf, maisha_transaction_id, maisha_payment_status, maisha_status_code, maisha_description, operator_ref_id')
      .single();

    if (updateError) {
      console.error('[verify-payment] Failed to update order:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[verify-payment] Order updated successfully');

    // Update maisha_payments table
    const { error: paymentUpdateError } = await supabase
      .from('maisha_payments')
      .update({
        status: normalizedStatus,
        maishapay_status: maishapayStatus,
        maishapay_transaction_ref_id: transactionRefId || null,
        maishapay_operator_ref_id: operatorRefId || null,
        maishapay_description: description || null,
        paid_at: normalizedStatus === 'paid' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('order_id', orderId);

    if (paymentUpdateError) {
      console.warn('[verify-payment] Failed to update maisha_payments:', paymentUpdateError);
      // Don't fail the request, order is already updated
    }

    // Generate order reference for display
    const orderRef = orderId.substring(0, 8).toUpperCase();

    return new Response(
      JSON.stringify({
        success: true,
        order: {
          id: updatedOrder.id,
          orderRef,
          status: updatedOrder.status,
          paymentStatus: updatedOrder.maisha_payment_status,
          totalUsd: updatedOrder.total_usd,
          totalCdf: updatedOrder.total_cdf,
          transactionRef: updatedOrder.maisha_transaction_id,
          operatorRef: updatedOrder.operator_ref_id,
          statusCode: updatedOrder.maisha_status_code,
          description: updatedOrder.maisha_description,
        },
        authMethod,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[verify-payment] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
