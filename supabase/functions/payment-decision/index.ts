import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Payment Decision Types - MUST match resolve-payment-link exactly
 */
type PaymentDecision = 'MAISHAPAY_USD' | 'MAISHAPAY_CDF' | 'MANUAL_BANK';

interface DecisionResponse {
  ok: boolean;
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
 * Shared decision logic - MUST match resolve-payment-link exactly
 */
function computeDecision(
  totalUsd: number,
  fxRate: number,
  maxUsd: number,
  maxCdf: number
): { decision: PaymentDecision; totalCdf: number; message_fr: string; message_en: string } {
  const totalCdf = Math.round(totalUsd * fxRate);

  if (totalUsd <= maxUsd) {
    return {
      decision: 'MAISHAPAY_USD',
      totalCdf,
      message_fr: `Paiement en USD via MaishaPay ($${totalUsd.toFixed(2)})`,
      message_en: `Pay in USD via MaishaPay ($${totalUsd.toFixed(2)})`,
    };
  } else if (totalCdf <= maxCdf) {
    return {
      decision: 'MAISHAPAY_CDF',
      totalCdf,
      message_fr: `Montant supérieur à $${maxUsd}. Paiement en CDF via Mobile Money (${totalCdf.toLocaleString()} CDF)`,
      message_en: `Amount exceeds $${maxUsd}. Pay in CDF via Mobile Money (${totalCdf.toLocaleString()} CDF)`,
    };
  } else {
    return {
      decision: 'MANUAL_BANK',
      totalCdf,
      message_fr: `Montant supérieur à ${maxCdf.toLocaleString()} CDF. Virement bancaire requis.`,
      message_en: `Amount exceeds ${maxCdf.toLocaleString()} CDF. Bank transfer required.`,
    };
  }
}

/**
 * payment-decision Edge Function
 * 
 * Returns payment decision based on order/cart total.
 * Used by mobile app and frontend before initiating checkout.
 * 
 * Input: { order_id: string } OR { cart_snapshot: CartItem[] } OR { total_usd: number }
 * Output: DecisionResponse
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
    const maxUsd = settings?.maishapay_max_usd || 5000;
    const maxCdf = settings?.maishapay_max_cdf || 30000000;

    let totalUsd: number;

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

      totalUsd = Number(order.total_usd || 0);
    } else if (cart_snapshot && Array.isArray(cart_snapshot)) {
      // Calculate from cart snapshot
      totalUsd = cart_snapshot.reduce((sum, item) => {
        const itemTotal = item.total_price_usd 
          || item.subtotal_usd 
          || (item.base_price_usd || 0) * (item.quantity || 1);
        return sum + Number(itemTotal || 0);
      }, 0);
    } else if (providedTotal !== undefined) {
      // Use directly provided total
      totalUsd = Number(providedTotal);
    } else {
      totalUsd = 0;
    }

    // Compute decision using shared logic
    const { decision, totalCdf, message_fr, message_en } = computeDecision(
      totalUsd,
      fxRate,
      maxUsd,
      maxCdf
    );

    console.log('[payment-decision]', {
      input: order_id ? 'order_id' : cart_snapshot ? 'cart_snapshot' : 'total_usd',
      total_usd: totalUsd,
      total_cdf: totalCdf,
      decision,
    });

    const response: DecisionResponse = {
      ok: true,
      decision,
      total_usd: totalUsd,
      fx_rate: fxRate,
      total_cdf: totalCdf,
      limits: {
        usd_max: maxUsd,
        cdf_max: maxCdf,
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
