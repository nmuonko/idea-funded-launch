/**
 * Stripe Checkout Session Verifier
 * 
 * Verifies payment status of a Stripe Checkout Session and updates DB accordingly.
 * 
 * ENHANCED 2026-01:
 * - Uses centralized stripeKeyResolver for consistent key selection
 * - Enhanced diagnostics logging with [STRIPE_VERIFY_*] markers
 * - Proper error codes for mobile handling
 * 
 * POST /functions/v1/stripe-verify-checkout-session
 * Input: { "order_id": "uuid", "session_id": "cs_..." }
 * 
 * OR GET with query params: ?order_id=uuid&session_id=cs_...
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { 
  resolveAndLogStripeKey, 
  getKeyDiagnostics 
} from "../_shared/stripeKeyResolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

interface RequestBody {
  order_id: string;
  session_id: string;
}

interface VerifyResponse {
  ok: boolean; // Added for consistency with other endpoints
  success: boolean;
  order_id: string;
  session_id: string;
  status: 'succeeded' | 'paid' | 'pending' | 'failed' | 'expired';
  stripe_status?: string;
  payment_status?: string;
  payment_intent?: string;
  paid_at?: string;
  key_mode?: 'live' | 'test';
  error?: string;
  error_code?: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  console.log(`[STRIPE_VERIFY] Request started`, { requestId, method: req.method });

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized', error_code: 'UNAUTHORIZED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token', error_code: 'UNAUTHORIZED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log(`[STRIPE_VERIFY] User authenticated`, { requestId, userId });

    // Parse input from body (POST) or query params (GET)
    let order_id: string;
    let session_id: string;

    if (req.method === 'POST') {
      const body: RequestBody = await req.json();
      order_id = body.order_id;
      session_id = body.session_id;
    } else if (req.method === 'GET') {
      const url = new URL(req.url);
      order_id = url.searchParams.get('order_id') || url.searchParams.get('orderId') || '';
      session_id = url.searchParams.get('session_id') || '';
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed', error_code: 'METHOD_NOT_ALLOWED' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!order_id || !session_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing order_id or session_id', error_code: 'MISSING_PARAMS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[STRIPE_VERIFY] Verifying session`, { requestId, orderId: order_id, sessionId: session_id });

    // Verify user owns this order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, status')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      console.error(`[STRIPE_VERIFY] Order not found`, { requestId, orderId: order_id, error: orderError });
      return new Response(
        JSON.stringify({ success: false, order_id, session_id, status: 'pending', error: 'Order not found', error_code: 'ORDER_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.user_id !== userId) {
      console.warn(`[STRIPE_VERIFY] Unauthorized access attempt`, { requestId, orderId: order_id, userId, orderUserId: order.user_id });
      return new Response(
        JSON.stringify({ success: false, order_id, session_id, status: 'pending', error: 'Unauthorized', error_code: 'UNAUTHORIZED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use enhanced key resolution
    const keyResult = resolveAndLogStripeKey('stripe-verify-checkout-session', undefined, {
      requestId,
      orderId: order_id,
      sessionId: session_id,
    });

    if (!keyResult.success || !keyResult.keyInfo) {
      console.error(`[STRIPE_VERIFY] Key resolution failed:`, { 
        requestId, 
        error: keyResult.error,
        error_code: keyResult.error_code,
      });
      return new Response(
        JSON.stringify({ 
          ok: false,
          success: false, 
          order_id, 
          session_id, 
          status: 'pending', 
          error: keyResult.error || 'Stripe not configured', 
          error_code: keyResult.error_code || 'CONFIG_ERROR' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const stripeSecretKey = keyResult.keyInfo.secretKey;
    const keyMode = keyResult.keyInfo.mode;

    // Retrieve Checkout Session from Stripe
    console.log(`[STRIPE_VERIFY] Fetching Stripe session`, { 
      requestId, 
      sessionId: session_id,
      key_mode: keyMode,
      key_prefix: keyResult.keyInfo.keyPrefix,
    });

    const stripeResponse = await fetch(`${STRIPE_API_BASE}/checkout/sessions/${session_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
      },
    });

    if (stripeResponse.status === 404) {
      console.error(`[STRIPE_VERIFY] Session not found on Stripe`, { requestId, sessionId: session_id });
      return new Response(
        JSON.stringify({ 
          success: false, 
          order_id, 
          session_id, 
          status: 'pending', 
          error: 'Checkout session not found', 
          error_code: 'SESSION_NOT_FOUND' 
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const stripeSession = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(`[STRIPE_VERIFY] Stripe API error`, { requestId, error: stripeSession });
      return new Response(
        JSON.stringify({ 
          success: false, 
          order_id, 
          session_id, 
          status: 'pending', 
          error: stripeSession.error?.message || 'Stripe API error', 
          error_code: 'STRIPE_ERROR' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const paymentStatus = stripeSession.payment_status;
    const stripeStatus = stripeSession.status;
    const paymentIntent = stripeSession.payment_intent;

    console.log(`[STRIPE_VERIFY] Session status`, { 
      requestId, 
      orderId: order_id, 
      sessionId: session_id,
      paymentStatus,
      stripeStatus,
      paymentIntent,
    });

    // Determine our normalized status - MUST use 'succeeded' for frontend compatibility
    let normalizedStatus: 'succeeded' | 'pending' | 'failed' | 'expired';
    const now = new Date().toISOString();
    
    if (paymentStatus === 'paid' || stripeStatus === 'complete') {
      normalizedStatus = 'succeeded';  // CRITICAL: Frontend expects 'succeeded', not 'paid'
    } else if (stripeStatus === 'expired') {
      normalizedStatus = 'expired';
    } else if (paymentStatus === 'unpaid') {
      normalizedStatus = 'pending';
    } else {
      normalizedStatus = 'pending';
    }

    // If paid, update all relevant tables with CANONICAL FIELDS
    if (normalizedStatus === 'succeeded') {
      console.log(`[STRIPE_VERIFY] Payment confirmed, updating DB`, { requestId, orderId: order_id });

      // Update payments table - CANONICAL: status = 'succeeded', paid_at = now
      const { error: paymentUpdateError } = await supabase
        .from('payments')
        .update({
          status: 'succeeded',
          provider_transaction_id: paymentIntent,
          paid_at: now,
          updated_at: now,
          raw_events: stripeSession,
        })
        .eq('order_id', order_id)
        .eq('provider_key', 'stripe_checkout')
        .eq('provider_deposit_id', session_id);

      if (paymentUpdateError) {
        console.warn(`[STRIPE_VERIFY] Failed to update payment record`, { requestId, error: paymentUpdateError });
      }

      // Update order status to PAID - CANONICAL: status = 'PAID', payment_verified_at = now
      if (order.status !== 'PAID') {
        const { error: orderUpdateError } = await supabase
          .from('orders')
          .update({
            status: 'PAID',
            payment_verified_at: now,
            payment_verification_method: 'stripe_checkout',
            updated_at: now,
          })
          .eq('id', order_id);

        if (orderUpdateError) {
          console.error(`[STRIPE_VERIFY] Failed to update order status`, { requestId, error: orderUpdateError });
        }
      }

      // Update checkout_sessions if present
      const { error: sessionUpdateError } = await supabase
        .from('checkout_sessions')
        .update({
          status: 'completed',
          paid_at: now,
          updated_at: now,
        })
        .eq('order_id', order_id)
        .eq('status', 'pending');

      if (sessionUpdateError) {
        console.warn(`[STRIPE_VERIFY] Failed to update checkout_session`, { requestId, error: sessionUpdateError });
      }

      console.log(`[STRIPE_VERIFY] DB updated successfully`, { requestId, orderId: order_id });
    }

    // Log verification summary
    console.log(`[STRIPE_VERIFY_SUMMARY]`, {
      requestId,
      orderId: order_id,
      sessionId: session_id,
      normalizedStatus,
      paymentStatus,
      stripeStatus,
      paymentIntent: paymentIntent || null,
      key_mode: keyMode,
    });

    const response: VerifyResponse = {
      ok: normalizedStatus === 'succeeded',
      success: normalizedStatus === 'succeeded',
      order_id,
      session_id,
      status: normalizedStatus,
      stripe_status: stripeStatus,
      payment_status: paymentStatus,
      payment_intent: paymentIntent || undefined,
      paid_at: normalizedStatus === 'succeeded' ? now : undefined,
      key_mode: keyMode,
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[STRIPE_VERIFY] Unhandled error`, { requestId, error: error.message, stack: error.stack });
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'An error occurred while verifying payment',
        error_code: 'INTERNAL_ERROR',
        status: 'pending',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
