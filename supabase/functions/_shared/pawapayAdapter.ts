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
 * Create a deposit (payment request) with pawaPay
 */
export async function createDeposit(
  config: PawaPayConfig,
  params: CreatePaymentParams
): Promise<CreatePaymentResult> {
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

  console.log('[pawaPay] Creating deposit:', {
    depositId,
    amount: request.amount,
    currency: request.currency,
    correspondent,
    phone: phoneE164.slice(0, 6) + '****',
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

    const data: PawaPayDepositResponse = await response.json();
    
    console.log('[pawaPay] Deposit response:', {
      depositId: data.depositId,
      status: data.status,
      httpStatus: response.status,
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

    // REJECTED
    return {
      success: false,
      provider_key: 'pawapay',
      reference: params.reference || depositId,
      provider_deposit_id: depositId,
      status: 'rejected',
      error: data.rejectionReason?.rejectionMessage || 'Payment rejected',
      raw_request: request,
      raw_response: data,
    };

  } catch (error: any) {
    console.error('[pawaPay] API error:', error.message);
    return {
      success: false,
      provider_key: 'pawapay',
      reference: params.reference || depositId,
      status: 'rejected',
      error: error.message,
      raw_request: request,
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
