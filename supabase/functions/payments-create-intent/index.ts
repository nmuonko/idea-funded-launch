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
  payment_method_preference?: 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER'; // Alternative explicit selection
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
  | 'STRIPE_AUTH_FAILED'
  | 'STRIPE_ERROR'
  | 'PAWAPAY_NOT_CONFIGURED'
  | 'PAWAPAY_AUTH_FAILED'
  | 'PAWAPAY_UNAVAILABLE'
  | 'PAWAPAY_PROVIDER_ERROR'
  | 'PAWAPAY_VALIDATION'
  | 'PAWAPAY_ERROR'
  | 'DB_ERROR'
  | 'INTERNAL_ERROR';

interface ResponseBody {
  success: boolean;
  requestId: string; // Always include for tracing
  intentId?: string;
  provider?: string;
  requestedProvider?: string; // Echo what was requested
  providerSelection?: 'explicit' | 'auto'; // How provider was chosen
  status?: string;
  currency?: string;
  amount?: number;
  clientSecret?: string; // Top-level for mobile SDK compatibility
  depositId?: string; // P0: Top-level for mobile app pawaPay compatibility
  payment_flow?: 'STRIPE' | 'PAWAPAY' | 'BANK_TRANSFER'; // P0: Payment flow type
  message?: string; // User-facing message (English)
  message_fr?: string; // User-facing message (French)
  nextAction?: {
    type: 'PAYMENT_SHEET' | 'POLL' | 'REDIRECT' | 'BANK_TRANSFER'; // PAYMENT_SHEET for mobile SDK
    clientSecret?: string;
    depositId?: string;
    redirectUrl?: string;
  };
  error?: string;
  error_code?: ErrorCode;
  allowed_methods?: string[]; // Returned when PROVIDER_NOT_ALLOWED
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Generate requestId at the very top of request handling
  const requestId = crypto.randomUUID();

  try {
    // Log entry point for AAB debugging
    const authHeader = req.headers.get('Authorization');
    console.log('[PAYMENT_INTENT_ENTRY]', {
      requestId,
      method: req.method,
      hasAuth: !!authHeader,
      userAgent: req.headers.get('user-agent')?.slice(0, 100),
      timestamp: new Date().toISOString(),
    });

    // Auth check
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, requestId, error: 'Authorization required', error_code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body: RequestBody = await req.json();
    const { order_id, phone, currency: requestedCurrency, provider: bodyProvider, payment_method_preference } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ success: false, requestId, error: 'order_id is required', error_code: 'MISSING_ORDER_ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize explicit provider request from either field
    // payment_method_preference: CARD -> stripe, MOBILE_MONEY -> pawapay, BANK_TRANSFER -> bank_transfer
    let requestedProvider: 'pawapay' | 'stripe' | 'bank_transfer' | undefined = bodyProvider;
    if (!requestedProvider && payment_method_preference) {
      if (payment_method_preference === 'CARD') requestedProvider = 'stripe';
      else if (payment_method_preference === 'MOBILE_MONEY') requestedProvider = 'pawapay';
      else if (payment_method_preference === 'BANK_TRANSFER') requestedProvider = 'bank_transfer';
    }

    // Normalize requested currency (default to USD)
    const normalizedCurrency: 'USD' | 'CDF' = requestedCurrency?.toUpperCase() === 'CDF' ? 'CDF' : 'USD';

    // Log provider request for diagnostics
    console.log('[CREATE_INTENT_PROVIDER_REQ]', { 
      order_id, 
      requestedProvider: requestedProvider || null,
      payment_method_preference: payment_method_preference || null,
      currency: normalizedCurrency,
    });

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
        JSON.stringify({ success: false, requestId, error: 'Invalid authentication', error_code: 'INVALID_AUTH' }),
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
      console.error('[payments-create-intent] Order not found:', { requestId, error: orderError?.message });
      return new Response(
        JSON.stringify({ success: false, requestId, error: 'Order not found', error_code: 'ORDER_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership
    if (order.user_id !== user.id) {
      return new Response(
        JSON.stringify({ success: false, requestId, error: 'Not authorized to pay for this order', error_code: 'NOT_AUTHORIZED' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check order status
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'DRAFT') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          requestId,
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
      console.error('[payments-create-intent] Error fetching order items:', { requestId, error: itemsError.message });
      return new Response(
        JSON.stringify({ success: false, requestId, error: 'Failed to fetch order items', error_code: 'DB_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!orderItems || orderItems.length === 0) {
      console.error('[payments-create-intent] Order has no active items:', { requestId, order_id });
      return new Response(
        JSON.stringify({ 
          success: false, 
          requestId,
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

    // Build allowed methods list for error responses
    const allowedMethods: string[] = [];
    if (stripeEnabled) allowedMethods.push('CARD');
    if (pawapayEnabled && totalUsd <= pawapayMaxUsd && !isVehicle) allowedMethods.push('MOBILE_MONEY');
    if (bankTransferEnabled) allowedMethods.push('BANK_TRANSFER');

    // ==================== Provider Selection Logic ====================
    // Track whether we're using explicit or auto selection
    let providerSelection: 'explicit' | 'auto' = 'auto';
    let selectedProviderKey: 'stripe' | 'pawapay' | 'bank_transfer';
    let selectedCurrency: 'USD' | 'CDF' = normalizedCurrency;

    if (requestedProvider) {
      // ========== EXPLICIT PROVIDER SELECTION ==========
      console.log('[payments-create-intent] Validating explicit provider:', requestedProvider);
      
      if (requestedProvider === 'pawapay') {
        if (!pawapayEnabled) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              requestId,
              error: 'Mobile money is currently disabled',
              error_code: 'PROVIDER_NOT_ALLOWED',
              requested_provider: 'pawapay',
              allowed_methods: allowedMethods,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (totalUsd > pawapayMaxUsd) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              requestId,
              error: `Mobile money maximum is $${pawapayMaxUsd.toLocaleString()}. Please choose Card or Bank Transfer.`,
              error_code: 'PROVIDER_NOT_ALLOWED',
              requested_provider: 'pawapay',
              allowed_methods: allowedMethods.filter(m => m !== 'MOBILE_MONEY'),
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (isVehicle) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              requestId,
              error: 'Mobile money is not available for vehicle purchases',
              error_code: 'PROVIDER_NOT_ALLOWED',
              requested_provider: 'pawapay',
              allowed_methods: allowedMethods.filter(m => m !== 'MOBILE_MONEY'),
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // EXPLICIT pawapay allowed - FORCE it
        selectedProviderKey = 'pawapay';
        providerSelection = 'explicit';
        
      } else if (requestedProvider === 'stripe') {
        if (!stripeEnabled) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              requestId,
              error: 'Card payments are currently disabled',
              error_code: 'PROVIDER_NOT_ALLOWED',
              requested_provider: 'stripe',
              allowed_methods: allowedMethods.filter(m => m !== 'CARD'),
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // EXPLICIT stripe allowed - FORCE it (Stripe only supports USD)
        selectedProviderKey = 'stripe';
        selectedCurrency = 'USD';
        providerSelection = 'explicit';
        
      } else if (requestedProvider === 'bank_transfer') {
        if (!bankTransferEnabled) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              requestId,
              error: 'Bank transfers are currently disabled',
              error_code: 'PROVIDER_NOT_ALLOWED',
              requested_provider: 'bank_transfer',
              allowed_methods: allowedMethods.filter(m => m !== 'BANK_TRANSFER'),
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // Bank transfer: return success with BANK_TRANSFER nextAction
        console.log('[CREATE_INTENT_PROVIDER_DECISION]', {
          finalProvider: 'bank_transfer',
          reason: 'explicit',
          amount: totalUsd,
          currency: 'USD',
          requestedProvider: 'bank_transfer',
        });
        
        // Update order to PENDING_PAYMENT
        await supabaseAdmin
          .from('orders')
          .update({ status: 'PENDING_PAYMENT' })
          .eq('id', order_id);

        return new Response(
          JSON.stringify({
            success: true,
            requestId,
            provider: 'bank_transfer',
            requestedProvider: 'bank_transfer',
            providerSelection: 'explicit',
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
      } else {
        // Unknown provider requested
        return new Response(
          JSON.stringify({ 
            success: false, 
            requestId,
            error: `Unknown provider: ${requestedProvider}`,
            error_code: 'PROVIDER_NOT_ALLOWED',
            requested_provider: requestedProvider,
            allowed_methods: allowedMethods,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // ========== AUTO PROVIDER SELECTION ==========
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
          console.log('[CREATE_INTENT_PROVIDER_DECISION]', {
            finalProvider: 'bank_transfer',
            reason: 'auto_vehicle',
            amount: totalUsd,
            currency: 'USD',
          });
          return new Response(
            JSON.stringify({
              success: true,
              provider: 'bank_transfer',
              providerSelection: 'auto',
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
            allowed_methods: allowedMethods,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Use auto-selected provider
      selectedProviderKey = selectionResult.provider!.provider_key as 'stripe' | 'pawapay';
      selectedCurrency = selectionResult.currency!;
      providerSelection = 'auto';
    }

    // Calculate payable amount based on currency
    const payableAmount = selectedCurrency === 'USD' ? totalUsd : effectiveCdf;

    // Fetch the provider record for config extraction
    const { data: providerRecord } = await supabaseAdmin
      .from('payment_providers')
      .select('*')
      .eq('provider_key', selectedProviderKey)
      .eq('is_enabled', true)
      .single();

    // Log the final provider decision
    console.log('[CREATE_INTENT_PROVIDER_DECISION]', {
      finalProvider: selectedProviderKey,
      reason: providerSelection,
      amount: payableAmount,
      currency: selectedCurrency,
      requestedProvider: requestedProvider || null,
    });

    console.log('[payments-create-intent] Provider selected:', {
      provider: selectedProviderKey,
      currency: selectedCurrency,
      amount: payableAmount,
      providerSelection,
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
        stripeConfig = getStripeConfig(providerRecord);
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

      console.log('[STRIPE_PI_CREATE_REQ]', {
        orderId: order_id,
        intentId: paymentRecord.id,
        amountUsd: payableAmount,
        currency: selectedCurrency,
      });

      // Create Stripe PaymentIntent
      const stripeResult = await createPaymentIntent(stripeConfig, {
        orderId: order_id,
        userId: user.id,
        intentId: paymentRecord.id,
        amount: payableAmount,
        description: `AfriShop Order ${order_id.slice(0, 8)}`,
      });

      if (!stripeResult.success || !stripeResult.client_secret) {
        console.error('[STRIPE_PI_CREATE_FAIL]', {
          orderId: order_id,
          error: stripeResult.error,
          rawResponse: stripeResult.raw_response,
        });
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

      console.log('[STRIPE_PI_CREATE_RES]', {
        intentId: paymentRecord.id,
        stripePaymentIntentId: stripeResult.provider_deposit_id,
        clientSecretPreview: stripeResult.client_secret?.slice(0, 20) + '...',
      });

      console.log('[STRIPE_INTENT_SUMMARY]', {
        requestId,
        orderId: order_id,
        amountCents: Math.round(payableAmount * 100),
        currency: selectedCurrency,
        hasClientSecret: !!stripeResult.client_secret,
      });

      result = {
        success: true,
        requestId,
        intentId: paymentRecord.id,
        provider: 'stripe',
        requestedProvider: requestedProvider || undefined,
        providerSelection,
        status: 'processing',
        currency: selectedCurrency,
        amount: payableAmount,
        clientSecret: stripeResult.client_secret, // Top-level for mobile SDK
        nextAction: {
          type: 'PAYMENT_SHEET', // Mobile SDK expects PAYMENT_SHEET
          clientSecret: stripeResult.client_secret,
        },
      };

    } else if (selectedProviderKey === 'pawapay') {
      // === PAWAPAY FLOW ===
      
      // ==================== Phone Normalization & Validation ====================
      // Step 1: Check if phone is provided
      if (!customerPhone || customerPhone.trim().length === 0) {
        console.log('[PAWAPAY_VALIDATION_FAIL]', { reason: 'phone_missing', orderId: order_id });
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Phone number is required for mobile money payments',
            error_code: 'PHONE_REQUIRED',
            request_id: crypto.randomUUID(),
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Step 2: Normalize phone - remove +, spaces, hyphens, keep digits only
      const normalizedPhone = customerPhone.trim().replace(/[\s\-\+\(\)]/g, '');
      
      // Step 3: Validate phone length and format
      if (normalizedPhone.length < 9) {
        console.log('[PAWAPAY_VALIDATION_FAIL]', { 
          reason: 'phone_too_short', 
          orderId: order_id,
          phoneLast4: normalizedPhone.slice(-4),
          length: normalizedPhone.length 
        });
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Invalid phone number (too short)',
            error_code: 'PAWAPAY_VALIDATION',
            details: { reason: 'phone_too_short', length: normalizedPhone.length, required: 9 },
            request_id: crypto.randomUUID(),
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (normalizedPhone.length > 15) {
        console.log('[PAWAPAY_VALIDATION_FAIL]', { 
          reason: 'phone_too_long', 
          orderId: order_id,
          phoneLast4: normalizedPhone.slice(-4),
          length: normalizedPhone.length 
        });
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Invalid phone number (too long)',
            error_code: 'PAWAPAY_VALIDATION',
            details: { reason: 'phone_too_long', length: normalizedPhone.length, max: 15 },
            request_id: crypto.randomUUID(),
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Step 4: Validate DRC phone format (should start with 243, 0, or be 9 digits)
      let phoneE164 = normalizedPhone;
      if (normalizedPhone.startsWith('243')) {
        // Already has country code
        if (normalizedPhone.length !== 12) {
          console.log('[PAWAPAY_VALIDATION_FAIL]', { 
            reason: 'drc_phone_invalid_length', 
            orderId: order_id,
            phoneLast4: normalizedPhone.slice(-4),
            length: normalizedPhone.length 
          });
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Invalid DRC phone number (should be 12 digits with 243 prefix)',
              error_code: 'PAWAPAY_VALIDATION',
              details: { reason: 'drc_phone_invalid_length', length: normalizedPhone.length, expected: 12 },
              request_id: crypto.randomUUID(),
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        phoneE164 = normalizedPhone;
      } else if (normalizedPhone.startsWith('0')) {
        // Local format - convert to E.164
        phoneE164 = '243' + normalizedPhone.slice(1);
      } else {
        // Assume missing country code
        phoneE164 = '243' + normalizedPhone;
      }

      // Step 5: Validate currency for pawaPay (must be USD or CDF)
      if (selectedCurrency !== 'USD' && selectedCurrency !== 'CDF') {
        console.log('[PAWAPAY_VALIDATION_FAIL]', { 
          reason: 'unsupported_currency', 
          orderId: order_id,
          currency: selectedCurrency 
        });
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Unsupported currency for Mobile Money',
            error_code: 'PAWAPAY_VALIDATION',
            details: { currency: selectedCurrency, supported: ['USD', 'CDF'] },
            request_id: crypto.randomUUID(),
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Provider config check
      let pawapayConfig: PawaPayConfig;
      let pawapayBaseUrlMode: 'sandbox' | 'production' = 'sandbox';
      try {
        pawapayConfig = getPawaPayConfig(providerRecord);
        // Detect mode from base URL
        const baseUrl = pawapayConfig.apiBase || '';
        pawapayBaseUrlMode = baseUrl.includes('sandbox') ? 'sandbox' : 'production';
      } catch (err: any) {
        console.error('[PAWAPAY_NOT_CONFIGURED]', { 
          orderId: order_id, 
          error: err.message,
          errorCode: err.code,
        });
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Mobile money service is not configured',
            error_code: 'PAWAPAY_NOT_CONFIGURED',
            request_id: crypto.randomUUID(),
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ============================================
      // P0 IDEMPOTENCY CHECK: Prevent duplicate pawaPay deposits
      // If a pending payment exists for this order within 5 minutes, reuse it
      // ============================================
      const IDEMPOTENCY_WINDOW_MINUTES = 5;
      const { data: existingPayment, error: existingPaymentError } = await supabaseAdmin
        .from('payments')
        .select('id, provider_deposit_id, reference, status, created_at, amount, currency')
        .eq('order_id', order_id)
        .eq('provider_key', 'pawapay')
        .eq('status', 'pending')
        .gt('created_at', new Date(Date.now() - IDEMPOTENCY_WINDOW_MINUTES * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (existingPaymentError) {
        console.warn('[payments-create-intent] IDEMPOTENCY_CHECK_ERROR', existingPaymentError.message);
        // Continue with new payment creation if check fails
      }
      
      if (existingPayment && existingPayment.provider_deposit_id) {
        // Reuse existing pending payment - return the same depositId
        console.log('[payments-create-intent] IDEMPOTENCY_HIT - REUSING_EXISTING_PAYMENT', {
          order_id,
          existing_payment_id: existingPayment.id,
          existing_deposit_id: existingPayment.provider_deposit_id,
          existing_reference: existingPayment.reference,
          created_at: existingPayment.created_at,
          age_seconds: Math.round((Date.now() - new Date(existingPayment.created_at).getTime()) / 1000),
        });
        
        return new Response(
          JSON.stringify({
            success: true,
            depositId: existingPayment.provider_deposit_id,
            payment_flow: 'PAWAPAY',
            provider: 'pawapay',
            reference: existingPayment.reference,
            amount: Number(existingPayment.amount),
            currency: existingPayment.currency,
            message: 'Payment request already sent. Please check your phone.',
            message_fr: 'Demande de paiement déjà envoyée. Vérifiez votre téléphone.',
            idempotent: true,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // No existing pending payment - create new one
      console.log('[payments-create-intent] IDEMPOTENCY_MISS - CREATING_NEW_PAYMENT', {
        order_id,
        existing_pending_found: false,
      });

      // Create payment record first
      const paymentRecord = await createPaymentRecord(supabaseAdmin, {
        order_id,
        provider_key: 'pawapay',
        amount: payableAmount,
        currency: selectedCurrency,
        reference,
        customer_phone: phoneE164, // Use normalized phone
        country: 'COD',
        status: 'pending',
      });

      if (!paymentRecord) {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create payment record', error_code: 'DB_ERROR' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ==================== PAWAPAY_REQ_PROOF - Deep Logging ====================
      const requestId = crypto.randomUUID();
      console.log('[PAWAPAY_REQ_PROOF]', {
        request_id: requestId,
        order_id,
        payment_record_id: paymentRecord.id,
        amount: payableAmount,
        currency: selectedCurrency,
        msisdn_masked: '*'.repeat(phoneE164.length - 4) + phoneE164.slice(-4),
        base_url_mode: pawapayBaseUrlMode,
        provider_selection: providerSelection,
        requested_provider: requestedProvider || 'auto',
      });

      // Create pawaPay deposit
      const depositResult = await createDeposit(pawapayConfig, {
        orderId: order_id,
        amount: payableAmount,
        currency: selectedCurrency,
        customerPhone: phoneE164, // Use normalized phone
        customerEmail,
        reference,
        description: `AfriShop ${order_id.slice(0, 8)}`,
      });

      if (!depositResult.success) {
        // ==================== PAWAPAY_FAIL_PROOF - Deep Error Logging ====================
        const errorDetails = depositResult.errorDetails;
        const providerHttpStatus = errorDetails?.provider_http_status;
        const providerErrorCode = errorDetails?.provider_error_code;
        const providerMessage = errorDetails?.provider_message;
        const isAuthError = errorDetails?.is_auth_error;
        const isRejection = errorDetails?.is_rejection;
        
        // Extract first 800 chars of raw response for debugging (no secrets)
        const rawResponseStr = depositResult.raw_response 
          ? JSON.stringify(depositResult.raw_response).slice(0, 800)
          : null;
        
        console.error('[PAWAPAY_FAIL_PROOF]', {
          request_id: requestId,
          order_id,
          deposit_id: depositResult.provider_deposit_id,
          status: providerHttpStatus,
          provider_error_code: providerErrorCode,
          provider_message: providerMessage,
          is_auth_error: isAuthError,
          is_rejection: isRejection,
          response_body_first_800: rawResponseStr,
        });
        
        // Determine structured error code
        let errorCode: ErrorCode = 'PAWAPAY_ERROR';
        let errorMessage = depositResult.error || 'Failed to initiate mobile money payment';
        let httpStatus = 500;
        
        if (isAuthError) {
          errorCode = 'PAWAPAY_AUTH_FAILED';
          errorMessage = 'Mobile money service authentication failed';
          httpStatus = 502;
        } else if (!isRejection) {
          // Server/network error - provider unavailable
          errorCode = 'PAWAPAY_UNAVAILABLE';
          errorMessage = 'Mobile money temporarily unavailable. Please try again.';
          httpStatus = 502;
        } else {
          // Provider rejected the request
          errorCode = 'PAWAPAY_PROVIDER_ERROR';
          httpStatus = 502;
        }
        
        // Return STRUCTURED error response
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: errorMessage,
            error_code: errorCode,
            provider_status: providerHttpStatus,
            provider_error_code: providerErrorCode,
            provider_body: rawResponseStr,
            request_id: requestId,
            // Echo fields for debugging
            requestedProvider: requestedProvider || undefined,
            providerSelection,
          }),
          { status: httpStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ==================== PAWAPAY_RES_PROOF - Success Logging ====================
      console.log('[PAWAPAY_RES_PROOF]', {
        request_id: requestId,
        order_id,
        deposit_id: depositResult.provider_deposit_id,
        status: depositResult.status,
        provider_selection: providerSelection,
      });

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
        requestId,
        intentId: paymentRecord.id,
        provider: 'pawapay',
        requestedProvider: requestedProvider || undefined,
        providerSelection,
        status: 'processing',
        currency: selectedCurrency,
        amount: payableAmount,
        // P0: depositId at TOP LEVEL for mobile app compatibility
        depositId: depositResult.provider_deposit_id,
        payment_flow: 'PAWAPAY',
        message: 'Payment request sent to your phone. Please confirm on your device.',
        message_fr: 'Demande de paiement envoyée à votre téléphone. Veuillez confirmer sur votre appareil.',
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
    console.error('[payments-create-intent] Unexpected error:', { requestId, error: error.message });
    return new Response(
      JSON.stringify({ success: false, requestId, error: error.message || 'Internal server error', error_code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
