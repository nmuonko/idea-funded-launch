/**
 * Unified Payment Intent Creation Endpoint
 * 
 * Uses per-provider limits from config_public.limits to automatically select
 * the appropriate payment provider and currency.
 * 
 * Routing algorithm:
 * 1. Load enabled providers (is_enabled=true)
 * 2. Filter by currency support (Stripe=USD only, pawaPay=USD/CDF)
 * 3. Filter by limits: min <= amount <= max (null max = unlimited)
 * 4. Choose provider with lowest priority value
 * 5. If none qualify: return error with limit details
 * 
 * Input: { order_id, phone? }
 * Frontend doesn't need to specify method or currency.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/http.ts";

const corsHeaders = getCorsHeaders();
import {
  createPaymentRecord,
  generatePaymentReference,
  selectProviderByLimits,
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

interface RequestBody {
  order_id: string;
  phone?: string;
  currency?: 'USD' | 'CDF'; // Optional: user can request specific currency
  provider?: 'pawapay' | 'stripe' | 'bank_transfer'; // Optional: explicit provider selection
}

// Structured error codes for client handling
type ErrorCode = 
  | 'AUTH_REQUIRED'
  | 'INVALID_AUTH'
  | 'MISSING_ORDER_ID'
  | 'ORDER_NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'INVALID_ORDER_STATUS'
  | 'CART_NOT_FOUND'
  | 'PROVIDER_NOT_ALLOWED'
  | 'NO_PROVIDER'
  | 'PHONE_REQUIRED'
  | 'STRIPE_NOT_CONFIGURED'
  | 'STRIPE_ERROR'
  | 'PAWAPAY_NOT_CONFIGURED'
  | 'PAWAPAY_ERROR'
  | 'DB_ERROR'
  | 'INTERNAL_ERROR';

interface ResponseBody {
  success: boolean;
  intentId?: string;
  provider?: string;
  status?: string;
  currency?: string;
  amount?: number;
  nextAction?: {
    type: 'STRIPE' | 'POLL' | 'REDIRECT' | 'BANK_TRANSFER';
    clientSecret?: string;
    depositId?: string;
    redirectUrl?: string;
  };
  error?: string;
  error_code?: ErrorCode;
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
    const { order_id, phone, currency: requestedCurrency, provider: requestedProvider } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'order_id is required', error_code: 'MISSING_ORDER_ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize requested currency (default to USD)
    const normalizedCurrency: 'USD' | 'CDF' = requestedCurrency?.toUpperCase() === 'CDF' ? 'CDF' : 'USD';

    console.log('[payments-create-intent] Request:', { 
      order_id, 
      hasPhone: !!phone, 
      currency: normalizedCurrency,
      requestedProvider: requestedProvider || 'auto'
    });

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

    // STEP: Verify order has items (this is the "cart" for this order)
    const { data: orderItems, error: itemsError } = await supabaseAdmin
      .from('order_items')
      .select('id, is_saved_for_later, total_price_usd, is_vehicle')
      .eq('order_id', order_id)
      .eq('is_saved_for_later', false);

    if (itemsError) {
      console.error('[payments-create-intent] Error fetching order items:', itemsError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch order items', error_code: 'DB_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!orderItems || orderItems.length === 0) {
      console.error('[payments-create-intent] Order has no active items:', order_id);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cart not found or no longer active. Please add items before paying.',
          error_code: 'CART_NOT_FOUND'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[payments-create-intent] Order has', orderItems.length, 'active items');

    // Detect vehicle status
    const vehicleDetection = await detectVehicleOrder(supabaseAdmin, order_id);
    const isVehicle = vehicleDetection.isVehicle || order.contains_vehicle === true;
    const totalUsd = order.total_usd || 0;
    const totalCdf = order.total_cdf || 0;
    const exchangeRate = order.exchange_rate_used || 2800;
    
    // Ensure CDF amount is calculated if not present
    const effectiveCdf = totalCdf > 0 ? totalCdf : Math.round(totalUsd * exchangeRate);

    console.log('[payments-create-intent] Order analysis:', {
      totalUsd,
      totalCdf: effectiveCdf,
      isVehicle,
      vehicleReasons: vehicleDetection.reasons,
      itemCount: orderItems.length,
    });

    // ==================== Fetch payment limits for validation ====================
    const { data: paymentSettings } = await supabaseAdmin
      .from('payment_settings')
      .select('mobile_money_max_usd, mobile_money_max_cdf, pawapay_enabled, stripe_enabled, bank_transfer_enabled')
      .single();

    const pawapayMaxUsd = paymentSettings?.mobile_money_max_usd || 5000;
    const stripeEnabled = paymentSettings?.stripe_enabled !== false;
    const pawapayEnabled = paymentSettings?.pawapay_enabled !== false;
    const bankTransferEnabled = paymentSettings?.bank_transfer_enabled !== false;

    // ==================== Provider Validation for Explicit Selection ====================
    if (requestedProvider) {
      console.log('[payments-create-intent] Validating explicit provider:', requestedProvider);
      
      if (requestedProvider === 'pawapay') {
        if (!pawapayEnabled) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Mobile money is currently disabled',
              error_code: 'PROVIDER_NOT_ALLOWED'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (totalUsd > pawapayMaxUsd) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: `Mobile money maximum is $${pawapayMaxUsd.toLocaleString()}. Please choose Card or Bank Transfer.`,
              error_code: 'PROVIDER_NOT_ALLOWED'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (isVehicle) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Mobile money is not available for vehicle purchases',
              error_code: 'PROVIDER_NOT_ALLOWED'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else if (requestedProvider === 'stripe') {
        if (!stripeEnabled) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Card payments are currently disabled',
              error_code: 'PROVIDER_NOT_ALLOWED'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else if (requestedProvider === 'bank_transfer') {
        if (!bankTransferEnabled) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Bank transfers are currently disabled',
              error_code: 'PROVIDER_NOT_ALLOWED'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // Bank transfer: return success with BANK_TRANSFER nextAction
        console.log('[payments-create-intent] Bank transfer selected');
        
        // Update order to PENDING_PAYMENT
        await supabaseAdmin
          .from('orders')
          .update({ status: 'PENDING_PAYMENT' })
          .eq('id', order_id);

        return new Response(
          JSON.stringify({
            success: true,
            provider: 'bank_transfer',
            status: 'awaiting_transfer',
            currency: 'USD',
            amount: totalUsd,
            nextAction: {
              type: 'BANK_TRANSFER',
            },
            message: 'Please complete bank transfer using the provided details.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ==================== Provider Selection Logic ====================
    // Use vehicle detection and requested currency (no limit-based switching)
    // Note: If requestedProvider was explicitly validated above, we still use selectProviderByLimits
    // for automatic selection when no explicit provider is specified
    const selectionResult = await selectProviderByLimits(
      supabaseAdmin,
      totalUsd,
      effectiveCdf,
      isVehicle,
      normalizedCurrency
    );

    // Handle vehicle orders that require bank transfer
    if (!selectionResult.success) {
      if (selectionResult.error === 'VEHICLE_BANK_TRANSFER_REQUIRED') {
        console.log('[payments-create-intent] Vehicle order requires bank transfer');
        return new Response(
          JSON.stringify({
            success: true,
            provider: 'bank_transfer',
            status: 'requires_bank_transfer',
            currency: 'USD',
            amount: totalUsd,
            nextAction: {
              type: 'BANK_TRANSFER',
            },
            message: 'Vehicle orders require bank transfer or card payment. Please contact support.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.error('[payments-create-intent] No provider found:', selectionResult.error);
      return new Response(
        JSON.stringify({
          success: false,
          error: selectionResult.error || 'No payment provider available',
          error_code: 'NO_PROVIDER',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // At this point we have a valid provider and currency
    const selectedProvider = selectionResult.provider!;
    const selectedCurrency = selectionResult.currency!;
    const selectedProviderKey = selectedProvider.provider_key;
    const payableAmount = selectedCurrency === 'USD' ? totalUsd : effectiveCdf;

    console.log('[payments-create-intent] Provider selected:', {
      provider: selectedProviderKey,
      currency: selectedCurrency,
      amount: payableAmount,
      priority: selectedProvider.priority,
    });

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

    if (selectedProviderKey === 'stripe') {
      // === STRIPE FLOW ===
      // Provider already validated by selectProviderByLimits
      let stripeConfig: StripeConfig;
      try {
        stripeConfig = getStripeConfig(selectedProvider);
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

    } else if (selectedProviderKey === 'pawapay') {
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

      // Provider already validated by selectProviderByLimits
      let pawapayConfig: PawaPayConfig;
      try {
        pawapayConfig = getPawaPayConfig(selectedProvider);
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
