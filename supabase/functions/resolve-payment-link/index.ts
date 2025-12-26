import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Payment Decision Types
 * MAISHAPAY_USD: Order <= $5,000 USD - proceed with MaishaPay in USD
 * MAISHAPAY_CDF: Order > $5,000 USD but <= 30M CDF - proceed with MaishaPay in CDF
 * MANUAL_BANK: Order > 30M CDF - show bank transfer instructions
 */
type PaymentDecision = 'MAISHAPAY_USD' | 'MAISHAPAY_CDF' | 'MANUAL_BANK';

interface ResolveResponse {
  ok: boolean;
  order_id?: string;
  reference_code?: string;
  contains_vehicle?: boolean;
  item_count?: number;
  total_usd?: number;
  fx_rate?: number;
  total_cdf?: number;
  decision?: PaymentDecision;
  reason?: string;
  bank_details?: {
    bank_name: string;
    account_holder: string;
    account_number: string;
    swift: string;
    iban?: string;
    bank_address?: string;
    instructions_fr: string;
    instructions_en: string;
    support_whatsapp: string;
    support_email: string;
  };
  error?: string;
}

/**
 * resolve-payment-link Edge Function
 * 
 * PUBLIC endpoint - no auth required.
 * Resolves payment link token and returns safe order summary with payment decision.
 * 
 * Input: { token: string } or query param ?token=xxx
 * Output: ResolveResponse
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Get token from body or query params
    let token: string | null = null;
    
    const url = new URL(req.url);
    token = url.searchParams.get('token');
    
    if (!token && req.method === 'POST') {
      try {
        const body = await req.json();
        token = body.token;
      } catch {
        // Ignore parse error
      }
    }

    // Validate token before database lookup
    if (!token || token === ':token' || token.length < 16) {
      console.log('[resolve-payment-link] Invalid token format:', token);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: 'Invalid or missing token',
          code: 'INVALID_TOKEN'
        } as ResolveResponse),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch payment link
    const { data: link, error: linkError } = await supabase
      .from('payment_links')
      .select('id, order_id, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (linkError || !link) {
      console.log('[resolve-payment-link] Token not found:', token.substring(0, 8) + '...');
      return new Response(
        JSON.stringify({ ok: false, error: 'Payment link not found' } as ResolveResponse),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiry
    if (new Date(link.expires_at) < new Date()) {
      console.log('[resolve-payment-link] Token expired:', link.id);
      return new Response(
        JSON.stringify({ ok: false, error: 'Payment link has expired. Please request a new link.' } as ResolveResponse),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check status
    if (link.status === 'used') {
      return new Response(
        JSON.stringify({ ok: false, error: 'This payment link has already been used.' } as ResolveResponse),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (link.status === 'expired') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Payment link has expired.' } as ResolveResponse),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch order details (safe fields only - no customer PII)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, 
        status, 
        total_usd, 
        total_cdf,
        exchange_rate_used,
        contains_vehicle,
        maisha_transaction_id
      `)
      .eq('id', link.order_id)
      .single();

    if (orderError || !order) {
      console.error('[resolve-payment-link] Order not found:', link.order_id);
      return new Response(
        JSON.stringify({ ok: false, error: 'Order not found' } as ResolveResponse),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check order status
    if (order.status === 'PAID' || order.status === 'COMPLETED' || order.status === 'SHIPPED') {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: 'This order has already been paid.',
          order_id: order.id,
        } as ResolveResponse),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch item count
    const { count: itemCount } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', order.id)
      .eq('is_saved_for_later', false);

    // Fetch settings for FX rate and limits
    const { data: settings } = await supabase
      .from('settings')
      .select(`
        exchange_rate_usd_to_cdf,
        maishapay_max_usd,
        maishapay_max_cdf,
        bank_name,
        bank_account_holder,
        bank_account_number,
        bank_swift,
        bank_iban,
        bank_address,
        bank_instructions_fr,
        bank_instructions_en,
        support_whatsapp,
        support_email
      `)
      .limit(1)
      .single();

    const fxRate = settings?.exchange_rate_usd_to_cdf || order.exchange_rate_used || 2500;
    const maxUsd = settings?.maishapay_max_usd || 5000;
    const maxCdf = settings?.maishapay_max_cdf || 30000000;

    const totalUsd = Number(order.total_usd || 0);
    const totalCdf = Math.round(totalUsd * fxRate);

    // Generate reference code
    const referenceCode = order.maisha_transaction_id || 
      `AFRISHOP-${order.id.substring(0, 8).toUpperCase()}`;

    // Determine payment decision
    let decision: PaymentDecision;
    let reason: string;

    if (totalUsd <= maxUsd) {
      decision = 'MAISHAPAY_USD';
      reason = `Order total $${totalUsd.toFixed(2)} is within MaishaPay USD limit ($${maxUsd})`;
    } else if (totalCdf <= maxCdf) {
      decision = 'MAISHAPAY_CDF';
      reason = `Order total $${totalUsd.toFixed(2)} exceeds USD limit, converted to ${totalCdf.toLocaleString()} CDF (within ${maxCdf.toLocaleString()} CDF limit)`;
    } else {
      decision = 'MANUAL_BANK';
      reason = `Order total ${totalCdf.toLocaleString()} CDF exceeds MaishaPay limit (${maxCdf.toLocaleString()} CDF). Bank transfer required.`;
    }

    console.log('PAYMENT_LINK_RESOLVED', {
      link_id: link.id,
      order_id: order.id,
      total_usd: totalUsd,
      total_cdf: totalCdf,
      decision,
    });

    const response: ResolveResponse = {
      ok: true,
      order_id: order.id,
      reference_code: referenceCode,
      contains_vehicle: order.contains_vehicle || false,
      item_count: itemCount || 0,
      total_usd: totalUsd,
      fx_rate: fxRate,
      total_cdf: totalCdf,
      decision,
      reason,
    };

    // Include bank details only for MANUAL_BANK decision
    if (decision === 'MANUAL_BANK' && settings) {
      response.bank_details = {
        bank_name: settings.bank_name || 'Contact Support',
        account_holder: settings.bank_account_holder || '',
        account_number: settings.bank_account_number || '',
        swift: settings.bank_swift || '',
        iban: settings.bank_iban || undefined,
        bank_address: settings.bank_address || undefined,
        instructions_fr: settings.bank_instructions_fr || '',
        instructions_en: settings.bank_instructions_en || '',
        support_whatsapp: settings.support_whatsapp || '',
        support_email: settings.support_email || '',
      };
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[resolve-payment-link] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' } as ResolveResponse),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
