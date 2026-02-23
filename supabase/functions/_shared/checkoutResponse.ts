/**
 * Checkout Response Helpers
 * 
 * Provides standardized response schemas for checkout edge functions.
 * CRITICAL: All expected cases return HTTP 200 with structured JSON.
 * Only truly unexpected server faults should return 500.
 */

// ============================================
// Types
// ============================================

export interface CheckoutError {
  code: string;
  message: string;
  message_fr?: string;
  provider_status?: number;
  provider_body_snippet?: string;
}

export interface CheckoutResponse {
  ok: boolean;
  mode: 'redirect';
  currency: 'USD' | 'CDF' | string;
  amount: number;
  order_id?: string;
  reference: string;
  redirect_url?: string;
  error?: CheckoutError;
  // Additional metadata
  fx_rate?: number;
  amount_cdf?: number;
  session_id?: string;
  reused?: boolean;
}

// ============================================
// Error Codes
// ============================================

export const CHECKOUT_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_ALREADY_PAID: 'ORDER_ALREADY_PAID',
  CART_EMPTY: 'CART_EMPTY',
  PROVIDER_LINK_FAILED: 'PROVIDER_LINK_FAILED',
  RATE_LIMIT_SOFT: 'RATE_LIMIT_SOFT',
  LINK_EXPIRED: 'LINK_EXPIRED',
  LINK_NOT_FOUND: 'LINK_NOT_FOUND',
  AMOUNT_EXCEEDS_LIMIT: 'AMOUNT_EXCEEDS_LIMIT',
  SERVER_ERROR: 'SERVER_ERROR',
} as const;

// ============================================
// Rate Limiting (Soft - In Memory)
// ============================================

interface RateLimitEntry {
  count: number;
  firstRequest: number;
}

// Simple in-memory rate limit (per-instance, best effort)
const rateLimitMap = new Map<string, RateLimitEntry>();

export function checkSoftRateLimit(userId: string): {
  allowed: boolean;
  count: number;
  limit: number;
} {
  const limit = Number(Deno.env.get('CHECKOUT_SOFT_RATE_LIMIT_N') || '8');
  const windowSeconds = Number(Deno.env.get('CHECKOUT_SOFT_RATE_LIMIT_WINDOW_SECONDS') || '30');
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const key = `checkout:${userId}`;

  const entry = rateLimitMap.get(key);

  if (!entry || (now - entry.firstRequest) > windowMs) {
    rateLimitMap.set(key, { count: 1, firstRequest: now });
    return { allowed: true, count: 1, limit };
  }

  entry.count++;
  rateLimitMap.set(key, entry);

  return {
    allowed: entry.count <= limit,
    count: entry.count,
    limit,
  };
}

// ============================================
// Response Builders
// ============================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

/**
 * Generate a unique request ID for logging
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

/**
 * Generate a payment reference
 */
export function generateReference(orderId: string, userId?: string): string {
  const shortOrderId = orderId.slice(0, 8).toUpperCase();
  const suffix = userId ? userId.slice(-4).toUpperCase() : Math.random().toString(36).slice(-4).toUpperCase();
  return `AFRI-${shortOrderId}-${suffix}`;
}

/**
 * Build success redirect response
 */
export function buildRedirectResponse(params: {
  order_id: string;
  reference: string;
  redirect_url: string;
  amount: number;
  currency: string;
  fx_rate?: number;
  amount_cdf?: number;
  session_id?: string;
  reused?: boolean;
}): Response {
  const response: CheckoutResponse = {
    ok: true,
    mode: 'redirect',
    currency: params.currency,
    amount: params.amount,
    order_id: params.order_id,
    reference: params.reference,
    redirect_url: params.redirect_url,
    fx_rate: params.fx_rate,
    amount_cdf: params.amount_cdf,
    session_id: params.session_id,
    reused: params.reused,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: corsHeaders,
  });
}

/**
 * Build error response for expected validation/business errors
 * ALWAYS returns HTTP 200 with ok=false
 */
export function buildCheckoutErrorResponse(params: {
  error: CheckoutError;
  order_id?: string;
  reference?: string;
  amount?: number;
  currency?: string;
}): Response {
  const response: CheckoutResponse = {
    ok: false,
    mode: 'redirect',
    currency: params.currency || 'USD',
    amount: params.amount || 0,
    order_id: params.order_id,
    reference: params.reference || '',
    error: params.error,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: corsHeaders,
  });
}

/**
 * Build fatal server error response (only for truly unexpected errors)
 * This is the ONLY case where we return 500
 */
export function buildServerErrorResponse(requestId: string, message?: string): Response {
  return new Response(JSON.stringify({
    ok: false,
    mode: 'redirect',
    currency: 'USD',
    amount: 0,
    reference: '',
    error: {
      code: CHECKOUT_ERROR_CODES.SERVER_ERROR,
      message: message || 'An unexpected error occurred. Please try again.',
    },
    request_id: requestId,
  }), {
    status: 500,
    headers: corsHeaders,
  });
}

/**
 * Log checkout event with standard structure
 */
export function logCheckoutEvent(
  requestId: string,
  event: string,
  data: Record<string, unknown>
): void {
  console.log(`[CHECKOUT_EDGE] ${event}`, {
    request_id: requestId,
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Truncate string safely for logging
 */
export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}
