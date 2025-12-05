/**
 * MaishaPay Client Helper
 * Supports both sandbox and live modes based on MAISHAPAY_GATEWAY_MODE env var
 * 
 * IMPORTANT: MaishaPay Checkout works via HTML form POST submission.
 * There is no REST API to "create a checkout session" - users must be redirected
 * to a page that submits a form to MaishaPay.
 */

export interface MaishaPayConfig {
  publicKey: string;
  secretKey: string;
  mode: 'sandbox' | 'live';
  callbackUrl: string;
  cancelUrl: string;
  checkoutUrl: string;
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
 * 
 * Primary env vars:
 * - MAISHAPAY_PUBLIC_API_KEY: MaishaPay public key
 * - MAISHAPAY_SECRET_API_KEY: MaishaPay secret key
 * - MAISHAPAY_GATEWAY_MODE: "1" for live, "0" for sandbox
 * - MAISHAPAY_CALLBACK_URL: Backend callback URL for payment notifications
 */
export function getMaishaPayConfig(): MaishaPayConfig {
  // Check mode
  const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
  const legacyMode = Deno.env.get('MAISHAPAY_MODE');
  
  // MAISHAPAY_GATEWAY_MODE: "1" = live, "0" = sandbox
  const isLiveMode = gatewayMode === '1' || 
                     legacyMode === '1' || 
                     legacyMode?.toLowerCase() === 'live';
  
  console.log('[MaishaPay] Mode detection:', { gatewayMode, legacyMode, isLiveMode });
  
  // Get API keys - check multiple possible env var names
  const publicKey = Deno.env.get('MAISHAPAY_PUBLIC_API_KEY') || 
                    Deno.env.get('MAISHAPAY_PUBLIC_KEY') ||
                    Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || 
                    Deno.env.get('MAISHA_PUBLIC_KEY') || '';
  
  const secretKey = Deno.env.get('MAISHAPAY_SECRET_API_KEY') || 
                    Deno.env.get('MAISHAPAY_SECRET_KEY') ||
                    Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || 
                    Deno.env.get('MAISHA_SECRET_KEY') || '';
  
  // Build the callback URL using the Supabase project URL
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const defaultCallbackUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/maisha-callback` : '';
  const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || 
                      Deno.env.get('MAISHA_CALLBACK_URL') || 
                      defaultCallbackUrl;
  
  // Cancel URL
  const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop.lovable.app';
  const cancelUrl = `${frontendBaseUrl}/payment/cancelled`;
  
  // MaishaPay checkout URL based on mode
  const checkoutUrl = isLiveMode 
    ? 'https://maishapay.com/payment/vers1.0/merchant/checkout'
    : 'http://maishapay.test/payment/vers1.0/merchant/checkout';
  
  console.log('[MaishaPay Config]', {
    mode: isLiveMode ? 'live' : 'sandbox',
    hasPublicKey: !!publicKey,
    hasSecretKey: !!secretKey,
    publicKeyPrefix: publicKey ? publicKey.slice(0, 10) + '...' : 'MISSING',
    callbackUrl,
    checkoutUrl,
  });
  
  return {
    publicKey,
    secretKey,
    mode: isLiveMode ? 'live' : 'sandbox',
    callbackUrl,
    cancelUrl,
    checkoutUrl,
  };
}

/**
 * Validate that MaishaPay is properly configured
 */
export function validateConfig(config: MaishaPayConfig): { valid: boolean; error?: string; code?: string } {
  if (!config.publicKey) {
    return { 
      valid: false, 
      code: 'MAISHAPAY_CONFIG_ERROR',
      error: 'Missing MaishaPay API keys. Set MAISHAPAY_PUBLIC_API_KEY.' 
    };
  }
  if (!config.secretKey) {
    return { 
      valid: false, 
      code: 'MAISHAPAY_CONFIG_ERROR',
      error: 'Missing MaishaPay API keys. Set MAISHAPAY_SECRET_API_KEY.' 
    };
  }
  if (!config.callbackUrl) {
    return { 
      valid: false, 
      code: 'MAISHAPAY_CONFIG_ERROR',
      error: 'Missing MAISHAPAY_CALLBACK_URL.' 
    };
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
 * Generate HTML checkout page with auto-submitting form to MaishaPay
 */
export function generateCheckoutHtml(params: {
  amount: number;
  currency: string;
  orderId: string;
  orderNumber: string;
}): { html: string; error?: string } {
  const config = getMaishaPayConfig();
  const validation = validateConfig(config);
  
  if (!validation.valid) {
    console.error('[MaishaPay] Config validation failed:', validation.error);
    return { html: '', error: validation.error };
  }

  const { amount, currency, orderId, orderNumber } = params;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paiement MaishaPay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px 30px;
      text-align: center;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      width: 80px;
      height: 80px;
      margin: 0 auto 20px;
      background: #0066cc;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo svg {
      width: 40px;
      height: 40px;
      fill: white;
    }
    h1 {
      color: #1a1a2e;
      font-size: 22px;
      margin-bottom: 10px;
    }
    .amount {
      font-size: 32px;
      font-weight: bold;
      color: #0066cc;
      margin: 20px 0;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid #e0e0e0;
      border-top-color: #0066cc;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    p {
      color: #666;
      font-size: 14px;
      line-height: 1.5;
    }
    .order-ref {
      background: #f5f5f5;
      padding: 8px 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      color: #888;
      margin-top: 20px;
    }
    noscript .btn {
      background: #0066cc;
      color: white;
      border: none;
      padding: 16px 32px;
      font-size: 18px;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 20px;
      display: inline-block;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
    </div>
    <h1>Paiement en cours</h1>
    <div class="amount">${amount.toFixed(2)} ${currency}</div>
    <div class="spinner"></div>
    <p>Redirection vers MaishaPay...<br>Veuillez patienter.</p>
    <div class="order-ref">Ref: ${orderNumber}</div>
    
    <form id="paymentForm" method="POST" action="${config.checkoutUrl}">
      <input type="hidden" name="publicApiKey" value="${config.publicKey}">
      <input type="hidden" name="secretApiKey" value="${config.secretKey}">
      <input type="hidden" name="amount" value="${amount}">
      <input type="hidden" name="orderNumber" value="${orderNumber}">
      <input type="hidden" name="callbackUrl" value="${config.callbackUrl}">
      <input type="hidden" name="cancelUrl" value="${config.cancelUrl}">
      <input type="hidden" name="currency" value="${currency}">
      <input type="hidden" name="reference" value="${orderId}">
      <noscript>
        <button type="submit" class="btn">Continuer vers MaishaPay</button>
      </noscript>
    </form>
  </div>
  <script>
    document.getElementById('paymentForm').submit();
  </script>
</body>
</html>`;

  console.log('[MaishaPay] Generated HTML checkout, length:', html.length);
  console.log('[MaishaPay] Checkout URL:', config.checkoutUrl);
  console.log('[MaishaPay] Callback URL:', config.callbackUrl);
  console.log('[MaishaPay] Order:', orderNumber, 'Amount:', amount, currency);

  return { html };
}

/**
 * Normalize payment status from MaishaPay response
 */
export function normalizePaymentStatus(status: string | number): 'paid' | 'pending' | 'failed' | 'cancelled' {
  if (!status && status !== 0) return 'pending';
  
  const normalized = String(status).toLowerCase();
  
  // MaishaPay uses numeric status codes: 202 = success/accepted
  if (normalized === '202' || normalized === 'success' || normalized === 'paid' || normalized === 'accepted' || normalized === '1' || normalized.includes('success')) {
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
 * Get the current MaishaPay mode (sandbox/live)
 */
export function getPaymentMode(): 'sandbox' | 'live' {
  const config = getMaishaPayConfig();
  return config.mode;
}

/**
 * Create a payment session (for compatibility with existing code)
 */
export async function createPaymentSession(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const config = getMaishaPayConfig();
  const validation = validateConfig(config);
  
  if (!validation.valid) {
    return { success: false, checkoutUrl: '', reference: '', error: validation.error };
  }
  
  const reference = generatePaymentReference(params.orderId);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const checkoutUrl = `${supabaseUrl}/functions/v1/maishapay-checkout-page?order_id=${encodeURIComponent(params.orderId)}`;
  
  return {
    success: true,
    checkoutUrl,
    reference,
    transactionId: reference,
  };
}

/**
 * Verify payment status with MaishaPay API
 */
export async function verifyPaymentStatus(transactionId: string): Promise<VerifyPaymentResult> {
  const config = getMaishaPayConfig();
  const validation = validateConfig(config);
  
  if (!validation.valid) {
    return { success: false, status: 'pending', error: validation.error };
  }
  
  console.log(`[MaishaPay] Verifying payment status for: ${transactionId}`);
  
  // For now, return pending - actual verification would call MaishaPay API
  // The callback is the primary mechanism for status updates
  return {
    success: true,
    status: 'pending',
    transactionId,
  };
}
