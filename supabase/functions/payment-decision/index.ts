import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Payment Flow Types
 * 
 * MAISHAPAY: USD payment via MaishaPay (total_usd <= 5000)
 * MAISHAPAY_CDF_FORCED: CDF payment via MaishaPay (total_usd > 5000 but total_cdf <= 30M)
 * BANK_TRANSFER: Manual bank transfer (total_cdf > 30M)
 */
type PaymentFlow = 'MAISHAPAY' | 'MAISHAPAY_CDF_FORCED' | 'BANK_TRANSFER';

// Legacy type for backwards compatibility
type PaymentDecision = 'MAISHAPAY_USD' | 'MAISHAPAY_CDF' | 'MANUAL_BANK';

interface DecisionResponse {
  ok: boolean;
  // New standardized fields
  payment_flow?: PaymentFlow;
  payable_currency?: 'USD' | 'CDF';
  payable_amount?: number;
  // Legacy fields for backwards compatibility
  decision?: PaymentDecision;
  total_usd?: number;
  fx_rate?: number;
  total_cdf?: number;
  limits?: {
    usd_max: number;
    cdf_max: number;
  };
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
  maxCdfUnits: number
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
  });

  // RULE 1: USD within limit → MaishaPay USD
  if (totalUsdDollars <= maxUsdDollars) {
    const result = {
      payment_flow: 'MAISHAPAY' as PaymentFlow,
      payable_currency: 'USD' as const,
      payable_amount: Math.round(totalUsdDollars * 100) / 100, // Round to 2 decimals
      totalCdf,
      decision: 'MAISHAPAY_USD' as PaymentDecision,
      message_fr: `Paiement en USD via MaishaPay ($${totalUsdDollars.toFixed(2)})`,
      message_en: `Pay in USD via MaishaPay ($${totalUsdDollars.toFixed(2)})`,
    };
    console.log('CHECKOUT_LIMITS_DECISION_RESULT', { ...result, reason: 'usd_within_limit' });
    return result;
  }
  
  // RULE 2: USD exceeds limit but CDF within limit → MaishaPay CDF (forced conversion)
  if (totalCdf <= maxCdfUnits) {
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
 * 
 * Input: { order_id: string } OR { cart_snapshot: CartItem[] } OR { total_usd: number }
 * Output: DecisionResponse with payment_flow, payable_currency, payable_amount
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: { order_id?: string; cart_snapshot?: CartItem[]; total_usd?: number } = {};
    
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

    const { order_id, cart_snapshot, total_usd: providedTotal } = body;

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
      maxCdfUnits
    );

    console.log('[payment-decision] Final decision:', {
      input: order_id ? 'order_id' : cart_snapshot ? 'cart_snapshot' : 'total_usd',
      total_usd_dollars: totalUsdDollars,
      total_cdf_units: totalCdf,
      payment_flow,
      payable_currency,
      payable_amount,
    });

    const response: DecisionResponse = {
      ok: true,
      // New standardized fields
      payment_flow,
      payable_currency,
      payable_amount,
      // Legacy fields for backwards compatibility
      decision,
      total_usd: totalUsdDollars,
      fx_rate: fxRate,
      total_cdf: totalCdf,
      limits: {
        usd_max: maxUsdDollars,
        cdf_max: maxCdfUnits,
      },
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
