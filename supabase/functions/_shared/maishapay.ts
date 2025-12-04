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
  
  // Build the callback URL using the Supabase project URL
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const defaultCallbackUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/maishapay-callback` : '';
  const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || defaultCallbackUrl;
  
  // Frontend redirect URLs
  const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop.lovable.app';
  const frontendSuccessUrl = Deno.env.get('MAISHAPAY_FRONTEND_SUCCESS_URL') || `${frontendBaseUrl}/payment/success`;
  const frontendFailUrl = Deno.env.get('MAISHAPAY_FRONTEND_FAIL_URL') || `${frontendBaseUrl}/payment/fail`;
  
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
 * Makes a POST request to MaishaPay API and returns the checkout URL from response
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
    apiBaseUrl: config.apiBaseUrl,
    callbackUrl: config.callbackUrl,
  });
  
  try {
    // Build form data for MaishaPay POST request
    const formData = new URLSearchParams();
    formData.set('publicApiKey', config.publicKey);
    formData.set('secretApiKey', config.secretKey);
    formData.set('gatewayMode', config.mode === 'live' ? '1' : '0');
    formData.set('montant', params.amountUsd.toString());
    formData.set('devise', params.currency || 'USD');
    formData.set('callbackUrl', config.callbackUrl);
    formData.set('reference', reference);
    formData.set('email_client', params.customerEmail);
    
    if (params.customerName) {
      formData.set('nom_client', params.customerName);
    }
    if (params.customerPhone) {
      formData.set('telephone_client', params.customerPhone);
    }
    if (params.description) {
      formData.set('description', params.description);
    }
    
    const apiUrl = `${config.apiBaseUrl}/payment/vers1.0/merchant/checkout`;
    
    console.log('[MaishaPay] Making POST request to:', apiUrl);
    console.log('[MaishaPay] Request params:', {
      reference,
      amount: params.amountUsd,
      currency: params.currency || 'USD',
      callbackUrl: config.callbackUrl,
      email: params.customerEmail,
    });
    
    // Make POST request to MaishaPay API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('[MaishaPay] Raw response status:', response.status);
    console.log('[MaishaPay] Raw response body:', responseText.substring(0, 500));
    
    // Try to parse as JSON
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      // If response is not JSON, it might be a redirect URL or HTML
      // Check if it's a URL
      if (responseText.startsWith('http')) {
        return {
          success: true,
          checkoutUrl: responseText.trim(),
          reference,
          transactionId: reference,
        };
      }
      
      // If we get HTML or other response, build the checkout URL manually
      // MaishaPay might expect the checkout to be done via form submission
      console.log('[MaishaPay] Non-JSON response, building checkout URL manually');
      
      // Build a GET URL with all params for WebView
      const queryParams = new URLSearchParams();
      queryParams.set('publicApiKey', config.publicKey);
      queryParams.set('secretApiKey', config.secretKey);
      queryParams.set('gatewayMode', config.mode === 'live' ? '1' : '0');
      queryParams.set('montant', params.amountUsd.toString());
      queryParams.set('devise', params.currency || 'USD');
      queryParams.set('callbackUrl', config.callbackUrl);
      queryParams.set('reference', reference);
      queryParams.set('email_client', params.customerEmail);
      
      if (params.customerName) {
        queryParams.set('nom_client', params.customerName);
      }
      if (params.customerPhone) {
        queryParams.set('telephone_client', params.customerPhone);
      }
      if (params.description) {
        queryParams.set('description', params.description);
      }
      
      const checkoutUrl = `${apiUrl}?${queryParams.toString()}`;
      
      return {
        success: true,
        checkoutUrl,
        reference,
        transactionId: reference,
      };
    }
    
    console.log('[MaishaPay] Parsed response:', JSON.stringify(data));
    
    // MaishaPay response typically contains a redirect/checkout URL
    // Check common field names
    const checkoutUrl = data.redirect_url || data.payment_url || data.checkoutUrl || 
                        data.url || data.redirectUrl || data.link || data.checkout_url;
    
    if (checkoutUrl) {
      console.log('[MaishaPay] Got checkout URL:', checkoutUrl);
      return {
        success: true,
        checkoutUrl,
        reference,
        transactionId: data.transactionId || data.transaction_id || reference,
      };
    }
    
    // If no URL in response but request was successful, build checkout URL manually
    if (data.success || data.status === 'success' || response.ok) {
      console.log('[MaishaPay] Success response but no URL, building checkout URL manually');
      
      const queryParams = new URLSearchParams();
      queryParams.set('publicApiKey', config.publicKey);
      queryParams.set('secretApiKey', config.secretKey);
      queryParams.set('gatewayMode', config.mode === 'live' ? '1' : '0');
      queryParams.set('montant', params.amountUsd.toString());
      queryParams.set('devise', params.currency || 'USD');
      queryParams.set('callbackUrl', config.callbackUrl);
      queryParams.set('reference', reference);
      queryParams.set('email_client', params.customerEmail);
      
      if (params.customerName) {
        queryParams.set('nom_client', params.customerName);
      }
      if (params.customerPhone) {
        queryParams.set('telephone_client', params.customerPhone);
      }
      if (params.description) {
        queryParams.set('description', params.description);
      }
      
      const fallbackUrl = `${apiUrl}?${queryParams.toString()}`;
      
      return {
        success: true,
        checkoutUrl: fallbackUrl,
        reference,
        transactionId: data.transactionId || data.transaction_id || reference,
      };
    }
    
    // Handle error response
    const errorMsg = data.message || data.error || data.description || 'Payment initiation failed';
    console.error('[MaishaPay] API error:', errorMsg);
    return { success: false, checkoutUrl: '', reference, error: errorMsg };
    
  } catch (error: any) {
    console.error('[MaishaPay] Request error:', error.message);
    return { success: false, checkoutUrl: '', reference, error: error.message };
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
