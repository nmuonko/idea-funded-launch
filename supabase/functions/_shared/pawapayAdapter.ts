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
  getSecretValue,
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
 * Get pawaPay configuration from provider config
 */
export function getPawaPayConfig(provider: PaymentProvider): PawaPayConfig {
  const apiToken = getSecretValue(provider.secret_refs.api_token || 'PAWAPAY_API_TOKEN');
  const modeRaw = provider.config_public?.mode || 'sandbox';
  const mode: 'sandbox' | 'live' = modeRaw === 'live' ? 'live' : 'sandbox';
  const apiBase = mode === 'live' 
    ? 'https://api.pawapay.io' 
    : (provider.config_public.api_base || 'https://api.sandbox.pawapay.io');

  if (!apiToken) {
    throw new Error('PAWAPAY_API_TOKEN not configured');
  }

  return {
    apiToken,
    apiBase,
    mode,
  };
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
    statementDescription: params.description || `AfriShop ${params.reference || params.orderId}`,
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
