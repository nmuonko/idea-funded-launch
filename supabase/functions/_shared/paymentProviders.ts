/**
 * Payment Provider System - Provider-Agnostic Payment Gateway
 * 
 * Supports multiple payment providers (pawaPay, Stripe, Bank Transfer)
 * with automatic routing based on enabled providers, countries, and methods.
 * 
 * MaishaPay REMOVED - 2026-01
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ==================== Types ====================

export interface CurrencyLimit {
  min: number;
  max: number | null; // null means unlimited
}

export interface ProviderLimits {
  USD?: CurrencyLimit;
  CDF?: CurrencyLimit;
}

export interface PaymentProvider {
  id: string;
  provider_key: string;
  display_name: string;
  is_enabled: boolean;
  is_default: boolean;
  supported_countries: string[];
  supported_methods: string[];
  priority: number;
  config_public: {
    mode?: string;
    status?: string;
    limits?: ProviderLimits;
    [key: string]: any;
  };
  secret_refs: Record<string, string>;
}

export interface CreatePaymentParams {
  orderId: string;
  amount: number;
  currency: 'USD' | 'CDF';
  customerPhone?: string;
  customerEmail: string;
  country?: string;
  method?: string;
  reference?: string;
  description?: string;
}

export interface CreatePaymentResult {
  success: boolean;
  provider_key: string;
  reference: string;
  provider_deposit_id?: string;
  checkoutUrl?: string;
  html?: string;
  status: 'pending' | 'accepted' | 'rejected';
  message?: string;
  error?: string;
  raw_request?: any;
  raw_response?: any;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  provider_transaction_id?: string;
  paid_at?: string;
  error?: string;
}

export interface CallbackResult {
  success: boolean;
  payment_id?: string;
  order_id?: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  idempotent?: boolean;
  error?: string;
}

// ==================== Provider Router ====================

/**
 * Get the active payment provider based on country and method
 * Falls back by priority if default is not suitable
 * 
 * MaishaPay is EXCLUDED from selection
 */
export async function getActiveProvider(
  supabase: SupabaseClient,
  country: string = 'COD',
  method: string = 'MOBILE_MONEY'
): Promise<PaymentProvider | null> {
  // First try to get default enabled provider that matches criteria
  // EXCLUDE maishapay from results
  const { data: providers, error } = await supabase
    .from('payment_providers')
    .select('*')
    .eq('is_enabled', true)
    .neq('provider_key', 'maishapay') // EXCLUDE MaishaPay
    .order('is_default', { ascending: false })
    .order('priority', { ascending: true });

  if (error || !providers || providers.length === 0) {
    console.error('[PaymentRouter] No enabled providers found (excluding maishapay):', error?.message);
    return null;
  }

  // Find first provider that matches country and method
  for (const provider of providers) {
    const matchesCountry = provider.supported_countries.length === 0 || 
                           provider.supported_countries.includes(country);
    const matchesMethod = provider.supported_methods.length === 0 || 
                          provider.supported_methods.includes(method);
    
    if (matchesCountry && matchesMethod) {
      console.log('[PaymentRouter] Selected provider:', provider.provider_key, {
        is_default: provider.is_default,
        priority: provider.priority,
        country,
        method,
      });
      return provider;
    }
  }

  // Fallback to first enabled provider (excluding maishapay)
  console.warn('[PaymentRouter] No matching provider, using fallback:', providers[0].provider_key);
  return providers[0];
}

/**
 * Provider selection result with currency
 */
export interface ProviderSelectionResult {
  success: boolean;
  provider?: PaymentProvider;
  currency?: 'USD' | 'CDF';
  error?: string;
}

/**
 * Check if a provider supports a given currency and amount
 */
function providerSupportsAmount(
  provider: PaymentProvider,
  currency: 'USD' | 'CDF',
  amount: number
): boolean {
  const limits = provider.config_public?.limits;
  if (!limits) {
    // No limits configured = supports any amount
    // But check if provider supports the currency
    if (provider.provider_key === 'stripe') {
      return currency === 'USD'; // Stripe only supports USD
    }
    return true;
  }

  const currencyLimits = limits[currency];
  if (!currencyLimits) {
    // No limits for this currency = doesn't support it
    // Exception: if provider is stripe, only USD
    if (provider.provider_key === 'stripe') {
      return currency === 'USD';
    }
    return false;
  }

  const { min, max } = currencyLimits;
  if (amount < min) return false;
  if (max !== null && amount > max) return false;
  
  return true;
}

/**
 * Select the best provider based on currency, amount, and order type
 * 
 * UPDATED RULES (2026-01) - MaishaPay REMOVED:
 * 1. Vehicles → Stripe (USD) or Bank Transfer
 * 2. Regular orders → pawaPay mobile money in requested currency (USD or CDF)
 */
export async function selectProviderByLimits(
  supabase: SupabaseClient,
  amountUsd: number,
  amountCdf: number,
  isVehicle: boolean = false,
  requestedCurrency: 'USD' | 'CDF' = 'USD'
): Promise<ProviderSelectionResult> {
  // Fetch all enabled providers sorted by priority, EXCLUDING maishapay
  const { data: providers, error } = await supabase
    .from('payment_providers')
    .select('*')
    .eq('is_enabled', true)
    .neq('provider_key', 'maishapay') // EXCLUDE MaishaPay
    .order('priority', { ascending: true });

  if (error || !providers || providers.length === 0) {
    console.error('[PaymentRouter] No enabled providers found:', error?.message);
    return { success: false, error: 'No payment providers available' };
  }

  console.log('[PaymentRouter] Evaluating providers for:', { 
    amountUsd, 
    amountCdf, 
    isVehicle, 
    requestedCurrency,
    availableProviders: providers.map(p => p.provider_key),
  });

  // RULE 1: Vehicles require Stripe (card) or Bank Transfer
  if (isVehicle) {
    const stripeProvider = providers.find(p => p.provider_key === 'stripe');
    if (stripeProvider) {
      console.log('[PaymentRouter] Vehicle order - selected Stripe');
      return { success: true, provider: stripeProvider, currency: 'USD' };
    }
    // Fallback to bank transfer (caller handles this)
    console.log('[PaymentRouter] Vehicle order - no Stripe, will use bank transfer');
    return { success: false, error: 'VEHICLE_BANK_TRANSFER_REQUIRED' };
  }

  // RULE 2: Regular orders use pawaPay mobile money
  const pawaPayProvider = providers.find(p => p.provider_key === 'pawapay');

  if (pawaPayProvider) {
    const currency = requestedCurrency;
    const amount = currency === 'USD' ? amountUsd : amountCdf;
    
    console.log('[PaymentRouter] Regular order - selected pawaPay:', {
      provider: pawaPayProvider.provider_key,
      currency,
      amount,
    });
    
    return { success: true, provider: pawaPayProvider, currency };
  }

  // Fallback: try any available provider (but not maishapay)
  const fallbackProvider = providers[0];
  if (fallbackProvider) {
    console.log('[PaymentRouter] Using fallback provider:', fallbackProvider.provider_key);
    return { 
      success: true, 
      provider: fallbackProvider, 
      currency: requestedCurrency 
    };
  }

  return { success: false, error: 'No suitable payment provider available' };
}

/**
 * Get a specific provider by key
 * Returns null for maishapay (disabled)
 */
export async function getProviderByKey(
  supabase: SupabaseClient,
  providerKey: string
): Promise<PaymentProvider | null> {
  // Block maishapay lookups
  if (providerKey === 'maishapay') {
    console.warn('[PaymentRouter] MaishaPay is disabled, returning null');
    return null;
  }

  const { data, error } = await supabase
    .from('payment_providers')
    .select('*')
    .eq('provider_key', providerKey)
    .single();

  if (error) {
    console.error('[PaymentRouter] Provider not found:', providerKey, error.message);
    return null;
  }

  return data;
}

/**
 * Get all providers (for admin) - excludes maishapay
 */
export async function getAllProviders(supabase: SupabaseClient): Promise<PaymentProvider[]> {
  const { data, error } = await supabase
    .from('payment_providers')
    .select('*')
    .neq('provider_key', 'maishapay') // EXCLUDE MaishaPay
    .order('priority', { ascending: true });

  if (error) {
    console.error('[PaymentRouter] Failed to fetch providers:', error.message);
    return [];
  }

  return data || [];
}

// ==================== Reference Generation ====================

/**
 * Generate a unique payment reference
 */
export function generatePaymentReference(orderId: string): string {
  const timestamp = Date.now().toString(36);
  return `AFRISHOP-${orderId.slice(0, 8)}-${timestamp}`;
}

/**
 * Generate a UUID for pawaPay deposit
 */
export function generateDepositId(): string {
  return crypto.randomUUID();
}

// ==================== Secret Resolution ====================

/**
 * Get secret value from environment using reference name
 * NEVER returns the actual secret - only used internally
 */
export function getSecretValue(secretRef: string): string | undefined {
  return Deno.env.get(secretRef);
}

/**
 * Check if all required secrets are configured for a provider
 */
export function validateProviderSecrets(
  provider: PaymentProvider
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  
  for (const [key, secretRef] of Object.entries(provider.secret_refs)) {
    if (!getSecretValue(secretRef)) {
      missing.push(key);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing,
  };
}

// ==================== Database Helpers ====================

/**
 * Create a payment record in the database
 */
export async function createPaymentRecord(
  supabase: SupabaseClient,
  params: {
    order_id: string;
    provider_key: string;
    amount: number;
    currency: string;
    reference: string;
    customer_phone?: string;
    country?: string;
    provider_deposit_id?: string;
    raw_request?: any;
    status?: string;
  }
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      order_id: params.order_id,
      provider_key: params.provider_key,
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      customer_phone: params.customer_phone || null,
      country: params.country || 'COD',
      provider_deposit_id: params.provider_deposit_id || null,
      raw_request: params.raw_request || null,
      status: params.status || 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[PaymentRouter] Failed to create payment record:', error.message);
    return null;
  }

  return data;
}

/**
 * Update payment status
 */
export async function updatePaymentStatus(
  supabase: SupabaseClient,
  paymentId: string,
  status: string,
  extras?: {
    provider_transaction_id?: string;
    paid_at?: string;
    raw_events?: any[];
  }
): Promise<boolean> {
  const updateData: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (extras?.provider_transaction_id) {
    updateData.provider_transaction_id = extras.provider_transaction_id;
  }
  if (extras?.paid_at) {
    updateData.paid_at = extras.paid_at;
  }
  if (extras?.raw_events) {
    updateData.raw_events = extras.raw_events;
  }

  const { error } = await supabase
    .from('payments')
    .update(updateData)
    .eq('id', paymentId);

  if (error) {
    console.error('[PaymentRouter] Failed to update payment:', error.message);
    return false;
  }

  return true;
}

/**
 * Get payment by order ID
 */
export async function getPaymentByOrderId(
  supabase: SupabaseClient,
  orderId: string
): Promise<any | null> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .neq('provider_key', 'maishapay') // EXCLUDE MaishaPay records
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[PaymentRouter] Failed to get payment:', error.message);
    return null;
  }

  return data;
}

/**
 * Get payment by reference
 */
export async function getPaymentByReference(
  supabase: SupabaseClient,
  reference: string
): Promise<any | null> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('reference', reference)
    .neq('provider_key', 'maishapay') // EXCLUDE MaishaPay records
    .maybeSingle();

  if (error) {
    console.error('[PaymentRouter] Failed to get payment by reference:', error.message);
    return null;
  }

  return data;
}

/**
 * Get payment by provider deposit ID
 */
export async function getPaymentByDepositId(
  supabase: SupabaseClient,
  providerKey: string,
  depositId: string
): Promise<any | null> {
  // Block maishapay lookups
  if (providerKey === 'maishapay') {
    return null;
  }

  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('provider_key', providerKey)
    .eq('provider_deposit_id', depositId)
    .maybeSingle();

  if (error) {
    console.error('[PaymentRouter] Failed to get payment by deposit ID:', error.message);
    return null;
  }

  return data;
}

/**
 * Log a payment event (idempotent)
 */
export async function logPaymentEvent(
  supabase: SupabaseClient,
  params: {
    payment_id?: string;
    provider_key: string;
    event_type: string;
    event_id?: string;
    payload: any;
  }
): Promise<{ inserted: boolean; duplicate: boolean }> {
  // Block maishapay events
  if (params.provider_key === 'maishapay') {
    console.warn('[PaymentRouter] Ignoring MaishaPay event');
    return { inserted: false, duplicate: false };
  }

  // If event_id provided, check for duplicate first
  if (params.event_id) {
    const { data: existing } = await supabase
      .from('payment_events')
      .select('id')
      .eq('provider_key', params.provider_key)
      .eq('event_id', params.event_id)
      .maybeSingle();

    if (existing) {
      console.log('[PaymentRouter] Duplicate event detected:', params.event_id);
      return { inserted: false, duplicate: true };
    }
  }

  const { error } = await supabase
    .from('payment_events')
    .insert({
      payment_id: params.payment_id || null,
      provider_key: params.provider_key,
      event_type: params.event_type,
      event_id: params.event_id || null,
      payload: params.payload,
    });

  if (error) {
    // Could be unique constraint violation (race condition)
    if (error.code === '23505') {
      return { inserted: false, duplicate: true };
    }
    console.error('[PaymentRouter] Failed to log event:', error.message);
    return { inserted: false, duplicate: false };
  }

  return { inserted: true, duplicate: false };
}

// ==================== Status Mapping ====================

/**
 * Map provider-specific status to our standard status
 * MaishaPay mapping REMOVED
 */
export function normalizePaymentStatus(
  providerKey: string,
  providerStatus: string | number
): 'pending' | 'succeeded' | 'failed' | 'cancelled' {
  const status = String(providerStatus).toLowerCase();

  if (providerKey === 'pawapay') {
    // pawaPay statuses: ACCEPTED, COMPLETED, FAILED, CANCELLED
    if (status === 'completed') return 'succeeded';
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'accepted' || status === 'submitted') return 'pending';
  }

  if (providerKey === 'stripe') {
    // Stripe statuses
    if (status === 'succeeded' || status === 'paid') return 'succeeded';
    if (status === 'failed' || status === 'payment_failed') return 'failed';
    if (status === 'canceled' || status === 'cancelled') return 'cancelled';
    if (status === 'processing' || status === 'requires_action' || status === 'requires_confirmation') return 'pending';
  }

  // Default: unknown status = pending
  return 'pending';
}

// ==================== Admin Client Helper ====================

/**
 * Create admin Supabase client using service role
 */
export function createAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
