/**
 * AvadaPay Payment Adapter (STUB)
 * 
 * This is a placeholder for future AvadaPay integration.
 * All methods throw "not configured" errors until the integration is implemented.
 */

import { PaymentProvider } from "./paymentProviders.ts";

// ==================== Types ====================

export interface AvadaPayConfig {
  apiKey: string;
  secretKey: string;
  mode: 'sandbox' | 'live';
}

export interface CreatePaymentParams {
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  phone?: string;
  description?: string;
}

export interface CreatePaymentResult {
  success: boolean;
  provider_deposit_id?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  error?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  error?: string;
}

export interface WebhookResult {
  success: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  order_id?: string;
  error?: string;
}

// ==================== Error Messages ====================

const NOT_CONFIGURED_ERROR = {
  code: 'AVADAPAY_NOT_CONFIGURED',
  message_en: 'AvadaPay is not configured yet. Please use another payment method.',
  message_fr: 'AvadaPay n\'est pas encore configuré. Veuillez utiliser un autre mode de paiement.',
};

// ==================== Config ====================

/**
 * Get AvadaPay configuration from provider config
 * @throws Always throws - not implemented
 */
export function getAvadaPayConfig(_provider: PaymentProvider): AvadaPayConfig {
  throw new Error(NOT_CONFIGURED_ERROR.message_en);
}

// ==================== API Methods (All Stubs) ====================

/**
 * Create a payment with AvadaPay
 * @throws Always throws - not implemented
 */
export async function createPayment(
  _config: AvadaPayConfig,
  _params: CreatePaymentParams
): Promise<CreatePaymentResult> {
  console.log('[AvadaPay] createPayment called - NOT IMPLEMENTED');
  
  return {
    success: false,
    status: 'failed',
    error: NOT_CONFIGURED_ERROR.message_en,
  };
}

/**
 * Verify a payment status
 * @throws Always throws - not implemented
 */
export async function verifyPayment(
  _config: AvadaPayConfig,
  _transactionId: string
): Promise<VerifyPaymentResult> {
  console.log('[AvadaPay] verifyPayment called - NOT IMPLEMENTED');
  
  return {
    success: false,
    status: 'pending',
    error: NOT_CONFIGURED_ERROR.message_en,
  };
}

/**
 * Handle webhook callback
 * @throws Always throws - not implemented
 */
export function handleWebhook(
  _payload: any
): WebhookResult {
  console.log('[AvadaPay] handleWebhook called - NOT IMPLEMENTED');
  
  return {
    success: false,
    status: 'pending',
    error: NOT_CONFIGURED_ERROR.message_en,
  };
}

/**
 * Test AvadaPay configuration
 * Always returns not configured status
 */
export async function testConfiguration(): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  console.log('[AvadaPay] testConfiguration called - NOT IMPLEMENTED');
  
  return {
    success: false,
    message: 'Coming soon',
    error: NOT_CONFIGURED_ERROR.message_en,
  };
}

/**
 * Check if AvadaPay is implemented
 */
export function isImplemented(): boolean {
  return false;
}

/**
 * Get the not configured error
 */
export function getNotConfiguredError(): typeof NOT_CONFIGURED_ERROR {
  return NOT_CONFIGURED_ERROR;
}
