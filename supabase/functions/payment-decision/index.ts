import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getActiveProvider, createAdminClient } from "../_shared/paymentProviders.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Payment Flow Types
 * 
 * MAISHAPAY: USD payment via MaishaPay (total_usd <= 5000)
 * MAISHAPAY_CDF_FORCED: CDF payment via MaishaPay (total_usd > 5000 but total_cdf <= 30M)
 * PAWAPAY: Payment via pawaPay (alternative provider)
 * BANK_TRANSFER: Manual bank transfer (total_cdf > 30M)
 */
type PaymentFlow = 'MAISHAPAY' | 'MAISHAPAY_CDF_FORCED' | 'PAWAPAY' | 'BANK_TRANSFER';

// Legacy type for backwards compatibility
type PaymentDecision = 'MAISHAPAY_USD' | 'MAISHAPAY_CDF' | 'PAWAPAY' | 'MANUAL_BANK';

interface DecisionResponse {
  ok: boolean;
  // New standardized fields
  payment_flow?: PaymentFlow;
  payable_currency?: 'USD' | 'CDF';
  payable_amount?: number;
  provider?: {
    key: string;
    name: string;
    supportedMethods?: string[];
    initiateUrl?: string;
  };
  // Legacy fields for backwards compatibility
  decision?: PaymentDecision;
  total_usd?: number;
  fx_rate?: number;
  total_cdf?: number;
  limits?: {
    usd_max: number;
    cdf_max: number;
  };
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

/**
 * Compute payment flow decision
 * 
 * RULES (amounts in DOLLARS/whole CDF):
 * 1. If total_usd <= maxUsd (5000) → MAISHAPAY (pay in USD)
 * 2. If total_usd > maxUsd AND total_cdf <= maxCdf (30M) → MAISHAPAY_CDF_FORCED (pay in CDF)
 * 3. If total_cdf > maxCdf (30M) → BANK_TRANSFER
 */
function computePaymentFlow(
  totalUsdDollars: number,
  fxRate: number,
  maxUsdDollars: number,
  maxCdfUnits: number,
  activeProviderKey: string = 'maishapay'
): { 
  payment_flow: PaymentFlow;
  payable_currency: 'USD' | 'CDF';
  payable_amount: number;
  totalCdf: number; 
  decision: PaymentDecision;
  message_fr: string; 
  message_en: string;
} {
  // Convert USD to CDF (whole units)
  const totalCdf = Math.round(totalUsdDollars * fxRate);

  // Determine provider label for messages
  const providerLabel = activeProviderKey === 'pawapay' ? 'pawaPay' : 'MaishaPay';

  // Log the decision inputs for debugging
  console.log('CHECKOUT_LIMITS_DECISION', {
    total_usd_dollars: totalUsdDollars,
    total_usd_cents: Math.round(totalUsdDollars * 100),
    total_cdf_units: totalCdf,
    usd_limit_dollars: maxUsdDollars,
    cdf_limit_units: maxCdfUnits,
    fx_rate: fxRate,
    usd_exceeds_limit: totalUsdDollars > maxUsdDollars,
    cdf_exceeds_limit: totalCdf > maxCdfUnits,
    active_provider: activeProviderKey,
  });

  // RULE 1: USD within limit → Provider USD
  if (totalUsdDollars <= maxUsdDollars) {
    const paymentFlow = activeProviderKey === 'pawapay' ? 'PAWAPAY' : 'MAISHAPAY';
    const decision = activeProviderKey === 'pawapay' ? 'PAWAPAY' : 'MAISHAPAY_USD';
    const result = {
      payment_flow: paymentFlow as PaymentFlow,
      payable_currency: 'USD' as const,
      payable_amount: Math.round(totalUsdDollars * 100) / 100, // Round to 2 decimals
      totalCdf,
      decision: decision as PaymentDecision,
      message_fr: `Paiement en USD via ${providerLabel} ($${totalUsdDollars.toFixed(2)})`,
      message_en: `Pay in USD via ${providerLabel} ($${totalUsdDollars.toFixed(2)})`,
    };
    console.log('CHECKOUT_LIMITS_DECISION_RESULT', { ...result, reason: 'usd_within_limit' });
    return result;
  }
  
  // RULE 2: USD exceeds limit but CDF within limit → Provider CDF (forced conversion)
  // Note: pawaPay may not support CDF, so this only applies to MaishaPay
  if (totalCdf <= maxCdfUnits && activeProviderKey === 'maishapay') {
    const result = {
      payment_flow: 'MAISHAPAY_CDF_FORCED' as PaymentFlow,
      payable_currency: 'CDF' as const,
      payable_amount: totalCdf,
      totalCdf,
      decision: 'MAISHAPAY_CDF' as PaymentDecision,
      message_fr: `Montant supérieur à $${maxUsdDollars}. Paiement en CDF via Mobile Money (${totalCdf.toLocaleString()} CDF)`,
      message_en: `Amount exceeds $${maxUsdDollars}. Pay in CDF via Mobile Money (${totalCdf.toLocaleString()} CDF)`,
    };
    console.log('CHECKOUT_LIMITS_DECISION_RESULT', { ...result, reason: 'cdf_within_limit_after_conversion' });
    return result;
  }
  
  // RULE 3: Both limits exceeded → Bank Transfer
  const result = {
    payment_flow: 'BANK_TRANSFER' as PaymentFlow,
    payable_currency: 'USD' as const, // Bank transfers in USD
    payable_amount: Math.round(totalUsdDollars * 100) / 100,
    totalCdf,
    decision: 'MANUAL_BANK' as PaymentDecision,
    message_fr: `Montant supérieur à ${maxCdfUnits.toLocaleString()} CDF. Virement bancaire requis.`,
    message_en: `Amount exceeds ${maxCdfUnits.toLocaleString()} CDF. Bank transfer required.`,
  };
  console.log('CHECKOUT_LIMITS_DECISION_RESULT', { ...result, reason: 'exceeds_all_limits' });
  return result;
}

/**
 * payment-decision Edge Function
 * 
 * Returns payment decision based on order/cart total.
 * Used by mobile app and frontend before initiating checkout.
 * Now integrates with multi-provider routing.
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

    // Fetch settings for FX rate and limits
    const { data: settings } = await supabase
      .from('settings')
      .select('exchange_rate_usd_to_cdf, maishapay_max_usd, maishapay_max_cdf')
      .limit(1)
      .single();

    const fxRate = settings?.exchange_rate_usd_to_cdf || 2500;
    // CRITICAL: These are in DOLLARS and whole CDF, not cents!
    const maxUsdDollars = settings?.maishapay_max_usd || 5000;
    const maxCdfUnits = settings?.maishapay_max_cdf || 30000000;

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
    let providerKey = 'maishapay'; // Default fallback
    
    try {
      const adminClient = createAdminClient();
      activeProvider = await getActiveProvider(adminClient, buyerCountry, paymentMethod);
      if (activeProvider) {
        providerKey = activeProvider.provider_key;
      }
    } catch (providerErr) {
      console.warn('[payment-decision] Provider lookup failed, using default:', providerErr);
    }

    // Compute decision using standardized logic
    const { 
      payment_flow, 
      payable_currency, 
      payable_amount, 
      totalCdf, 
      decision, 
      message_fr, 
      message_en 
    } = computePaymentFlow(
      totalUsdDollars,
      fxRate,
      maxUsdDollars,
      maxCdfUnits,
      providerKey
    );

    // Build available providers list
    const availableProviders: string[] = [];
    if (payment_flow !== 'BANK_TRANSFER') {
      availableProviders.push(providerKey);
    }
    availableProviders.push('bank_transfer');

    console.log('[payment-decision] Final decision:', {
      input: order_id ? 'order_id' : cart_snapshot ? 'cart_snapshot' : 'total_usd',
      total_usd_dollars: totalUsdDollars,
      total_cdf_units: totalCdf,
      payment_flow,
      payable_currency,
      payable_amount,
      provider: providerKey,
    });

    const response: DecisionResponse = {
      ok: true,
      // New standardized fields
      payment_flow,
      payable_currency,
      payable_amount,
      provider: activeProvider ? {
        key: activeProvider.provider_key,
        name: activeProvider.display_name,
        supportedMethods: activeProvider.supported_methods || [],
        initiateUrl: `/functions/v1/${activeProvider.provider_key}-create-payment`,
      } : {
        key: providerKey,
        name: providerKey === 'maishapay' ? 'MaishaPay' : 'pawaPay',
        initiateUrl: `/functions/v1/${providerKey}-create-payment`,
      },
      // Legacy fields for backwards compatibility
      decision,
      total_usd: totalUsdDollars,
      fx_rate: fxRate,
      total_cdf: totalCdf,
      limits: {
        usd_max: maxUsdDollars,
        cdf_max: maxCdfUnits,
      },
      available_providers: availableProviders,
      message_fr,
      message_en,
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[payment-decision] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' } as DecisionResponse),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
