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
  frontendSuccessUrl: string;
  frontendFailUrl: string;
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
    // Sandbox mode - check multiple possible env var names
    publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || 
                Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                Deno.env.get('MAISHA_PUBLIC_KEY') || '';
    secretKey = Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || 
                Deno.env.get('MAISHAPAY_SECRET_KEY') || 
                Deno.env.get('MAISHA_SECRET_KEY') || '';
    apiBaseUrl = Deno.env.get('MAISHAPAY_SANDBOX_API_URL') || 
                 Deno.env.get('MAISHAPAY_BASE_URL') || 
                 'https://sandbox.maishapay.net';
  } else {
    // Live mode
    publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || 
                Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
    secretKey = Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || 
                Deno.env.get('MAISHAPAY_SECRET_KEY') || '';
    apiBaseUrl = Deno.env.get('MAISHAPAY_BASE_URL') || 'https://marchand.maishapay.online';
  }
  
  // Build the callback URL using the Supabase project URL
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const defaultCallbackUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/maishapay-callback` : '';
  const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || defaultCallbackUrl;
  
  // Frontend redirect URLs
  const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop.lovable.app';
  const frontendSuccessUrl = Deno.env.get('MAISHAPAY_FRONTEND_SUCCESS_URL') || `${frontendBaseUrl}/payment/success`;
  const frontendFailUrl = Deno.env.get('MAISHAPAY_FRONTEND_FAIL_URL') || `${frontendBaseUrl}/payment/fail`;
  
  console.log('[MaishaPay Config]', {
    mode: isSandbox ? 'sandbox' : 'live',
    hasPublicKey: !!publicKey,
    hasSecretKey: !!secretKey,
    apiBaseUrl,
    callbackUrl,
    frontendSuccessUrl,
    frontendFailUrl,
  });
  
  return {
    publicKey,
    secretKey,
    mode: isSandbox ? 'sandbox' : 'live',
    callbackUrl,
    apiBaseUrl,
    frontendSuccessUrl,
    frontendFailUrl,
  };
}

/**
 * Validate that MaishaPay is properly configured
 */
export function validateConfig(config: MaishaPayConfig): { valid: boolean; error?: string } {
  if (!config.publicKey) {
    const error = `[CONFIG ERROR] Missing MaishaPay public key. Set MAISHAPAY_PUBLIC_KEY or MAISHAPAY_${config.mode.toUpperCase()}_PUBLIC_KEY`;
    console.error(error);
    return { valid: false, error };
  }
  if (!config.secretKey) {
    const error = `[CONFIG ERROR] Missing MaishaPay secret key. Set MAISHAPAY_SECRET_KEY or MAISHAPAY_${config.mode.toUpperCase()}_SECRET_KEY`;
    console.error(error);
    return { valid: false, error };
  }
  if (!config.callbackUrl) {
    const error = '[CONFIG ERROR] Missing MAISHAPAY_CALLBACK_URL and could not build default from SUPABASE_URL';
    console.error(error);
    return { valid: false, error };
  }
  return { valid: true };
}

/**
 * Generate a unique reference for the payment
 */
export function generatePaymentReference(orderId: string): string {
  const timestamp = Date.now().toString(36);
  return `AFRISHOP-${orderId.slice(0, 8)}-${timestamp}`;
}

/**
 * Create a payment session with MaishaPay
 * Builds a checkout URL that can be opened in a WebView
 * MaishaPay's checkout endpoint accepts GET parameters
 */
export async function createPaymentSession(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const config = getMaishaPayConfig();
  const validation = validateConfig(config);
  
  if (!validation.valid) {
    return { success: false, checkoutUrl: '', reference: '', error: validation.error };
  }
  
  const reference = generatePaymentReference(params.orderId);
  
  console.log(`[MaishaPay] Creating ${config.mode} payment session:`, {
    orderId: params.orderId,
    reference,
    amountUsd: params.amountUsd,
    currency: params.currency || 'USD',
    callbackUrl: config.callbackUrl,
    email: params.customerEmail,
  });
  
  try {
    // Build checkout URL with all parameters
    // MaishaPay checkout accepts parameters via GET query string
    const checkoutBaseUrl = `${config.apiBaseUrl}/payment/vers1.0/merchant/checkout`;
    
    const queryParams = new URLSearchParams();
    queryParams.set('publicApiKey', config.publicKey);
    queryParams.set('secretApiKey', config.secretKey);
    queryParams.set('gatewayMode', config.mode === 'live' ? '1' : '0');
    queryParams.set('montant', params.amountUsd.toFixed(2));
    queryParams.set('devise', params.currency || 'USD');
    queryParams.set('callbackUrl', config.callbackUrl);
    queryParams.set('reference', reference);
    queryParams.set('email_client', params.customerEmail);
    
    // Add success/fail redirect URLs
    queryParams.set('success_url', config.frontendSuccessUrl);
    queryParams.set('fail_url', config.frontendFailUrl);
    
    if (params.customerName) {
      queryParams.set('nom_client', params.customerName);
    }
    if (params.customerPhone) {
      queryParams.set('telephone_client', params.customerPhone);
    }
    if (params.description) {
      queryParams.set('description', params.description);
    }
    
    const checkoutUrl = `${checkoutBaseUrl}?${queryParams.toString()}`;
    
    console.log('[MaishaPay] Built checkout URL successfully');
    console.log('[MaishaPay] Checkout URL length:', checkoutUrl.length);
    
    // Optionally verify the URL is accessible (but don't fail if MaishaPay is slow)
    try {
      const testResponse = await fetch(checkoutUrl, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      console.log('[MaishaPay] URL accessibility check:', testResponse.status);
    } catch (testError: any) {
      console.warn('[MaishaPay] URL accessibility check failed (non-blocking):', testError.message);
    }
    
    return {
      success: true,
      checkoutUrl,
      reference,
      transactionId: reference,
    };
    
  } catch (error: any) {
    const errorMsg = `Payment URL creation failed: ${error.message}`;
    console.error('[MaishaPay] Error:', errorMsg);
    return { success: false, checkoutUrl: '', reference, error: errorMsg };
  }
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
    
    const formData = new URLSearchParams({
      publicApiKey: config.publicKey,
      secretApiKey: config.secretKey,
      transactionRefId: transactionId,
    });
    
    console.log('[MaishaPay] Calling verify endpoint:', verifyUrl);
    
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('[MaishaPay] Verify response status:', response.status);
    console.log('[MaishaPay] Verify response body:', responseText.substring(0, 500));
    
    if (!response.ok) {
      return { 
        success: false, 
        status: 'pending', 
        error: `MaishaPay API returned ${response.status}: ${responseText.substring(0, 200)}` 
      };
    }
    
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return { 
        success: false, 
        status: 'pending', 
        error: 'MaishaPay returned non-JSON response during verification' 
      };
    }
    
    console.log('[MaishaPay] Verify parsed response:', JSON.stringify(data));
    
    // Parse MaishaPay response
    const status = normalizePaymentStatus(data.status || data.transactionStatus || data.code);
    
    return {
      success: true,
      status,
      transactionId: data.transactionRefId || data.reference || transactionId,
      operatorRefId: data.operatorRefId || data.operator_ref,
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
    };
  } catch (error: any) {
    console.error('[MaishaPay] Verify error:', error.message);
    return { success: false, status: 'pending', error: error.message };
  }
}

/**
 * Normalize payment status from MaishaPay response
 */
export function normalizePaymentStatus(status: string | number): 'paid' | 'pending' | 'failed' | 'cancelled' {
  if (!status && status !== 0) return 'pending';
  
  const normalized = String(status).toLowerCase();
  
  // MaishaPay uses numeric status codes: 202 = success
  if (normalized === '202' || normalized === 'success' || normalized === 'paid' || normalized === '1' || normalized.includes('success')) {
    return 'paid';
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === '203') {
    return 'cancelled';
  }
  if (normalized === 'failed' || normalized === 'error' || normalized === 'rejected' || normalized === '204' || normalized === '400' || normalized === '500') {
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
    montant: params.amountUsd.toFixed(2),
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
