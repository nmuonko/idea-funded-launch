import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getActiveProvider, createAdminClient } from "../_shared/paymentProviders.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Payment Flow Types - MaishaPay REMOVED
 * 
 * PAWAPAY: Payment via pawaPay mobile money (USD or CDF) - within limits
 * STRIPE: Card payment via Stripe (USD only) - for large orders
 * BANK_TRANSFER: Manual bank transfer (for vehicles or large amounts)
 * CHOICE_REQUIRED: Amount exceeds mobile money limits - user must choose STRIPE or BANK_TRANSFER
 */
type PaymentFlow = 'PAWAPAY' | 'STRIPE' | 'BANK_TRANSFER' | 'CHOICE_REQUIRED';

// Legacy type for backwards compatibility
type PaymentDecision = 'PAWAPAY' | 'STRIPE' | 'MANUAL_BANK' | 'CHOICE_REQUIRED';

// Payment settings from database
interface PaymentSettings {
  mobile_money_max_usd: number;
  mobile_money_max_cdf: number;
  large_order_currency: string;
  stripe_enabled: boolean;
  bank_transfer_enabled: boolean;
  pawapay_enabled: boolean;
  updated_at?: string;
}

// Default payment settings
const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  mobile_money_max_usd: 250,
  mobile_money_max_cdf: 1500000,
  large_order_currency: 'USD',
  stripe_enabled: true,
  bank_transfer_enabled: true,
  pawapay_enabled: true,
};

interface DecisionResponse {
  ok: boolean;
  // New standardized fields
  payment_flow?: PaymentFlow;
  payable_currency?: 'USD' | 'CDF';
  payable_amount?: number;
  required_currency?: 'USD'; // For CHOICE_REQUIRED
  options?: ('STRIPE' | 'BANK_TRANSFER')[]; // For CHOICE_REQUIRED
  provider?: {
    key: string;
    name: string;
    supportedMethods?: string[];
    initiateUrl?: string;
  };
  // Explicit limit fields for mobile UI
  limits?: {
    pawapayMaxUsd: number;
    pawapayMaxCdf: number;
    // Legacy aliases
    usd_max: number;
    cdf_max: number;
  };
  // Versioning fields
  updated_at?: string;
  version?: number;
  // Legacy fields for backwards compatibility
  decision?: PaymentDecision;
  total_usd?: number;
  fx_rate?: number;
  total_cdf?: number;
  available_providers?: string[];
  message_fr?: string;
  message_en?: string;
  error?: string;
}

interface CartItem {
  total_price_usd?: number;
  subtotal_usd?: number;
  base_price_usd?: number;
  quantity?: number;
}

// Fetch payment settings from database
async function getPaymentSettings(supabase: any): Promise<PaymentSettings> {
  try {
    const { data, error } = await supabase
      .from('payment_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    
    if (error) {
      console.warn('[payment-decision] Error fetching payment_settings:', error.message);
      return DEFAULT_PAYMENT_SETTINGS;
    }
    
    if (!data) {
      console.warn('[payment-decision] No payment_settings found, using defaults');
      return DEFAULT_PAYMENT_SETTINGS;
    }
    
    return {
      mobile_money_max_usd: Number(data.mobile_money_max_usd) || DEFAULT_PAYMENT_SETTINGS.mobile_money_max_usd,
      mobile_money_max_cdf: Number(data.mobile_money_max_cdf) || DEFAULT_PAYMENT_SETTINGS.mobile_money_max_cdf,
      large_order_currency: data.large_order_currency || 'USD',
      stripe_enabled: data.stripe_enabled !== false,
      bank_transfer_enabled: data.bank_transfer_enabled !== false,
      pawapay_enabled: data.pawapay_enabled !== false,
      updated_at: data.updated_at || new Date().toISOString(),
    };
  } catch (e: any) {
    console.error('[payment-decision] Exception fetching payment_settings:', e.message);
    return DEFAULT_PAYMENT_SETTINGS;
  }
}

// Get available payment options for large orders
function getLargeOrderOptions(paymentSettings: PaymentSettings): ('STRIPE' | 'BANK_TRANSFER')[] {
  const options: ('STRIPE' | 'BANK_TRANSFER')[] = [];
  if (paymentSettings.stripe_enabled) options.push('STRIPE');
  if (paymentSettings.bank_transfer_enabled) options.push('BANK_TRANSFER');
  return options;
}

/**
 * Compute payment flow decision
 * 
 * UPDATED RULES (2026-01) - MaishaPay REMOVED, Limit-based routing:
 * 1. Vehicles require Bank Transfer or Stripe (CHOICE_REQUIRED)
 * 2. Amount > limit → CHOICE_REQUIRED (must choose STRIPE or BANK_TRANSFER, USD only)
 * 3. Amount <= limit → PAWAPAY mobile money in requested currency
 */
function computePaymentFlow(
  totalUsdDollars: number,
  totalCdf: number,
  fxRate: number,
  paymentSettings: PaymentSettings,
  requestedCurrency: 'USD' | 'CDF' = 'USD',
  isVehicle: boolean = false
): { 
  payment_flow: PaymentFlow;
  payable_currency: 'USD' | 'CDF';
  payable_amount: number;
  totalCdf: number; 
  decision: PaymentDecision;
  required_currency?: 'USD';
  options?: ('STRIPE' | 'BANK_TRANSFER')[];
  message_fr: string; 
  message_en: string;
} {
  // Check if amount exceeds limits
  const amountToCheck = requestedCurrency === 'CDF' ? totalCdf : totalUsdDollars;
  const limit = requestedCurrency === 'CDF' ? paymentSettings.mobile_money_max_cdf : paymentSettings.mobile_money_max_usd;
  const isOverLimit = amountToCheck > limit;
  
  // Log the decision inputs for debugging
  console.log('[payment-decision] CHECKOUT_PAYMENT_DECISION', {
    total_usd_dollars: totalUsdDollars,
    total_cdf_units: totalCdf,
    fx_rate: fxRate,
    requested_currency: requestedCurrency,
    amount_to_check: amountToCheck,
    limit,
    is_over_limit: isOverLimit,
    is_vehicle: isVehicle,
    pawapay_enabled: paymentSettings.pawapay_enabled,
  });

  // RULE 1: Vehicles require CHOICE_REQUIRED (Bank Transfer or Stripe)
  if (isVehicle) {
    const options = getLargeOrderOptions(paymentSettings);
    const result = {
      payment_flow: 'CHOICE_REQUIRED' as PaymentFlow,
      payable_currency: 'USD' as const,
      payable_amount: Math.round(totalUsdDollars * 100) / 100,
      totalCdf,
      decision: 'CHOICE_REQUIRED' as PaymentDecision,
      required_currency: 'USD' as const,
      options,
      message_fr: `Commande véhicule - Choisissez virement bancaire ou paiement carte (USD uniquement).`,
      message_en: `Vehicle order - Choose bank transfer or card payment (USD only).`,
    };
    console.log('[payment-decision] CHECKOUT_PAYMENT_DECISION_RESULT', { ...result, reason: 'vehicle_order' });
    return result;
  }

  // RULE 2: Amount over limit → CHOICE_REQUIRED
  if (isOverLimit) {
    const options = getLargeOrderOptions(paymentSettings);
    const result = {
      payment_flow: 'CHOICE_REQUIRED' as PaymentFlow,
      payable_currency: 'USD' as const,
      payable_amount: Math.round(totalUsdDollars * 100) / 100,
      totalCdf,
      decision: 'CHOICE_REQUIRED' as PaymentDecision,
      required_currency: 'USD' as const,
      options,
      message_fr: `Montant dépasse la limite Mobile Money. Choisissez virement bancaire ou carte (USD uniquement).`,
      message_en: `Amount exceeds Mobile Money limit. Choose bank transfer or card (USD only).`,
    };
    console.log('[payment-decision] CHECKOUT_PAYMENT_DECISION_RESULT', { ...result, reason: 'over_limit' });
    return result;
  }

  // RULE 3: Check if pawaPay is enabled
  if (!paymentSettings.pawapay_enabled) {
    const options = getLargeOrderOptions(paymentSettings);
    const result = {
      payment_flow: 'CHOICE_REQUIRED' as PaymentFlow,
      payable_currency: 'USD' as const,
      payable_amount: Math.round(totalUsdDollars * 100) / 100,
      totalCdf,
      decision: 'CHOICE_REQUIRED' as PaymentDecision,
      required_currency: 'USD' as const,
      options,
      message_fr: `Mobile Money indisponible. Choisissez virement bancaire ou carte.`,
      message_en: `Mobile Money unavailable. Choose bank transfer or card.`,
    };
    console.log('[payment-decision] CHECKOUT_PAYMENT_DECISION_RESULT', { ...result, reason: 'pawapay_disabled' });
    return result;
  }

  // RULE 4: Standard order within limit → pawaPay mobile money
  if (requestedCurrency === 'CDF') {
    const result = {
      payment_flow: 'PAWAPAY' as PaymentFlow,
      payable_currency: 'CDF' as const,
      payable_amount: totalCdf,
      totalCdf,
      decision: 'PAWAPAY' as PaymentDecision,
      message_fr: `Paiement en CDF via Mobile Money (${totalCdf.toLocaleString()} CDF)`,
      message_en: `Pay in CDF via Mobile Money (${totalCdf.toLocaleString()} CDF)`,
    };
    console.log('[payment-decision] CHECKOUT_PAYMENT_DECISION_RESULT', { ...result, reason: 'mobile_money_cdf' });
    return result;
  }

  // Default: USD via pawaPay
  const result = {
    payment_flow: 'PAWAPAY' as PaymentFlow,
    payable_currency: 'USD' as const,
    payable_amount: Math.round(totalUsdDollars * 100) / 100,
    totalCdf,
    decision: 'PAWAPAY' as PaymentDecision,
    message_fr: `Paiement en USD via Mobile Money ($${totalUsdDollars.toFixed(2)})`,
    message_en: `Pay in USD via Mobile Money ($${totalUsdDollars.toFixed(2)})`,
  };
  console.log('[payment-decision] CHECKOUT_PAYMENT_DECISION_RESULT', { ...result, reason: 'mobile_money_usd' });
  return result;
}

/**
 * payment-decision Edge Function
 * 
 * Returns payment decision based on order/cart total.
 * Used by mobile app and frontend before initiating checkout.
 * Now integrates with multi-provider routing (MaishaPay REMOVED).
 * 
 * Input: { order_id: string, country?: string, method?: string } 
 *    OR { cart_snapshot: CartItem[], country?: string, method?: string } 
 *    OR { total_usd: number, country?: string, method?: string }
 * Output: DecisionResponse with payment_flow, payable_currency, payable_amount, provider
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: { 
      order_id?: string; 
      cart_snapshot?: CartItem[]; 
      total_usd?: number;
      country?: string;
      method?: string;
    } = {};
    
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid JSON body' } as DecisionResponse),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const { order_id, cart_snapshot, total_usd: providedTotal, country, method } = body;

    // Validate input - need at least one
    if (!order_id && !cart_snapshot && providedTotal === undefined) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: 'Provide order_id, cart_snapshot, or total_usd' 
        } as DecisionResponse),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch settings for FX rate
    const { data: settings } = await supabase
      .from('settings')
      .select('exchange_rate_usd_to_cdf')
      .limit(1)
      .single();

    const fxRate = settings?.exchange_rate_usd_to_cdf || 2500;

    let totalUsdDollars: number;

    if (order_id) {
      // Fetch from order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('total_usd')
        .eq('id', order_id)
        .single();

      if (orderError || !order) {
        console.error('[payment-decision] Order not found:', order_id);
        return new Response(
          JSON.stringify({ ok: false, error: 'Order not found' } as DecisionResponse),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // total_usd from DB is in DOLLARS (e.g., 500.00)
      totalUsdDollars = Number(order.total_usd || 0);
    } else if (cart_snapshot && Array.isArray(cart_snapshot)) {
      // Calculate from cart snapshot - all values in DOLLARS
      totalUsdDollars = cart_snapshot.reduce((sum, item) => {
        const itemTotal = item.total_price_usd 
          || item.subtotal_usd 
          || (item.base_price_usd || 0) * (item.quantity || 1);
        return sum + Number(itemTotal || 0);
      }, 0);
    } else if (providedTotal !== undefined) {
      // Use directly provided total (DOLLARS)
      totalUsdDollars = Number(providedTotal);
    } else {
      totalUsdDollars = 0;
    }

    // Get active provider using the new routing system
    const buyerCountry = country || 'CD'; // Default to DRC
    const paymentMethod = method || 'mobile_money';
    
    let activeProvider = null;
    let providerKey = 'pawapay'; // Default to pawaPay (MaishaPay REMOVED)
    
    try {
      const adminClient = createAdminClient();
      activeProvider = await getActiveProvider(adminClient, buyerCountry, paymentMethod);
      if (activeProvider && activeProvider.provider_key === 'pawapay') {
        providerKey = 'pawapay';
      }
      // Ignore maishapay if returned - always use pawapay
    } catch (providerErr) {
      console.warn('[payment-decision] Provider lookup failed, using default pawapay:', providerErr);
    }

    // Check if order contains vehicles (for routing decision)
    let isVehicle = false;
    if (order_id) {
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('is_vehicle')
        .eq('order_id', order_id);
      isVehicle = orderItems?.some(item => item.is_vehicle === true) || false;
    }

    // Get requested currency from payload (default to USD)
    const requestedCurrency: 'USD' | 'CDF' = (body as any).currency?.toUpperCase() === 'CDF' ? 'CDF' : 'USD';
    
    // Calculate CDF equivalent
    const totalCdfCalc = Math.round(totalUsdDollars * fxRate);

    // Fetch payment settings for limit-based routing
    const paymentSettings = await getPaymentSettings(supabase);

    // Compute decision using updated logic with payment settings
    const { 
      payment_flow, 
      payable_currency, 
      payable_amount, 
      totalCdf, 
      decision,
      required_currency,
      options,
      message_fr, 
      message_en 
    } = computePaymentFlow(
      totalUsdDollars,
      totalCdfCalc,
      fxRate,
      paymentSettings,
      requestedCurrency,
      isVehicle
    );

    // Build available providers list (MaishaPay REMOVED)
    const availableProviders: string[] = [];
    if (payment_flow === 'PAWAPAY') {
      availableProviders.push('pawapay');
    }
    if (payment_flow === 'STRIPE' || payment_flow === 'CHOICE_REQUIRED') {
      availableProviders.push('stripe');
    }
    availableProviders.push('bank_transfer');

    console.log('[payment-decision] Final decision:', {
      input: order_id ? 'order_id' : cart_snapshot ? 'cart_snapshot' : 'total_usd',
      total_usd_dollars: totalUsdDollars,
      total_cdf_units: totalCdf,
      payment_flow,
      payable_currency,
      payable_amount,
      required_currency,
      options,
    });

    // Build versioning fields
    const settingsUpdatedAt = paymentSettings.updated_at || new Date().toISOString();
    const version = new Date(settingsUpdatedAt).getTime();

    const response: DecisionResponse = {
      ok: true,
      // New standardized fields
      payment_flow,
      payable_currency,
      payable_amount,
      provider: activeProvider && activeProvider.provider_key === 'pawapay' ? {
        key: activeProvider.provider_key,
        name: activeProvider.display_name,
        supportedMethods: activeProvider.supported_methods || [],
        initiateUrl: `/functions/v1/pawapay-create-payment`,
      } : {
        key: 'pawapay',
        name: 'pawaPay',
        initiateUrl: `/functions/v1/pawapay-create-payment`,
      },
      // Explicit limits for mobile UI
      limits: {
        pawapayMaxUsd: paymentSettings.mobile_money_max_usd,
        pawapayMaxCdf: paymentSettings.mobile_money_max_cdf,
        // Legacy aliases
        usd_max: paymentSettings.mobile_money_max_usd,
        cdf_max: paymentSettings.mobile_money_max_cdf,
      },
      // Versioning fields
      updated_at: settingsUpdatedAt,
      version,
      // Legacy fields for backwards compatibility
      decision,
      total_usd: totalUsdDollars,
      fx_rate: fxRate,
      total_cdf: totalCdf,
      available_providers: availableProviders,
      message_fr,
      message_en,
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        } 
      }
    );

  } catch (error: unknown) {
    console.error('[payment-decision] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' } as DecisionResponse),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
