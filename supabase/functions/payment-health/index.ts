/**
 * Payment Health Diagnostic Endpoint
 * 
 * Returns unified status for all payment providers without exposing secrets.
 * Use this to verify the AAB is hitting the correct backend.
 * 
 * Response includes:
 * - Backend environment info
 * - pawaPay config (env, base URL domain)
 * - Stripe config status
 * - Bank transfer config status
 * - Payment limits
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/http.ts";

const corsHeaders = getCorsHeaders();

interface HealthResponse {
  ok: boolean;
  timestamp: string;
  requestId: string;
  backend: {
    supabaseUrlMasked: string;
    region: string;
  };
  providers: {
    pawapay: {
      enabled: boolean;
      env: 'sandbox' | 'production' | 'unknown';
      baseUrlDomain: string;
      tokenConfigured: boolean;
    };
    stripe: {
      enabled: boolean;
      configured: boolean;
    };
    bank_transfer: {
      enabled: boolean;
      configured: boolean;
    };
  };
  limits: {
    pawapayMaxUsd: number;
    pawapayMaxCdf: number;
  };
  envSource: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  console.log('[PAYMENT_HEALTH_REQUEST]', {
    requestId,
    method: req.method,
    userAgent: req.headers.get('user-agent')?.slice(0, 100),
    timestamp,
  });

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    // pawaPay env detection
    const pawapayToken = Deno.env.get('PAWAPAY_API_TOKEN');
    const pawapayBaseUrl = Deno.env.get('PAWAPAY_BASE_URL') || '';
    const pawapayEnv = Deno.env.get('PAWAPAY_ENV') || 'auto';
    
    // Stripe env detection
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    
    // Detect pawaPay mode from base URL
    let pawapayMode: 'sandbox' | 'production' | 'unknown' = 'unknown';
    let pawapayDomain = '';
    try {
      if (pawapayBaseUrl) {
        const url = new URL(pawapayBaseUrl);
        pawapayDomain = url.hostname;
        if (pawapayBaseUrl.includes('sandbox')) {
          pawapayMode = 'sandbox';
        } else if (pawapayBaseUrl.includes('api.pawapay.io') || pawapayBaseUrl.includes('api.pawapay.cloud')) {
          pawapayMode = 'production';
        }
      }
    } catch {
      pawapayDomain = 'invalid_url';
    }

    // Mask supabase URL for security
    let supabaseUrlMasked = '';
    let region = 'unknown';
    try {
      const url = new URL(supabaseUrl);
      const projectId = url.hostname.split('.')[0];
      supabaseUrlMasked = `${projectId.slice(0, 4)}***${projectId.slice(-4)}.supabase.co`;
      // Extract region from URL if available
      if (url.hostname.includes('supabase.co')) {
        region = 'supabase-cloud';
      }
    } catch {
      supabaseUrlMasked = 'invalid';
    }

    // Create admin client to fetch settings
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch payment settings
    const { data: paymentSettings } = await supabaseAdmin
      .from('payment_settings')
      .select('mobile_money_max_usd, mobile_money_max_cdf, pawapay_enabled, stripe_enabled, bank_transfer_enabled')
      .single();

    // Fetch bank transfer settings
    const { data: bankSettings } = await supabaseAdmin
      .from('bank_transfer_settings')
      .select('is_active, bank_name, beneficiary_name')
      .eq('is_active', true)
      .maybeSingle();

    // Build response
    const response: HealthResponse = {
      ok: true,
      timestamp,
      requestId,
      backend: {
        supabaseUrlMasked,
        region,
      },
      providers: {
        pawapay: {
          enabled: paymentSettings?.pawapay_enabled !== false,
          env: pawapayMode,
          baseUrlDomain: pawapayDomain,
          tokenConfigured: !!pawapayToken && pawapayToken.length > 10,
        },
        stripe: {
          enabled: paymentSettings?.stripe_enabled !== false,
          configured: !!stripeSecretKey && stripeSecretKey.startsWith('sk_'),
        },
        bank_transfer: {
          enabled: paymentSettings?.bank_transfer_enabled !== false,
          configured: !!bankSettings && !!bankSettings.bank_name,
        },
      },
      limits: {
        pawapayMaxUsd: paymentSettings?.mobile_money_max_usd || 5000,
        pawapayMaxCdf: paymentSettings?.mobile_money_max_cdf || 10000000,
      },
      envSource: 'DENO_ENV',
    };

    console.log('[PAYMENT_HEALTH_RESPONSE]', {
      requestId,
      pawapayEnv: pawapayMode,
      pawapayDomain,
      stripeConfigured: response.providers.stripe.configured,
      bankTransferConfigured: response.providers.bank_transfer.configured,
    });

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('[PAYMENT_HEALTH_ERROR]', {
      requestId,
      error: error.message,
    });

    return new Response(
      JSON.stringify({
        ok: false,
        timestamp,
        requestId,
        error: 'Failed to fetch payment health',
        message: error.message,
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
