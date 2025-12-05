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
  
  // MaishaPay checkout URL - ALWAYS use HTTPS for iOS WebView compatibility (ATS)
  // Live endpoint: https://marchand.maishapay.online
  // Note: Sandbox HTTP endpoint is blocked by iOS ATS, so we use live HTTPS for both
  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';
  
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
 * 
 * IMPORTANT: Uses HTTPS endpoint for iOS WebView (ATS) compatibility
 * Shows visible content so user doesn't see white screen if redirect fails
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

  // Generate simple, visible HTML that auto-submits form
  // Uses body onload for maximum compatibility with WebViews
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Paiement MaishaPay</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      text-align: center;
      padding: 40px 20px;
      background: #f5f7fa;
      color: #333;
      margin: 0;
    }
    .container {
      max-width: 400px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      padding: 30px 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e0e0e0;
      border-top-color: #0066cc;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .msg {
      color: #333;
      font-size: 16px;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .amount {
      font-size: 24px;
      font-weight: bold;
      color: #0066cc;
      margin: 16px 0;
    }
    .ref {
      font-size: 12px;
      color: #888;
      font-family: monospace;
      margin-top: 16px;
    }
    .retry-info {
      font-size: 13px;
      color: #666;
      margin-top: 20px;
    }
    .btn {
      background: #0066cc;
      color: white;
      border: none;
      padding: 14px 28px;
      font-size: 16px;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 16px;
    }
    .btn:hover {
      background: #0052a3;
    }
  </style>
</head>
<body onload="document.forms[0].submit()">
  <div class="container">
    <div class="spinner"></div>
    <div class="msg">
      Redirection vers MaishaPay...<br/>
      Si rien ne se passe après quelques secondes, veuillez réessayer.
    </div>
    <div class="amount">${amount.toFixed(2)} ${currency}</div>
    <div class="ref">Ref: ${orderNumber}</div>
    
    <form method="POST" action="${config.checkoutUrl}">
      <input type="hidden" name="gatewayMode" value="${config.mode === 'live' ? '1' : '0'}" />
      <input type="hidden" name="publicApiKey" value="${config.publicKey}" />
      <input type="hidden" name="secretApiKey" value="${config.secretKey}" />
      <input type="hidden" name="montant" value="${amount}" />
      <input type="hidden" name="devise" value="${currency}" />
      <input type="hidden" name="callbackUrl" value="${config.callbackUrl}" />
      <input type="hidden" name="reference" value="${orderId}" />
      <noscript>
        <div class="retry-info">JavaScript est désactivé. Veuillez cliquer le bouton ci-dessous.</div>
        <button type="submit" class="btn">Payer avec MaishaPay</button>
      </noscript>
    </form>
  </div>
</body>
</html>`;

  // Log for debugging
  console.log('[MaishaPay] === HTML Checkout Generated ===');
  console.log('[MaishaPay] Form action (HTTPS):', config.checkoutUrl);
  console.log('[MaishaPay] Callback URL:', config.callbackUrl);
  console.log('[MaishaPay] Order:', orderNumber, '| Amount:', amount, currency);
  console.log('[MaishaPay] HTML length:', html.length, 'bytes');
  console.log('[MaishaPay] Mode:', config.mode);

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
