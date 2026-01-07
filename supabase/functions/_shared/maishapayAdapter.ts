/**
 * MaishaPay Payment Adapter
 * 
 * Wraps existing MaishaPay logic into the provider interface.
 * MaishaPay uses HTML form POST for checkout (not REST API).
 */

import { 
  CreatePaymentParams, 
  CreatePaymentResult, 
  VerifyPaymentResult,
  PaymentProvider,
  getSecretValue,
} from "./paymentProviders.ts";

// ==================== Types ====================

export interface MaishaPayConfig {
  publicKey: string;
  secretKey: string;
  mode: 'sandbox' | 'live';
  callbackUrl: string;
  checkoutUrl: string;
}

// ==================== Config ====================

/**
 * Get MaishaPay configuration from provider config + secrets
 */
export function getMaishaPayConfigFromProvider(provider: PaymentProvider): MaishaPayConfig {
  const publicKey = getSecretValue(provider.secret_refs.public_key || 'MAISHAPAY_PUBLIC_API_KEY') || '';
  const secretKey = getSecretValue(provider.secret_refs.secret_key || 'MAISHAPAY_SECRET_API_KEY') || '';
  const mode = provider.config_public.mode === 'live' ? 'live' : 'sandbox';
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || 
                      `${supabaseUrl}/functions/v1/maisha-callback`;
  
  // Always use HTTPS endpoint for iOS WebView compatibility
  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';

  return {
    publicKey,
    secretKey,
    mode,
    callbackUrl,
    checkoutUrl,
  };
}

/**
 * Get MaishaPay configuration from environment variables (legacy)
 */
export function getMaishaPayConfig(): MaishaPayConfig {
  const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
  const legacyMode = Deno.env.get('MAISHAPAY_MODE');
  const isLiveMode = gatewayMode === '1' || legacyMode === '1' || legacyMode?.toLowerCase() === 'live';
  
  const publicKey = Deno.env.get('MAISHAPAY_PUBLIC_API_KEY') || 
                    Deno.env.get('MAISHAPAY_PUBLIC_KEY') ||
                    Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || '';
  
  const secretKey = Deno.env.get('MAISHAPAY_SECRET_API_KEY') || 
                    Deno.env.get('MAISHAPAY_SECRET_KEY') ||
                    Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || '';
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || 
                      Deno.env.get('MAISHA_CALLBACK_URL') || 
                      `${supabaseUrl}/functions/v1/maisha-callback`;
  
  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';

  return {
    publicKey,
    secretKey,
    mode: isLiveMode ? 'live' : 'sandbox',
    callbackUrl,
    checkoutUrl,
  };
}

// ==================== Validation ====================

/**
 * Validate MaishaPay configuration
 */
export function validateMaishaPayConfig(config: MaishaPayConfig): { valid: boolean; error?: string } {
  if (!config.publicKey) {
    return { valid: false, error: 'Missing MaishaPay public key' };
  }
  if (!config.secretKey) {
    return { valid: false, error: 'Missing MaishaPay secret key' };
  }
  if (!config.callbackUrl) {
    return { valid: false, error: 'Missing MaishaPay callback URL' };
  }
  return { valid: true };
}

// ==================== HTML Checkout ====================

/**
 * Generate HTML checkout page with auto-submitting form to MaishaPay
 */
export function generateCheckoutHtml(
  config: MaishaPayConfig,
  params: {
    amount: number;
    currency: string;
    orderId: string;
    orderNumber: string;
  }
): { html: string; error?: string } {
  const validation = validateMaishaPayConfig(config);
  if (!validation.valid) {
    return { html: '', error: validation.error };
  }

  const { amount, currency, orderId, orderNumber } = params;

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
        <div>JavaScript est désactivé. Veuillez cliquer le bouton ci-dessous.</div>
        <button type="submit" class="btn">Payer avec MaishaPay</button>
      </noscript>
    </form>
  </div>
</body>
</html>`;

  console.log('[MaishaPay Adapter] HTML checkout generated:', {
    orderId,
    amount,
    currency,
    mode: config.mode,
  });

  return { html };
}

// ==================== API Methods ====================

/**
 * Create a payment using MaishaPay REST API (alternative to HTML form)
 */
export async function createPayment(
  config: MaishaPayConfig,
  params: CreatePaymentParams
): Promise<CreatePaymentResult> {
  const reference = params.reference || `AFRISHOP-${params.orderId}-${Date.now()}`;
  
  const payload = {
    publicKey: config.publicKey,
    amount: params.amount,
    currency: params.currency,
    reference,
    customerEmail: params.customerEmail,
    customerPhone: params.customerPhone || '',
    description: params.description || `AfriShop order ${params.orderId}`,
    callbackUrl: config.callbackUrl,
  };

  const apiUrl = config.mode === 'live'
    ? 'https://marchand.maishapay.online/api/v1/transaction/create'
    : 'https://sandbox.maishapay.online/api/v1/transaction/create';

  console.log('[MaishaPay Adapter] Creating payment:', {
    amount: params.amount,
    currency: params.currency,
    reference,
    mode: config.mode,
  });

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.secretKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText };
    }

    if (!response.ok) {
      return {
        success: false,
        provider_key: 'maishapay',
        reference,
        status: 'rejected',
        error: data.message || data.error || rawText || 'MaishaPay request failed',
        raw_request: payload,
        raw_response: data,
      };
    }

    const checkoutUrl = data.checkoutUrl || data.paymentUrl || data.url;
    
    if (!checkoutUrl) {
      return {
        success: false,
        provider_key: 'maishapay',
        reference,
        status: 'rejected',
        error: 'No checkout URL in response',
        raw_request: payload,
        raw_response: data,
      };
    }

    return {
      success: true,
      provider_key: 'maishapay',
      reference,
      checkoutUrl,
      status: 'pending',
      message: 'Redirect user to checkout URL',
      raw_request: payload,
      raw_response: data,
    };

  } catch (error: any) {
    console.error('[MaishaPay Adapter] API error:', error.message);
    return {
      success: false,
      provider_key: 'maishapay',
      reference,
      status: 'rejected',
      error: error.message,
      raw_request: payload,
    };
  }
}

/**
 * Verify payment status with MaishaPay
 */
export async function verifyPayment(
  config: MaishaPayConfig,
  reference: string
): Promise<VerifyPaymentResult> {
  console.log('[MaishaPay Adapter] Verifying payment:', reference);
  
  // MaishaPay primarily uses callbacks, verification API is limited
  // For now, return pending - callbacks are the source of truth
  return {
    success: true,
    status: 'pending',
  };
}

// ==================== Status Normalization ====================

/**
 * Normalize MaishaPay payment status
 */
export function normalizePaymentStatus(status: string | number): 'pending' | 'succeeded' | 'failed' | 'cancelled' {
  if (!status && status !== 0) return 'pending';
  
  const normalized = String(status).toLowerCase();
  
  // MaishaPay uses numeric status codes: 200/202 = success
  if (['200', '202', 'success', 'paid', 'accepted', '1'].includes(normalized) || normalized.includes('success')) {
    return 'succeeded';
  }
  if (['203', 'cancelled', 'canceled'].includes(normalized)) {
    return 'cancelled';
  }
  if (['204', '400', '500', 'failed', 'error', 'rejected'].includes(normalized)) {
    return 'failed';
  }
  
  return 'pending';
}
