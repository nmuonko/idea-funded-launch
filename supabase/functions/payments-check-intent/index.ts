/**
 * Check Payment Intent Status
 * 
 * Returns the current status of a payment intent.
 * Primary source of truth is the database (updated by webhooks).
 * Optional fallback to provider API for stale pending payments.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/http.ts";

const corsHeaders = getCorsHeaders();
import { getProviderByKey } from "../_shared/paymentProviders.ts";
import { verifyDeposit, getPawaPayConfig } from "../_shared/pawapayAdapter.ts";
import { verifyPaymentIntent, getStripeConfig } from "../_shared/stripeAdapter.ts";

interface RequestBody {
  intentId: string;
}

interface ResponseBody {
  success: boolean;
  intentId?: string;
  status?: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  provider?: string;
  currency?: string;
  amount?: number;
  paid_at?: string;
  error?: string;
  error_code?: string;
}

// How long before we consider refreshing from provider API
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization required', error_code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body: RequestBody = await req.json();
    const { intentId } = body;

    if (!intentId) {
      return new Response(
        JSON.stringify({ success: false, error: 'intentId is required', error_code: 'MISSING_INTENT_ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[payments-check-intent] Checking:', intentId);

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication', error_code: 'INVALID_AUTH' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch payment record
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select(`
        id,
        order_id,
        provider_key,
        amount,
        currency,
        status,
        provider_deposit_id,
        paid_at,
        updated_at,
        orders!inner (user_id)
      `)
      .eq('id', intentId)
      .single();

    if (paymentError || !payment) {
      console.error('[payments-check-intent] Payment not found:', paymentError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Payment not found', error_code: 'PAYMENT_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership
    const orderUserId = (payment.orders as any)?.user_id;
    if (orderUserId !== user.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authorized to view this payment', error_code: 'NOT_AUTHORIZED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if we should refresh from provider API
    let currentStatus = payment.status;
    let paidAt = payment.paid_at;

    if (currentStatus === 'pending' && payment.provider_deposit_id) {
      const updatedAt = new Date(payment.updated_at).getTime();
      const now = Date.now();
      const isStale = (now - updatedAt) > STALE_THRESHOLD_MS;

      if (isStale) {
        console.log('[payments-check-intent] Status stale, refreshing from provider API');

        try {
          if (payment.provider_key === 'pawapay') {
            const provider = await getProviderByKey(supabaseAdmin, 'pawapay');
            if (provider) {
              const config = getPawaPayConfig(provider);
              const verifyResult = await verifyDeposit(config, payment.provider_deposit_id);
              
              if (verifyResult.success && verifyResult.status !== 'pending') {
                currentStatus = verifyResult.status;
                paidAt = verifyResult.paid_at;
                
                // Update database
                await supabaseAdmin
                  .from('payments')
                  .update({
                    status: currentStatus,
                    paid_at: paidAt,
                    provider_transaction_id: verifyResult.provider_transaction_id,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', intentId);

                // Update order if succeeded
                if (currentStatus === 'succeeded') {
                  await supabaseAdmin
                    .from('orders')
                    .update({ status: 'PAID' })
                    .eq('id', payment.order_id);
                }
              }
            }
          } else if (payment.provider_key === 'stripe') {
            const provider = await getProviderByKey(supabaseAdmin, 'stripe');
            if (provider) {
              const config = getStripeConfig(provider);
              const verifyResult = await verifyPaymentIntent(config, payment.provider_deposit_id);
              
              if (verifyResult.success && verifyResult.status !== 'pending') {
                currentStatus = verifyResult.status;
                paidAt = verifyResult.paid_at;
                
                // Update database
                await supabaseAdmin
                  .from('payments')
                  .update({
                    status: currentStatus,
                    paid_at: paidAt,
                    provider_transaction_id: verifyResult.provider_transaction_id,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', intentId);

                // Update order if succeeded
                if (currentStatus === 'succeeded') {
                  await supabaseAdmin
                    .from('orders')
                    .update({ status: 'PAID' })
                    .eq('id', payment.order_id);
                }
              }
            }
          }
        } catch (refreshError: any) {
          console.warn('[payments-check-intent] Failed to refresh from provider:', refreshError.message);
          // Continue with cached status
        }
      }
    }

    // Map status for response
    let responseStatus: ResponseBody['status'] = 'pending';
    if (currentStatus === 'succeeded' || currentStatus === 'paid') {
      responseStatus = 'succeeded';
    } else if (currentStatus === 'failed' || currentStatus === 'rejected') {
      responseStatus = 'failed';
    } else if (currentStatus === 'cancelled' || currentStatus === 'canceled') {
      responseStatus = 'cancelled';
    } else if (currentStatus === 'processing') {
      responseStatus = 'processing';
    }

    const result: ResponseBody = {
      success: true,
      intentId: payment.id,
      status: responseStatus,
      provider: payment.provider_key,
      currency: payment.currency,
      amount: payment.amount,
      paid_at: paidAt || undefined,
    };

    console.log('[payments-check-intent] Result:', {
      intentId: result.intentId,
      status: result.status,
      provider: result.provider,
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[payments-check-intent] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred while checking payment status', error_code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
