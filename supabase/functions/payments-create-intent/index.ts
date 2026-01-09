/**
 * Unified Payment Intent Creation Endpoint
 * 
 * Automatically selects the appropriate payment provider and currency based on:
 * - Vehicle orders OR amount >= CAR_THRESHOLD_USD → Stripe (USD, card)
 * - Regular orders → pawaPay (auto USD/CDF based on amount)
 * 
 * Input: { order_id, phone? }
 * Frontend doesn't need to specify method or currency.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";
import {
  getProviderByKey,
  createPaymentRecord,
  generatePaymentReference,
} from "../_shared/paymentProviders.ts";
import { detectVehicleOrder } from "../_shared/vehiclePaymentGuard.ts";
import {
  createDeposit,
  getPawaPayConfig,
  PawaPayConfig,
} from "../_shared/pawapayAdapter.ts";
import {
  createPaymentIntent,
  getStripeConfig,
  StripeConfig,
} from "../_shared/stripeAdapter.ts";

// Constants
const DEFAULT_CAR_THRESHOLD_USD = 10000;
const PAWAPAY_USD_THRESHOLD = 5000; // Above this, use CDF for pawaPay

interface RequestBody {
  order_id: string;
  phone?: string;
}

interface ResponseBody {
  success: boolean;
  intentId?: string;
  provider?: string;
  status?: string;
  currency?: string;
  amount?: number;
  nextAction?: {
    type: 'STRIPE' | 'POLL' | 'REDIRECT';
    clientSecret?: string;
    depositId?: string;
    redirectUrl?: string;
  };
  error?: string;
  error_code?: string;
}

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
    const { order_id, phone } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'order_id is required', error_code: 'MISSING_ORDER_ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[payments-create-intent] Request:', { order_id, hasPhone: !!phone });

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

    // Fetch order with items
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        user_id,
        status,
        total_usd,
        total_cdf,
        contains_vehicle,
        exchange_rate_used
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      console.error('[payments-create-intent] Order not found:', orderError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found', error_code: 'ORDER_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership
    if (order.user_id !== user.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authorized to pay for this order', error_code: 'NOT_AUTHORIZED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check order status
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'DRAFT') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Order is in ${order.status} status, cannot process payment`,
          error_code: 'INVALID_ORDER_STATUS'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch CAR_THRESHOLD_USD from settings
    let carThresholdUsd = DEFAULT_CAR_THRESHOLD_USD;
    const { data: thresholdSetting } = await supabaseAdmin
      .from('admin_settings')
      .select('value')
      .eq('key', 'car_threshold_usd')
      .single();
    
    if (thresholdSetting?.value) {
      carThresholdUsd = parseFloat(thresholdSetting.value) || DEFAULT_CAR_THRESHOLD_USD;
    }

    // Detect vehicle status
    const vehicleDetection = await detectVehicleOrder(supabaseAdmin, order_id);
    const isVehicle = vehicleDetection.isVehicle || order.contains_vehicle === true;
    const totalUsd = order.total_usd || 0;
    const totalCdf = order.total_cdf || 0;
    const exchangeRate = order.exchange_rate_used || 2800;

    console.log('[payments-create-intent] Order analysis:', {
      totalUsd,
      totalCdf,
      isVehicle,
      vehicleReasons: vehicleDetection.reasons,
      carThresholdUsd,
    });

    // ==================== Provider Selection Logic ====================
    let selectedProvider: string;
    let selectedCurrency: 'USD' | 'CDF';
    let payableAmount: number;

    if (isVehicle || totalUsd >= carThresholdUsd) {
      // High-value or vehicle order → Stripe (USD, card)
      selectedProvider = 'stripe';
      selectedCurrency = 'USD';
      payableAmount = totalUsd;
      
      console.log('[payments-create-intent] Selected Stripe for vehicle/high-value order');
    } else {
      // Regular order → pawaPay with auto currency selection
      selectedProvider = 'pawapay';
      
      if (totalUsd <= PAWAPAY_USD_THRESHOLD) {
        // Small amounts → USD
        selectedCurrency = 'USD';
        payableAmount = totalUsd;
      } else {
        // Larger amounts → CDF (to avoid provider USD limits)
        selectedCurrency = 'CDF';
        payableAmount = totalCdf > 0 ? totalCdf : Math.round(totalUsd * exchangeRate);
      }
      
      console.log('[payments-create-intent] Selected pawaPay:', { selectedCurrency, payableAmount });
    }

    // Get user profile for email
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, phone')
      .eq('user_id', user.id)
      .single();

    const customerEmail = profile?.email || user.email || '';
    const customerPhone = phone || profile?.phone || '';

    // Generate payment reference
    const reference = generatePaymentReference(order_id);

    // ==================== Execute Payment Based on Provider ====================
    let result: ResponseBody;

    if (selectedProvider === 'stripe') {
      // === STRIPE FLOW ===
      const stripeProvider = await getProviderByKey(supabaseAdmin, 'stripe');
      
      if (!stripeProvider || !stripeProvider.is_enabled) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Card payments are not currently available. Please try mobile money.',
            error_code: 'STRIPE_NOT_ENABLED'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let stripeConfig: StripeConfig;
      try {
        stripeConfig = getStripeConfig(stripeProvider);
      } catch (err: any) {
        console.error('[payments-create-intent] Stripe config error:', err.message);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Card payment service is not configured',
            error_code: 'STRIPE_NOT_CONFIGURED'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create payment record first
      const paymentRecord = await createPaymentRecord(supabaseAdmin, {
        order_id,
        provider_key: 'stripe',
        amount: payableAmount,
        currency: selectedCurrency,
        reference,
        country: 'ALL',
        status: 'pending',
      });

      if (!paymentRecord) {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create payment record', error_code: 'DB_ERROR' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create Stripe PaymentIntent
      const stripeResult = await createPaymentIntent(stripeConfig, {
        orderId: order_id,
        userId: user.id,
        intentId: paymentRecord.id,
        amount: payableAmount,
        description: `AfriShop Order ${order_id.slice(0, 8)}`,
      });

      if (!stripeResult.success || !stripeResult.client_secret) {
        console.error('[payments-create-intent] Stripe error:', stripeResult.error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: stripeResult.error || 'Failed to create payment',
            error_code: 'STRIPE_ERROR'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update payment record with Stripe details
      await supabaseAdmin
        .from('payments')
        .update({
          provider_deposit_id: stripeResult.provider_deposit_id,
          client_secret: stripeResult.client_secret,
          status: 'pending',
          raw_request: stripeResult.raw_request,
        })
        .eq('id', paymentRecord.id);

      // Update order status
      await supabaseAdmin
        .from('orders')
        .update({ status: 'PENDING_PAYMENT' })
        .eq('id', order_id);

      result = {
        success: true,
        intentId: paymentRecord.id,
        provider: 'stripe',
        status: 'processing',
        currency: selectedCurrency,
        amount: payableAmount,
        nextAction: {
          type: 'STRIPE',
          clientSecret: stripeResult.client_secret,
        },
      };

    } else if (selectedProvider === 'pawapay') {
      // === PAWAPAY FLOW ===
      if (!customerPhone) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Phone number is required for mobile money payments',
            error_code: 'PHONE_REQUIRED'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const pawapayProvider = await getProviderByKey(supabaseAdmin, 'pawapay');
      
      if (!pawapayProvider || !pawapayProvider.is_enabled) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Mobile money payments are not currently available',
            error_code: 'PAWAPAY_NOT_ENABLED'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let pawapayConfig: PawaPayConfig;
      try {
        pawapayConfig = getPawaPayConfig(pawapayProvider);
      } catch (err: any) {
        console.error('[payments-create-intent] pawaPay config error:', err.message);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Mobile money service is not configured',
            error_code: 'PAWAPAY_NOT_CONFIGURED'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create payment record first
      const paymentRecord = await createPaymentRecord(supabaseAdmin, {
        order_id,
        provider_key: 'pawapay',
        amount: payableAmount,
        currency: selectedCurrency,
        reference,
        customer_phone: customerPhone,
        country: 'COD',
        status: 'pending',
      });

      if (!paymentRecord) {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create payment record', error_code: 'DB_ERROR' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create pawaPay deposit (reusing existing adapter)
      const depositResult = await createDeposit(pawapayConfig, {
        orderId: order_id,
        amount: payableAmount,
        currency: selectedCurrency,
        customerPhone,
        customerEmail,
        reference,
        description: `AfriShop ${order_id.slice(0, 8)}`,
      });

      if (!depositResult.success) {
        console.error('[payments-create-intent] pawaPay error:', depositResult.error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: depositResult.error || 'Failed to initiate mobile money payment',
            error_code: 'PAWAPAY_ERROR'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update payment record with deposit ID
      await supabaseAdmin
        .from('payments')
        .update({
          provider_deposit_id: depositResult.provider_deposit_id,
          status: 'pending',
          raw_request: depositResult.raw_request,
          raw_events: [depositResult.raw_response],
        })
        .eq('id', paymentRecord.id);

      // Update order status
      await supabaseAdmin
        .from('orders')
        .update({ status: 'PENDING_PAYMENT' })
        .eq('id', order_id);

      result = {
        success: true,
        intentId: paymentRecord.id,
        provider: 'pawapay',
        status: 'processing',
        currency: selectedCurrency,
        amount: payableAmount,
        nextAction: {
          type: 'POLL',
          depositId: depositResult.provider_deposit_id,
        },
      };

    } else {
      // Unknown provider (shouldn't happen)
      return new Response(
        JSON.stringify({ success: false, error: 'No payment provider available', error_code: 'NO_PROVIDER' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[payments-create-intent] Success:', {
      intentId: result.intentId,
      provider: result.provider,
      currency: result.currency,
      amount: result.amount,
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[payments-create-intent] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error', error_code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
