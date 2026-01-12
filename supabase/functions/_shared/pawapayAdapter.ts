/**
 * pawaPay Payment Adapter
 * 
 * Implements the pawaPay Merchant API v2 for mobile money payments in DRC.
 * Documentation: https://docs.pawapay.io/v2/docs/how_to_start
 * 
 * Authentication: Bearer token in Authorization header
 * Callbacks: Configured in pawaPay dashboard, sent as POST to our callback endpoint
 */

import { 
  CreatePaymentParams, 
  CreatePaymentResult, 
  VerifyPaymentResult,
  CallbackResult,
  PaymentProvider,
  generateDepositId,
} from "./paymentProviders.ts";

// ==================== Types ====================

export interface PawaPayConfig {
  apiToken: string;
  apiBase: string;
  mode: 'sandbox' | 'live';
}

export interface PawaPayDepositRequest {
  depositId: string;
  amount: string;
  currency: 'USD' | 'CDF';
  correspondent: string;
  payer: {
    type: 'MSISDN';
    address: {
      value: string;
    };
  };
  customerTimestamp: string;
  statementDescription: string;
}

export interface PawaPayDepositResponse {
  depositId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE_IGNORED';
  created?: string;
  rejectionReason?: {
    rejectionCode: string;
    rejectionMessage: string;
  };
}

export interface PawaPayCallbackPayload {
  depositId: string;
  status: 'COMPLETED' | 'FAILED';
  amount: string;
  currency: string;
  correspondent: string;
  payer: {
    type: string;
    address: {
      value: string;
    };
  };
  customerTimestamp: string;
  created: string;
  respondedByPayer?: string;
  correspondentIds?: {
    recipientId?: string;
    operatorId?: string;
  };
  suspenseAmount?: string;
  suspenseCurrency?: string;
  failureReason?: {
    failureCode: string;
    failureMessage: string;
  };
}

// ==================== DRC Mobile Money Correspondents ====================

const DRC_CORRESPONDENTS: Record<string, string> = {
  // Vodacom M-Pesa
  'VODACOM': 'VODACOM_MPESA_COD',
  'MPESA': 'VODACOM_MPESA_COD',
  '81': 'VODACOM_MPESA_COD',
  '82': 'VODACOM_MPESA_COD',
  '83': 'VODACOM_MPESA_COD',
  
  // Airtel Money
  'AIRTEL': 'AIRTEL_COD',
  '99': 'AIRTEL_COD',
  '97': 'AIRTEL_COD',
  
  // Orange Money
  'ORANGE': 'ORANGE_COD',
  '84': 'ORANGE_COD',
  '85': 'ORANGE_COD',
  '89': 'ORANGE_COD',
};

/**
 * Detect mobile money correspondent from phone number
 */
export function detectCorrespondent(phoneNumber: string): string {
  // Remove spaces, dashes, and country code
  const cleaned = phoneNumber.replace(/[\s\-+]/g, '');
  
  // Extract prefix (first 2 digits after country code)
  let prefix = '';
  if (cleaned.startsWith('243')) {
    prefix = cleaned.slice(3, 5);
  } else if (cleaned.startsWith('0')) {
    prefix = cleaned.slice(1, 3);
  } else {
    prefix = cleaned.slice(0, 2);
  }
  
  const correspondent = DRC_CORRESPONDENTS[prefix];
  if (!correspondent) {
    // Default to Vodacom if unknown
    console.warn('[pawaPay] Unknown phone prefix:', prefix, 'defaulting to VODACOM');
    return 'VODACOM_MPESA_COD';
  }
  
  return correspondent;
}

/**
 * Format phone number to E.164 format for DRC
 */
export function formatPhoneE164(phoneNumber: string): string {
  const cleaned = phoneNumber.replace(/[\s\-+]/g, '');
  
  if (cleaned.startsWith('243')) {
    return cleaned;
  }
  if (cleaned.startsWith('0')) {
    return '243' + cleaned.slice(1);
  }
  
  return '243' + cleaned;
}

// ==================== Config ====================

/**
 * Configuration error class for missing/invalid config
 */
export class ConfigMissingError extends Error {
  code = 'CONFIG_MISSING';
  provider = 'pawapay';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigMissingError';
  }
}

/**
 * Detect environment mode from base URL hostname
 */
function detectEnvFromUrl(baseUrl: string): 'sandbox' | 'production' {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname.includes('sandbox')) {
      return 'sandbox';
    }
    return 'production';
  } catch {
    return 'sandbox';
  }
}

/**
 * Get pawaPay configuration DIRECTLY from Deno.env.get()
 * 
 * CANONICAL ENV VARS (REQUIRED):
 *   - PAWAPAY_API_TOKEN  : Bearer token from pawaPay dashboard
 *   - PAWAPAY_BASE_URL   : API base URL (must match token environment)
 *     - Sandbox: https://api.sandbox.pawapay.io
 *     - Production: https://api.pawapay.io
 * 
 * IMPORTANT: Token and base URL must be from the SAME environment.
 * Using a sandbox token with production URL (or vice versa) will cause 401.
 */
export function getPawaPayConfig(_provider?: PaymentProvider): PawaPayConfig {
  // Read DIRECTLY from Deno.env.get() - canonical names only
  const rawToken = Deno.env.get('PAWAPAY_API_TOKEN') ?? '';
  const rawBaseUrl = Deno.env.get('PAWAPAY_BASE_URL') ?? '';
  
  // Trim to handle trailing newlines/whitespace
  const apiToken = rawToken.trim();
  const apiBase = rawBaseUrl.trim();
  
  // SAFE LOGGING: log presence, length, domain - NEVER the actual token
  const tokenPresent = apiToken.length > 0;
  const baseUrlPresent = apiBase.length > 0;
  let baseUrlDomain = 'N/A';
  let envGuess: 'sandbox' | 'production' | 'unknown' = 'unknown';
  
  if (baseUrlPresent) {
    try {
      baseUrlDomain = new URL(apiBase).hostname;
      envGuess = detectEnvFromUrl(apiBase);
    } catch {
      baseUrlDomain = 'INVALID_URL';
    }
  }
  
  console.log('[pawapay-auth]', {
    token_present: tokenPresent,
    token_length: apiToken.length,
    base_url_present: baseUrlPresent,
    base_url_domain: baseUrlDomain,
    env_guess: envGuess,
  });
  
  // HARD GUARD: Both token and base URL are REQUIRED
  if (!tokenPresent || !baseUrlPresent) {
    const missing: string[] = [];
    if (!tokenPresent) missing.push('PAWAPAY_API_TOKEN');
    if (!baseUrlPresent) missing.push('PAWAPAY_BASE_URL');
    
    console.error('[pawapay-auth] CONFIG_MISSING:', { missing });
    throw new ConfigMissingError(
      `pawaPay is not configured (missing: ${missing.join(', ')}). ` +
      `Set PAWAPAY_API_TOKEN and PAWAPAY_BASE_URL in secrets.`
    );
  }
  
  // Determine mode from base URL
  const mode: 'sandbox' | 'live' = envGuess === 'production' ? 'live' : 'sandbox';

  return {
    apiToken,
    apiBase,
    mode,
  };
}

// ==================== Helpers ====================

/**
 * Create a valid pawaPay statement description (max 22 chars)
 * 
 * pawaPay requires: max 22 chars, alphanumeric + space + hyphen only
 * 
 * Examples:
 *   BEFORE: "AfriShop 550e8400-e29b-41d4-a716-446655440000" (47 chars)
 *   AFTER:  "AFRISHOP-446655440000" (21 chars)
 * 
 *   BEFORE: "Payment for order #123"
 *   AFTER:  "Payment for order 12" (truncated to 22)
 */
function makeStatementDescription(input: string, orderId?: string): string {
  const MAX_LEN = 22;
  
  // Normalize: trim, collapse multiple spaces
  let normalized = (input || '').trim().replace(/\s+/g, ' ');
  
  // Remove non-allowed chars: keep A-Z, a-z, 0-9, space, hyphen
  normalized = normalized.replace(/[^A-Za-z0-9 \-]/g, '');
  
  // If already valid length, return it
  if (normalized.length > 0 && normalized.length <= MAX_LEN) {
    console.log('[pawapay] statementDescription="' + normalized + '" length=' + normalized.length);
    return normalized;
  }
  
  // If too long, try to truncate
  if (normalized.length > MAX_LEN) {
    const truncated = normalized.slice(0, MAX_LEN).trim();
    console.log('[pawapay] statementDescription="' + truncated + '" length=' + truncated.length + ' (truncated from ' + normalized.length + ')');
    return truncated;
  }
  
  // Empty input - create a safe default using orderId
  // Format: "AFRISHOP-" + last 12 chars of orderId = 9 + 12 = 21 chars max
  if (orderId) {
    // Remove dashes from UUID and take last 12 chars
    const cleanId = orderId.replace(/[^A-Za-z0-9]/g, '');
    const suffix = cleanId.slice(-12);
    const defaultDesc = 'AFRISHOP-' + suffix;
    console.log('[pawapay] statementDescription="' + defaultDesc + '" length=' + defaultDesc.length + ' (default)');
    return defaultDesc;
  }
  
  // Ultimate fallback
  const fallback = 'AFRISHOP-PAYMENT';
  console.log('[pawapay] statementDescription="' + fallback + '" length=' + fallback.length + ' (fallback)');
  return fallback;
}

// ==================== API Methods ====================

/**
 * Structured error result for better debugging
 */
export interface ProviderErrorDetails {
  provider: 'pawapay';
  provider_http_status?: number;
  provider_error_code?: string;
  provider_message?: string;
  provider_request_id?: string;
  is_rejection: boolean; // true = provider rejected (4xx-type), false = server error
  is_auth_error?: boolean; // true = 401 Unauthorized, server misconfig
}

/**
 * Create a deposit (payment request) with pawaPay
 * 
 * Returns structured error details for better debugging and error mapping
 */
export async function createDeposit(
  config: PawaPayConfig,
  params: CreatePaymentParams
): Promise<CreatePaymentResult & { errorDetails?: ProviderErrorDetails }> {
  const depositId = generateDepositId();
  const correspondent = detectCorrespondent(params.customerPhone || '');
  const phoneE164 = formatPhoneE164(params.customerPhone || '');
  
  const request: PawaPayDepositRequest = {
    depositId,
    amount: params.amount.toFixed(2),
    currency: params.currency,
    correspondent,
    payer: {
      type: 'MSISDN',
      address: {
        value: phoneE164,
      },
    },
    customerTimestamp: new Date().toISOString(),
    // pawaPay requires statementDescription <= 22 chars, alphanumeric + space + hyphen only
    statementDescription: makeStatementDescription(
      params.description || `AfriShop ${params.reference || params.orderId}`,
      params.orderId
    ),
  };

  // SAFE LOGGING: mask phone, no secrets
  console.log('[pawaPay] [provider-init] Creating deposit:', {
    depositId,
    amount: request.amount,
    currency: request.currency,
    correspondent,
    phone_last4: phoneE164.slice(-4),
    order_id: params.orderId,
  });

  try {
    const response = await fetch(`${config.apiBase}/deposits`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const httpStatus = response.status;
    
    // Handle 401 Unauthorized specifically - this is a server config issue
    if (httpStatus === 401) {
      console.error('[pawaPay] [provider-init] 401 Unauthorized - token invalid or expired:', {
        depositId,
        http_status: httpStatus,
      });
      return {
        success: false,
        provider_key: 'pawapay',
        reference: params.reference || depositId,
        provider_deposit_id: depositId,
        status: 'rejected',
        error: 'Payment provider authentication failed',
        raw_request: request,
        errorDetails: {
          provider: 'pawapay',
          provider_http_status: 401,
          provider_error_code: 'PROVIDER_AUTH_FAILED',
          provider_message: 'Authentication failed. Check API token.',
          provider_request_id: depositId,
          is_rejection: false, // server misconfig, NOT user error
          is_auth_error: true, // special flag for 401
        },
      };
    }
    
    let data: PawaPayDepositResponse;
    
    try {
      data = await response.json();
    } catch (parseError) {
      // Response not JSON - likely server error
      console.error('[pawaPay] [provider-init] Non-JSON response:', {
        depositId,
        http_status: httpStatus,
        error: 'Response not valid JSON',
      });
      return {
        success: false,
        provider_key: 'pawapay',
        reference: params.reference || depositId,
        provider_deposit_id: depositId,
        status: 'rejected',
        error: 'Payment service returned invalid response',
        raw_request: request,
        errorDetails: {
          provider: 'pawapay',
          provider_http_status: httpStatus,
          provider_error_code: 'INVALID_RESPONSE',
          provider_message: 'Non-JSON response from provider',
          provider_request_id: depositId,
          is_rejection: false, // server error, not rejection
        },
      };
    }
    
    // SAFE LOGGING: structured provider response
    console.log('[pawaPay] [provider-init] Deposit response:', {
      depositId: data.depositId,
      status: data.status,
      http_status: httpStatus,
      rejection_code: data.rejectionReason?.rejectionCode,
    });

    if (data.status === 'ACCEPTED') {
      return {
        success: true,
        provider_key: 'pawapay',
        reference: params.reference || depositId,
        provider_deposit_id: depositId,
        status: 'pending',
        message: 'Payment request sent to customer phone',
        raw_request: request,
        raw_response: data,
      };
    }

    if (data.status === 'DUPLICATE_IGNORED') {
      // Idempotent - already exists
      return {
        success: true,
        provider_key: 'pawapay',
        reference: params.reference || depositId,
        provider_deposit_id: depositId,
        status: 'pending',
        message: 'Payment request already exists',
        raw_request: request,
        raw_response: data,
      };
    }

    // REJECTED - provider rejected the request (4xx-type)
    const rejectionCode = data.rejectionReason?.rejectionCode || 'UNKNOWN';
    const rejectionMessage = data.rejectionReason?.rejectionMessage || 'Payment rejected by provider';
    
    console.warn('[pawaPay] [provider-init] Deposit REJECTED:', {
      depositId,
      rejection_code: rejectionCode,
      rejection_message: rejectionMessage,
      http_status: httpStatus,
    });
    
    return {
      success: false,
      provider_key: 'pawapay',
      reference: params.reference || depositId,
      provider_deposit_id: depositId,
      status: 'rejected',
      error: rejectionMessage,
      raw_request: request,
      raw_response: data,
      errorDetails: {
        provider: 'pawapay',
        provider_http_status: httpStatus,
        provider_error_code: rejectionCode,
        provider_message: rejectionMessage,
        provider_request_id: depositId,
        is_rejection: true, // provider rejected, not server error
      },
    };

  } catch (error: any) {
    // Network/timeout error - server exception, NOT provider rejection
    console.error('[pawaPay] [provider-init] API exception:', {
      depositId,
      error_name: error.name,
      error_message: error.message?.slice(0, 100), // truncate for safety
    });
    return {
      success: false,
      provider_key: 'pawapay',
      reference: params.reference || depositId,
      provider_deposit_id: depositId,
      status: 'rejected',
      error: 'Payment service unavailable',
      raw_request: request,
      errorDetails: {
        provider: 'pawapay',
        provider_error_code: error.name || 'NETWORK_ERROR',
        provider_message: error.message?.slice(0, 100),
        provider_request_id: depositId,
        is_rejection: false, // server/network error, not provider rejection
      },
    };
  }
}

/**
 * Verify deposit status with pawaPay API
 */
export async function verifyDeposit(
  config: PawaPayConfig,
  depositId: string
): Promise<VerifyPaymentResult> {
  console.log('[pawaPay] Verifying deposit:', depositId);

  try {
    const response = await fetch(`${config.apiBase}/deposits/${depositId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      return {
        success: false,
        status: 'pending',
        error: 'Deposit not found',
      };
    }

    const data = await response.json();
    
    console.log('[pawaPay] Verify response:', {
      depositId: data.depositId,
      status: data.status,
    });

    if (data.status === 'COMPLETED') {
      return {
        success: true,
        status: 'succeeded',
        provider_transaction_id: data.correspondentIds?.operatorId || depositId,
        paid_at: data.respondedByPayer || new Date().toISOString(),
      };
    }

    if (data.status === 'FAILED') {
      return {
        success: true,
        status: 'failed',
        error: data.failureReason?.failureMessage || 'Payment failed',
      };
    }

    // ACCEPTED or SUBMITTED = still pending
    return {
      success: true,
      status: 'pending',
    };

  } catch (error: any) {
    console.error('[pawaPay] Verify error:', error.message);
    return {
      success: false,
      status: 'pending',
      error: error.message,
    };
  }
}

/**
 * Process a callback from pawaPay
 */
export function processCallback(payload: PawaPayCallbackPayload): CallbackResult {
  console.log('[pawaPay] Processing callback:', {
    depositId: payload.depositId,
    status: payload.status,
  });

  if (payload.status === 'COMPLETED') {
    return {
      success: true,
      order_id: undefined, // Needs to be looked up
      status: 'succeeded',
    };
  }

  if (payload.status === 'FAILED') {
    return {
      success: true,
      status: 'failed',
      error: payload.failureReason?.failureMessage || 'Payment failed',
    };
  }

  return {
    success: false,
    status: 'pending',
    error: 'Unknown callback status: ' + payload.status,
  };
}

/**
 * Predict the correspondent for a phone number using pawaPay API
 */
export async function predictCorrespondent(
  config: PawaPayConfig,
  phoneNumber: string
): Promise<string | null> {
  const phoneE164 = formatPhoneE164(phoneNumber);
  
  try {
    const response = await fetch(`${config.apiBase}/v1/predict-correspondent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: 'COD',
        phoneNumber: phoneE164,
      }),
    });

    if (!response.ok) {
      console.warn('[pawaPay] Predict correspondent failed:', response.status);
      return null;
    }

    const data = await response.json();
    return data.correspondent || null;

  } catch (error: any) {
    console.warn('[pawaPay] Predict correspondent error:', error.message);
    return null;
  }
}
