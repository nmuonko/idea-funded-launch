/**
 * Stripe Payment Adapter
 * 
 * Implements Stripe Payment Intents API for card payments.
 * Used for vehicle orders and high-value transactions.
 */

import { PaymentProvider, getSecretValue } from "./paymentProviders.ts";

// ==================== Types ====================

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  mode: 'sandbox' | 'live';
}

export interface StripePaymentIntentRequest {
  amount: number; // in cents
  currency: string;
  metadata: {
    order_id: string;
    user_id: string;
    intent_id: string;
  };
  automatic_payment_methods?: {
    enabled: boolean;
  };
}

export interface StripePaymentIntentResponse {
  id: string;
  client_secret: string;
  status: string;
  amount: number;
  currency: string;
  created: number;
  metadata: Record<string, string>;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: StripePaymentIntentResponse;
  };
}

export interface CreatePaymentIntentParams {
  orderId: string;
  userId: string;
  intentId: string;
  amount: number; // USD (will be converted to cents)
  description?: string;
}

export interface CreatePaymentIntentResult {
  success: boolean;
  client_secret?: string;
  provider_deposit_id?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  error?: string;
  raw_request?: any;
  raw_response?: any;
}

export interface VerifyPaymentIntentResult {
  success: boolean;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  provider_transaction_id?: string;
  paid_at?: string;
  error?: string;
}

export interface WebhookResult {
  success: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  payment_intent_id?: string;
  order_id?: string;
  user_id?: string;
  intent_id?: string;
  error?: string;
}

// ==================== Config ====================

/**
 * Get Stripe configuration from provider config
 */
export function getStripeConfig(provider: PaymentProvider): StripeConfig {
  const secretKey = getSecretValue(provider.secret_refs.secret_key || 'STRIPE_SECRET_KEY');
  const webhookSecret = getSecretValue(provider.secret_refs.webhook_secret || 'STRIPE_WEBHOOK_SECRET');
  const modeRaw = provider.config_public?.mode || 'sandbox';
  const mode: 'sandbox' | 'live' = modeRaw === 'live' ? 'live' : 'sandbox';

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  return {
    secretKey,
    webhookSecret,
    mode,
  };
}

/**
 * Get Stripe config directly from env (for functions without provider lookup)
 */
export function getStripeConfigFromEnv(): StripeConfig {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  return {
    secretKey,
    webhookSecret,
    mode: 'live', // Default to live
  };
}

// ==================== API Methods ====================

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Create a Stripe Payment Intent
 */
export async function createPaymentIntent(
  config: StripeConfig,
  params: CreatePaymentIntentParams
): Promise<CreatePaymentIntentResult> {
  const amountCents = Math.round(params.amount * 100);
  
  console.log('[Stripe] Creating PaymentIntent:', {
    orderId: params.orderId,
    amountCents,
    currency: 'usd',
  });

  const body = new URLSearchParams({
    amount: amountCents.toString(),
    currency: 'usd',
    'automatic_payment_methods[enabled]': 'true',
    'metadata[order_id]': params.orderId,
    'metadata[user_id]': params.userId,
    'metadata[intent_id]': params.intentId,
  });

  // iOS 3DS redirect fix - required for SFSafariViewController to return properly
  body.append('automatic_payment_methods[allow_redirects]', 'always');
  body.append('return_url', 'afrishop://stripe-redirect');

  if (params.description) {
    body.append('description', params.description);
  }

  try {
    const response = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Stripe] API error:', data);
      return {
        success: false,
        status: 'failed',
        error: data.error?.message || 'Failed to create payment intent',
        raw_response: data,
      };
    }

    console.log('[Stripe] PaymentIntent created:', {
      id: data.id,
      status: data.status,
      clientSecretPreview: data.client_secret?.slice(0, 20) + '...',
    });

    return {
      success: true,
      client_secret: data.client_secret,
      provider_deposit_id: data.id,
      status: mapStripeStatus(data.status),
      raw_request: { amount: amountCents, currency: 'usd', metadata: params },
      raw_response: { id: data.id, status: data.status },
    };

  } catch (error: any) {
    console.error('[Stripe] Request error:', error.message);
    return {
      success: false,
      status: 'failed',
      error: error.message,
    };
  }
}

/**
 * Verify a Payment Intent status
 */
export async function verifyPaymentIntent(
  config: StripeConfig,
  paymentIntentId: string
): Promise<VerifyPaymentIntentResult> {
  console.log('[Stripe] Verifying PaymentIntent:', paymentIntentId);

  try {
    const response = await fetch(`${STRIPE_API_BASE}/payment_intents/${paymentIntentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.status === 404) {
      return {
        success: false,
        status: 'pending',
        error: 'PaymentIntent not found',
      };
    }

    const data = await response.json();

    console.log('[Stripe] Verify response:', {
      id: data.id,
      status: data.status,
    });

    return {
      success: true,
      status: mapStripeStatus(data.status),
      provider_transaction_id: data.id,
      paid_at: data.status === 'succeeded' ? new Date(data.created * 1000).toISOString() : undefined,
    };

  } catch (error: any) {
    console.error('[Stripe] Verify error:', error.message);
    return {
      success: false,
      status: 'pending',
      error: error.message,
    };
  }
}

/**
 * Verify Stripe webhook signature using HMAC-SHA256
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): Promise<boolean> {
  // Parse the signature header
  const parts = signature.split(',');
  let timestamp = '';
  let sig = '';

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') sig = value;
  }

  if (!timestamp || !sig) {
    console.warn('[Stripe] Missing timestamp or signature in header');
    return false;
  }

  // Check timestamp is within tolerance (5 minutes)
  const timestampInt = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampInt) > 300) {
    console.warn('[Stripe] Webhook timestamp too old:', { timestamp: timestampInt, now });
    return false;
  }

  // Compute expected signature using HMAC-SHA256
  const signedPayload = `${timestamp}.${payload}`;
  
  try {
    // Import the secret as a CryptoKey
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Sign the payload
    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedPayload)
    );

    // Convert to hex string
    const expectedSig = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison
    if (expectedSig.length !== sig.length) {
      console.warn('[Stripe] Signature length mismatch');
      return false;
    }

    let result = 0;
    for (let i = 0; i < expectedSig.length; i++) {
      result |= expectedSig.charCodeAt(i) ^ sig.charCodeAt(i);
    }

    if (result !== 0) {
      console.warn('[Stripe] Signature mismatch');
      return false;
    }

    console.log('[Stripe] Webhook signature verified successfully');
    return true;

  } catch (error: any) {
    console.error('[Stripe] Signature verification error:', error.message);
    return false;
  }
}

/**
 * Handle Stripe webhook event
 */
export function handleWebhook(
  event: StripeWebhookEvent
): WebhookResult {
  console.log('[Stripe] Processing webhook:', {
    id: event.id,
    type: event.type,
    paymentIntentId: event.data?.object?.id,
  });

  const paymentIntent = event.data?.object;
  if (!paymentIntent) {
    return {
      success: false,
      status: 'pending',
      error: 'No payment intent in event',
    };
  }

  const metadata = paymentIntent.metadata || {};

  switch (event.type) {
    case 'payment_intent.succeeded':
      return {
        success: true,
        status: 'succeeded',
        payment_intent_id: paymentIntent.id,
        order_id: metadata.order_id,
        user_id: metadata.user_id,
        intent_id: metadata.intent_id,
      };

    case 'payment_intent.payment_failed':
      return {
        success: true,
        status: 'failed',
        payment_intent_id: paymentIntent.id,
        order_id: metadata.order_id,
        user_id: metadata.user_id,
        intent_id: metadata.intent_id,
        error: 'Payment failed',
      };

    case 'payment_intent.canceled':
      return {
        success: true,
        status: 'cancelled',
        payment_intent_id: paymentIntent.id,
        order_id: metadata.order_id,
        user_id: metadata.user_id,
        intent_id: metadata.intent_id,
      };

    case 'payment_intent.processing':
      return {
        success: true,
        status: 'pending',
        payment_intent_id: paymentIntent.id,
        order_id: metadata.order_id,
        user_id: metadata.user_id,
        intent_id: metadata.intent_id,
      };

    default:
      console.log('[Stripe] Unhandled event type:', event.type);
      return {
        success: false,
        status: 'pending',
        error: `Unhandled event type: ${event.type}`,
      };
  }
}

/**
 * Test Stripe configuration by retrieving account balance
 */
export async function testConfiguration(config: StripeConfig): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  console.log('[Stripe] Testing configuration...');

  try {
    const response = await fetch(`${STRIPE_API_BASE}/balance`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      return {
        success: false,
        message: 'Stripe API call failed',
        error: data.error?.message || 'Unknown error',
      };
    }

    const data = await response.json();
    console.log('[Stripe] Configuration valid, balance retrieved');

    return {
      success: true,
      message: `Stripe connected. Available balance: ${data.available?.[0]?.amount || 0} ${data.available?.[0]?.currency || 'USD'}`,
    };

  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to connect to Stripe',
      error: error.message,
    };
  }
}

// ==================== Helpers ====================

/**
 * Map Stripe status to our standard status
 */
function mapStripeStatus(stripeStatus: string): 'pending' | 'processing' | 'succeeded' | 'failed' {
  switch (stripeStatus) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
    case 'requires_action':
    case 'requires_payment_method':
    case 'requires_confirmation':
      return 'pending';
    case 'canceled':
    case 'requires_capture':
      return 'failed';
    default:
      return 'pending';
  }
}
