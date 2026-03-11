/**
 * App Bootstrap Edge Function
 * 
 * Provides a stable, predictable configuration payload for mobile app startup.
 * NEVER throws - always returns success:true with safe defaults.
 * 
 * Public endpoint (no auth required) - read-only configuration data.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

// ==================== Types ====================

interface ProviderLimit {
  min: number;
  max: number;
  currency: string;
}

interface BankTransferInstructions {
  beneficiary_name: string;
  bank_name: string;
  account_number_or_iban: string;
  swift_bic: string;
  support_email: string;
  support_whatsapp: string;
  instructions_en: string;
  instructions_fr: string;
}

interface PaymentProviderConfig {
  id: string;
  enabled: boolean;
  configured: boolean;
  limits?: ProviderLimit;
  instructions?: BankTransferInstructions;
  publishable_key?: string;
}

interface BootstrapResponse {
  success: boolean;
  timestamp: string;
  env: {
    region: string;
    app_version_min: string;
  };
  payments: {
    providers: PaymentProviderConfig[];
  };
}

// ==================== Helpers ====================

function safeString(value: unknown, fallback: string = ''): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function safeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function safeBoolean(value: unknown, fallback: boolean = false): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

// ==================== Provider Config Builders ====================

function buildPawapayConfig(
  provider: any | null,
  paymentSettings: any | null
): PaymentProviderConfig {
  const isEnabled = safeBoolean(provider?.is_enabled, false) && safeBoolean(paymentSettings?.pawapay_enabled, true);
  const hasSecrets = !!(Deno.env.get('PAWAPAY_API_TOKEN'));
  
  return {
    id: 'pawapay',
    enabled: isEnabled,
    configured: hasSecrets && !!provider,
    limits: {
      min: 0,
      max: safeNumber(paymentSettings?.mobile_money_max_usd, 5000),
      currency: 'USD',
    },
  };
}

function buildStripeConfig(
  provider: any | null,
  paymentSettings: any | null
): PaymentProviderConfig {
  const isEnabled = safeBoolean(provider?.is_enabled, false) && safeBoolean(paymentSettings?.stripe_enabled, false);
  const hasSecrets = !!(Deno.env.get('STRIPE_SECRET_KEY'));
  
  // Get publishable key from provider config or environment
  const publishableKey = provider?.config_public?.publishable_key || Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '';
  
  // Stripe handles amounts above pawaPay limit
  const pawaPayMax = safeNumber(paymentSettings?.mobile_money_max_usd, 5000);
  
  return {
    id: 'stripe',
    enabled: isEnabled,
    configured: hasSecrets && !!provider,
    limits: {
      min: pawaPayMax,
      max: 100000, // 100k USD practical upper limit
      currency: 'USD',
    },
    publishable_key: publishableKey,
  };
}

function buildBankTransferConfig(
  provider: any | null,
  paymentSettings: any | null,
  bankSettings: any | null
): PaymentProviderConfig {
  const isEnabled = safeBoolean(provider?.is_enabled, true) && safeBoolean(paymentSettings?.bank_transfer_enabled, true);
  
  // Check if bank transfer is actually configured with required fields
  const isConfigured = !!(
    bankSettings &&
    safeString(bankSettings.beneficiary_name) &&
    safeString(bankSettings.bank_name) &&
    safeString(bankSettings.account_number_or_iban)
  );
  
  return {
    id: 'bank_transfer',
    enabled: isEnabled,
    configured: isConfigured,
    limits: {
      min: 0,
      max: 1000000, // 1M USD for very large transfers
      currency: 'USD',
    },
    instructions: {
      beneficiary_name: safeString(bankSettings?.beneficiary_name),
      bank_name: safeString(bankSettings?.bank_name),
      account_number_or_iban: safeString(bankSettings?.account_number_or_iban),
      swift_bic: safeString(bankSettings?.swift_bic),
      support_email: safeString(bankSettings?.support_email),
      support_whatsapp: safeString(bankSettings?.support_whatsapp),
      instructions_en: safeString(bankSettings?.instructions_en),
      instructions_fr: safeString(bankSettings?.instructions_fr),
    },
  };
}

// ==================== Main Handler ====================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  console.log(`[${requestId}] app-bootstrap: Start`);

  // Default safe response - NEVER throw from this function
  const safeResponse: BootstrapResponse = {
    success: true,
    timestamp,
    env: {
      region: Deno.env.get('DENO_REGION') || 'unknown',
      app_version_min: '1.0.0',
    },
    payments: {
      providers: [
        { id: 'pawapay', enabled: false, configured: false, limits: { min: 0, max: 5000, currency: 'USD' } },
        { id: 'stripe', enabled: false, configured: false, limits: { min: 5000, max: 100000, currency: 'USD' } },
        { id: 'bank_transfer', enabled: false, configured: false, limits: { min: 0, max: 1000000, currency: 'USD' }, instructions: { beneficiary_name: '', bank_name: '', account_number_or_iban: '', swift_bic: '', support_email: '', support_whatsapp: '', instructions_en: '', instructions_fr: '' } },
      ],
    },
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${requestId}] Missing Supabase env vars - returning safe defaults`);
      return new Response(JSON.stringify(safeResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all data in parallel
    const [providersResult, paymentSettingsResult, bankSettingsResult] = await Promise.all([
      supabase
        .from('payment_providers')
        .select('*')
        .in('provider_key', ['pawapay', 'stripe', 'bank_transfer']),
      supabase
        .from('payment_settings')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('bank_transfer_settings')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
    ]);

    // Log errors but don't fail
    if (providersResult.error) {
      console.warn(`[${requestId}] Failed to fetch providers:`, providersResult.error.message);
    }
    if (paymentSettingsResult.error) {
      console.warn(`[${requestId}] Failed to fetch payment settings:`, paymentSettingsResult.error.message);
    }
    if (bankSettingsResult.error) {
      console.warn(`[${requestId}] Failed to fetch bank settings:`, bankSettingsResult.error.message);
    }

    const providers = providersResult.data || [];
    const paymentSettings = paymentSettingsResult.data || null;
    const bankSettings = bankSettingsResult.data || null;

    // Find individual providers
    const pawapayProvider = providers.find((p: any) => p.provider_key === 'pawapay') || null;
    const stripeProvider = providers.find((p: any) => p.provider_key === 'stripe') || null;
    const bankTransferProvider = providers.find((p: any) => p.provider_key === 'bank_transfer') || null;

    // Build response
    const response: BootstrapResponse = {
      success: true,
      timestamp,
      env: {
        region: Deno.env.get('DENO_REGION') || 'unknown',
        app_version_min: '1.0.0',
      },
      payments: {
        providers: [
          buildPawapayConfig(pawapayProvider, paymentSettings),
          buildStripeConfig(stripeProvider, paymentSettings),
          buildBankTransferConfig(bankTransferProvider, paymentSettings, bankSettings),
        ],
      },
    };

    console.log(`[${requestId}] app-bootstrap: Success`, {
      providersConfigured: response.payments.providers.filter(p => p.configured).length,
      providersEnabled: response.payments.providers.filter(p => p.enabled).length,
    });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    // NEVER throw - log and return safe defaults
    console.error(`[${requestId}] Unexpected error:`, error?.message || error);
    
    return new Response(JSON.stringify(safeResponse), {
      status: 200, // Still 200 - client gets safe defaults
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
