/**
 * MaishaPay Client Helper
 * Supports both sandbox and live modes based on MAISHAPAY_MODE env var
 */

export interface MaishaPayConfig {
  publicKey: string;
  secretKey: string;
  mode: 'sandbox' | 'live';
  callbackUrl: string;
  apiBaseUrl: string;
}

export interface CreatePaymentParams {
  amountUsd: number;
  currency?: string;
  customerPhone?: string;
  customerEmail: string;
  customerName?: string;
  description?: string;
  orderId: string;
}

export interface CreatePaymentResult {
  success: boolean;
  checkoutUrl: string;
  reference: string;
  transactionId?: string;
  error?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: 'paid' | 'pending' | 'failed' | 'cancelled';
  transactionId?: string;
  operatorRefId?: string;
  paidAt?: string;
  error?: string;
}

/**
 * Get MaishaPay configuration from environment variables
 */
export function getMaishaPayConfig(): MaishaPayConfig {
  const mode = Deno.env.get('MAISHAPAY_MODE');
  const isSandbox = mode !== '1' && mode?.toLowerCase() !== 'live';
  
  let publicKey: string;
  let secretKey: string;
  let apiBaseUrl: string;
  
  if (isSandbox) {
    // Sandbox mode
    publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || Deno.env.get('MAISHA_PUBLIC_KEY') || '';
    secretKey = Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || Deno.env.get('MAISHA_SECRET_KEY') || '';
    apiBaseUrl = Deno.env.get('MAISHAPAY_SANDBOX_API_URL') || 'https://sandbox.maishapay.net';
  } else {
    // Live mode
    publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || '';
    secretKey = Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || '';
    apiBaseUrl = 'https://marchand.maishapay.online';
  }
  
  const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || '';
  
  return {
    publicKey,
    secretKey,
    mode: isSandbox ? 'sandbox' : 'live',
    callbackUrl,
    apiBaseUrl,
  };
}

/**
 * Validate that MaishaPay is properly configured
 */
export function validateConfig(config: MaishaPayConfig): { valid: boolean; error?: string } {
  if (!config.publicKey) {
    return { valid: false, error: `Missing ${config.mode === 'sandbox' ? 'MAISHAPAY_SANDBOX_PUBLIC_KEY' : 'MAISHAPAY_LIVE_PUBLIC_KEY'}` };
  }
  if (!config.secretKey) {
    return { valid: false, error: `Missing ${config.mode === 'sandbox' ? 'MAISHAPAY_SANDBOX_SECRET_KEY' : 'MAISHAPAY_LIVE_SECRET_KEY'}` };
  }
  if (!config.callbackUrl) {
    return { valid: false, error: 'Missing MAISHAPAY_CALLBACK_URL' };
  }
  return { valid: true };
}

/**
 * Generate a unique reference for the payment
 */
export function generatePaymentReference(orderId: string): string {
  return `AFRISHOP-${orderId}`;
}

/**
 * Create a payment session with MaishaPay
 */
export async function createPaymentSession(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const config = getMaishaPayConfig();
  const validation = validateConfig(config);
  
  if (!validation.valid) {
    console.error('[MaishaPay] Configuration error:', validation.error);
    return { success: false, checkoutUrl: '', reference: '', error: validation.error };
  }
  
  const reference = generatePaymentReference(params.orderId);
  
  console.log(`[MaishaPay] Creating ${config.mode} payment session:`, {
    orderId: params.orderId,
    reference,
    amountUsd: params.amountUsd,
    mode: config.mode,
  });
  
  // Build form data for MaishaPay checkout
  const form = new URLSearchParams();
  form.set('publicApiKey', config.publicKey);
  form.set('secretApiKey', config.secretKey);
  form.set('gatewayMode', config.mode === 'live' ? '1' : '0');
  form.set('montant', params.amountUsd.toString());
  form.set('devise', params.currency || 'USD');
  form.set('callbackUrl', config.callbackUrl);
  form.set('reference', reference);
  form.set('email_client', params.customerEmail);
  
  if (params.customerName) {
    form.set('nom_client', params.customerName);
  }
  if (params.customerPhone) {
    form.set('telephone_client', params.customerPhone);
  }
  if (params.description) {
    form.set('description', params.description);
  }
  
  // The checkout URL
  const checkoutUrl = `${config.apiBaseUrl}/payment/vers1.0/merchant/checkout`;
  
  // For MaishaPay, we return the checkout URL and fields
  // The frontend/mobile app will redirect or POST to this URL
  return {
    success: true,
    checkoutUrl,
    reference,
    transactionId: reference, // MaishaPay uses reference as transaction ID initially
  };
}

/**
 * Verify payment status with MaishaPay API
 */
export async function verifyPaymentStatus(transactionId: string): Promise<VerifyPaymentResult> {
  const config = getMaishaPayConfig();
  const validation = validateConfig(config);
  
  if (!validation.valid) {
    return { success: false, status: 'failed', error: validation.error };
  }
  
  console.log(`[MaishaPay] Verifying payment status for: ${transactionId}`);
  
  try {
    // MaishaPay verification endpoint
    const verifyUrl = `${config.apiBaseUrl}/payment/vers1.0/merchant/verify`;
    
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        publicApiKey: config.publicKey,
        secretApiKey: config.secretKey,
        transactionRefId: transactionId,
      }).toString(),
    });
    
    if (!response.ok) {
      console.error('[MaishaPay] Verify API error:', response.status);
      return { success: false, status: 'pending', error: `API returned ${response.status}` };
    }
    
    const data = await response.json();
    console.log('[MaishaPay] Verify response:', data);
    
    // Parse MaishaPay response
    const status = normalizePaymentStatus(data.status || data.transactionStatus);
    
    return {
      success: true,
      status,
      transactionId: data.transactionRefId || transactionId,
      operatorRefId: data.operatorRefId,
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
    };
  } catch (error: any) {
    console.error('[MaishaPay] Verify error:', error);
    return { success: false, status: 'pending', error: error.message };
  }
}

/**
 * Normalize payment status from MaishaPay response
 */
export function normalizePaymentStatus(status: string): 'paid' | 'pending' | 'failed' | 'cancelled' {
  if (!status) return 'pending';
  
  const normalized = status.toLowerCase();
  
  if (normalized === 'success' || normalized === 'paid' || normalized === '1' || normalized.includes('success')) {
    return 'paid';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled';
  }
  if (normalized === 'failed' || normalized === 'error' || normalized === 'rejected') {
    return 'failed';
  }
  
  return 'pending';
}

/**
 * Get checkout form fields for client-side form submission
 */
export function getCheckoutFormFields(params: CreatePaymentParams): Record<string, string> {
  const config = getMaishaPayConfig();
  const reference = generatePaymentReference(params.orderId);
  
  return {
    publicApiKey: config.publicKey,
    secretApiKey: config.secretKey,
    gatewayMode: config.mode === 'live' ? '1' : '0',
    montant: params.amountUsd.toString(),
    devise: params.currency || 'USD',
    callbackUrl: config.callbackUrl,
    reference,
    email_client: params.customerEmail,
    nom_client: params.customerName || '',
    telephone_client: params.customerPhone || '',
  };
}

/**
 * Get the current MaishaPay mode (sandbox/live)
 */
export function getPaymentMode(): 'sandbox' | 'live' {
  const config = getMaishaPayConfig();
  return config.mode;
}
